/*
 * Quiz Copérdia — servidor do jogo ao vivo (estilo Kahoot) + arquivos estáticos.
 * Sem dependências externas — apenas Node.js (>=18).
 *
 * Salas ficam em memória: o instrutor cria a sala enviando o quiz,
 * participantes entram com o PIN e tudo é sincronizado via SSE.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // salas expiram após 3h
const DEFAULT_TIME = 20;                // segundos por questão quando não definido
const REVEAL_DELAY_MS = 800;            // margem após o fim do tempo

const QUESTION_TYPES = ['quiz', 'tf', 'short', 'slider', 'puzzle', 'poll', 'scale', 'nps', 'pin', 'wordcloud', 'brainstorm', 'open', 'slide'];
const SCORED_TYPES = ['quiz', 'tf', 'short', 'slider', 'puzzle']; // tipos que valem nota/pontos
const SLIDE_LAYOUTS = ['classic', 'big-title', 'title-text', 'bullets', 'quote', 'big-media'];
const POINTS_MULTIPLIER = { standard: 1, double: 2, none: 0 };

// Mesma lista do cliente (js/app.js) — avatares permitidos
const AVATARS = ['😀','😎','🤩','😜','🤓','😺','🐶','🐼','🦊','🦁','🐸','🐵','🦄','🐙','🐝','🦉','🚀','⚽','🎮','🎸','🔥','⭐','🍕','🤖','👻','🤠','💪','🧠','🎯','🏆'];

// Mesma lista do cliente (js/live.js) — reações rápidas permitidas
const REACTIONS = ['👍','👏','❤️','😂','🤪','😮','🚀','🏎️','🚜','🌾','📣','🎉'];

const rooms = new Map(); // pin -> room

/* ==================== Utilidades ==================== */

function uid() {
  return crypto.randomBytes(9).toString('base64url');
}

function newPin() {
  let pin;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(pin));
  return pin;
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 12_000_000) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/* ==================== Modelo da sala ==================== */

function sanitizeImage(value, maxBytes) {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length <= maxBytes
    ? value : null;
}

// Logomarca também pode ser um link http(s) de imagem
function sanitizeLogoUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) && value.length <= 500
    ? value : null;
}

function sanitizeQuiz(quiz) {
  if (!quiz || typeof quiz.name !== 'string' || !Array.isArray(quiz.questions)) return null;
  const defaultTime = Number(quiz.timePerQuestion);
  const questions = [];

  for (const raw of quiz.questions) {
    if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) continue;
    const type = QUESTION_TYPES.includes(raw.type) ? raw.type : 'quiz';
    const q = {
      type,
      text: String(raw.text).slice(0, 500),
      image: sanitizeImage(raw.image, 600_000),
      options: [],
      optionImages: [],
      corrects: [],
      answers: [],   // resposta curta: textos aceitos
      multi: false,
      timeLimit: null,
      maxAnswers: 1, // nuvem/brainstorm: quantas respostas cada participante pode enviar
      maxVotes: 3,   // brainstorm: votos por participante
      scaleLeft: '', // escala/NPS: rótulos das pontas
      scaleRight: '',
      body: '',      // slide: texto de apoio
      layout: 'classic', // slide: layout visual
      reactions: raw.reactions !== false, // reações emoji habilitadas nesta questão
      sliderMin: 0, sliderMax: 100, sliderStep: 1, sliderAnswer: 50, sliderTolerance: 0,
      pointsMultiplier: POINTS_MULTIPLIER[raw.points] !== undefined
        ? POINTS_MULTIPLIER[raw.points] : 1,
    };
    const t = Number(raw.timeLimit);
    if (t >= 5 && t <= 600) q.timeLimit = Math.round(t);

    if (type === 'quiz' || type === 'poll' || type === 'puzzle') {
      if (!Array.isArray(raw.options)) continue;
      // Mantém texto+imagem pareados e remapeia os índices corretos se alguma opção vazia for removida
      const rawImages = Array.isArray(raw.optionImages) ? raw.optionImages : [];
      const kept = [];
      const indexMap = new Map();
      raw.options.forEach((o, i) => {
        const text = String(o).slice(0, 300).trim();
        const image = sanitizeImage(rawImages[i], 300_000);
        if (text || image) {
          indexMap.set(i, kept.length);
          kept.push({ text: text || ' ', image });
        }
      });
      if (kept.length < 2 || kept.length > 6) continue;
      q.options = kept.map(o => o.text);
      q.optionImages = kept.map(o => o.image);
      if (Array.isArray(raw.corrects)) {
        raw.corrects = raw.corrects
          .filter(i => indexMap.has(i))
          .map(i => indexMap.get(i));
      }
    }
    if (type === 'puzzle') {
      // As opções chegam na ORDEM CORRETA; sorteia uma ordem de exibição (a mesma para todos)
      const idx = q.options.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      if (idx.length > 1 && idx.every((v, k) => v === k)) [idx[0], idx[1]] = [idx[1], idx[0]];
      q.shuffleMap = idx; // posição exibida -> posição na ordem correta
    }
    if (type === 'tf') {
      q.options = ['Verdadeiro', 'Falso'];
      q.optionImages = [null, null];
    }
    if (type === 'scale') {
      q.options = ['1', '2', '3', '4', '5'];
      q.optionImages = [null, null, null, null, null];
      q.scaleLeft = String(raw.scaleLeft || '').slice(0, 40);
      q.scaleRight = String(raw.scaleRight || '').slice(0, 40);
    }
    if (type === 'nps') {
      q.options = Array.from({ length: 11 }, (_, i) => String(i)); // 0 a 10
      q.optionImages = q.options.map(() => null);
      q.scaleLeft = String(raw.scaleLeft || 'Improvável').slice(0, 40);
      q.scaleRight = String(raw.scaleRight || 'Muito provável').slice(0, 40);
    }
    if (type === 'slider') {
      let min = Number(raw.sliderMin), max = Number(raw.sliderMax);
      if (!Number.isFinite(min)) min = 0;
      if (!Number.isFinite(max) || max <= min) { min = 0; max = 100; }
      let step = Number(raw.sliderStep);
      if (!(step > 0) || step > max - min) step = 1;
      let answer = Number(raw.sliderAnswer);
      if (!Number.isFinite(answer)) answer = min;
      answer = Math.min(max, Math.max(min, answer));
      let tol = Number(raw.sliderTolerance);
      if (!(tol >= 0)) tol = 0;
      Object.assign(q, { sliderMin: min, sliderMax: max, sliderStep: step, sliderAnswer: answer, sliderTolerance: tol });
    }
    if (type === 'pin') {
      if (!q.image) continue; // largar marcador exige uma imagem
    }
    if (type === 'short') {
      // respostas aceitas: até 10 textos, sem repetição (comparação sem maiúsculas)
      const seen = new Set();
      for (const a of (Array.isArray(raw.answers) ? raw.answers : [])) {
        const text = String(a).trim().replace(/\s+/g, ' ').slice(0, 60);
        if (!text || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        q.answers.push(text);
        if (q.answers.length >= 10) break;
      }
      if (q.answers.length === 0) continue;
    }
    if (type === 'slide') {
      q.body = String(raw.body || '').slice(0, 1000);
      q.layout = SLIDE_LAYOUTS.includes(raw.layout) ? raw.layout : 'classic';
    }
    if (type === 'quiz' || type === 'tf') {
      const corrects = Array.isArray(raw.corrects) ? raw.corrects : [];
      q.corrects = [...new Set(corrects)]
        .filter(i => Number.isInteger(i) && i >= 0 && i < q.options.length)
        .sort((a, b) => a - b);
      if (q.corrects.length === 0) continue;
      q.multi = type === 'quiz' && raw.multi === true;
      if (!q.multi && q.corrects.length > 1) q.corrects = [q.corrects[0]];
    } else if (!SCORED_TYPES.includes(type)) {
      q.pointsMultiplier = 0; // tipos de opinião e slides não pontuam
      if (type === 'wordcloud' || type === 'brainstorm') {
        const m = Math.round(Number(raw.maxAnswers));
        q.maxAnswers = m >= 1 && m <= 5 ? m : (type === 'brainstorm' ? 3 : 1);
      }
      if (type === 'brainstorm') {
        const v = Math.round(Number(raw.maxVotes));
        q.maxVotes = v >= 1 && v <= 5 ? v : 3;
      }
    }
    questions.push(q);
  }

  if (questions.length === 0) return null;
  return {
    name: String(quiz.name).slice(0, 200),
    logo: sanitizeImage(quiz.logo, 300_000) || sanitizeLogoUrl(quiz.logo), // logomarca personalizada (vai aos celulares no join)
    passScore: Math.min(100, Math.max(0, Number(quiz.passScore) || 0)),
    timePerQuestion: defaultTime >= 5 && defaultTime <= 600 ? Math.round(defaultTime) : DEFAULT_TIME,
    showRanking: quiz.showRanking !== false,
    questions,
  };
}

function createRoom(quiz) {
  const room = {
    pin: newPin(),
    hostToken: uid(),
    quiz,
    // nº de questões que valem nota (base do % de acerto)
    scorableTotal: quiz.questions.filter(q => SCORED_TYPES.includes(q.type)).length,
    state: 'lobby', // lobby | question | reveal | podium
    questionIndex: -1,
    questionStartedAt: 0,
    questionTimer: null,
    brain: null, // brainstorm: { phase: 'ideas'|'vote', ideas: [{text,count}], votes: Map(playerId -> [índices]) }
    archive: new Map(), // questionIndex -> dados que não dá para recompor depois (ideias/votos do brainstorm)
    players: new Map(), // playerId -> { name, score, streak, correctCount, answers: Map(qIdx -> {value, ms, correct, points}) }
    prevRanks: new Map(),  // playerId -> posição antes da questão atual (para o "subiu/desceu")
    rankDeltas: new Map(), // playerId -> variação de posição na última revelação
    connections: new Set(), // { res, role, playerId }
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  rooms.set(room.pin, room);
  return room;
}

function touch(room) {
  room.lastActivity = Date.now();
}

function questionLimitMs(room) {
  const q = currentQuestion(room);
  return ((q && q.timeLimit) || room.quiz.timePerQuestion) * 1000;
}

// Pontuação estilo Kahoot: acerto vale 500 + até 500 pela velocidade
function computePoints(correct, elapsedMs, limitMs, multiplier) {
  if (!correct || multiplier === 0) return 0;
  const ratio = Math.min(1, Math.max(0, elapsedMs / limitMs));
  return (500 + Math.round(500 * (1 - ratio))) * multiplier;
}

function leaderboard(room) {
  return [...room.players.entries()]
    .map(([id, p]) => ({ id, name: p.name, avatar: p.avatar, score: p.score, correct: p.correctCount }))
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

function currentQuestion(room) {
  return room.quiz.questions[room.questionIndex] || null;
}

function answerCounts(room) {
  const q = currentQuestion(room);
  if (!q || ['wordcloud', 'short', 'slide', 'puzzle', 'open'].includes(q.type)) return [];
  const counts = q.options.map(() => 0);
  for (const p of room.players.values()) {
    const a = p.answers.get(room.questionIndex);
    if (!a) continue;
    const values = Array.isArray(a.value) ? a.value : [a.value];
    for (const v of values) {
      if (Number.isInteger(v) && counts[v] !== undefined) counts[v]++;
    }
  }
  return counts;
}

function wordCloud(room) {
  const words = new Map(); // chave minúscula -> { text, count }
  for (const p of room.players.values()) {
    const a = p.answers.get(room.questionIndex);
    if (!a) continue;
    const values = Array.isArray(a.value) ? a.value : (typeof a.value === 'string' ? [a.value] : []);
    for (const v of values) {
      if (typeof v !== 'string' || !v) continue;
      const key = v.toLowerCase();
      const entry = words.get(key) || { text: v, count: 0 };
      entry.count++;
      words.set(key, entry);
    }
  }
  return [...words.values()].sort((a, b) => b.count - a.count).slice(0, 60);
}

// Presença: um jogador está "online" se tem uma conexão SSE ativa
function isConnected(room, playerId) {
  for (const c of room.connections) {
    if (c.role === 'player' && c.playerId === playerId) return true;
  }
  return false;
}

function onlineCount(room) {
  const ids = new Set();
  for (const c of room.connections) {
    if (c.role === 'player' && room.players.has(c.playerId)) ids.add(c.playerId);
  }
  return ids.size;
}

function answeredCount(room) {
  // Na fase de votação do brainstorm, conta quem já votou
  if (room.brain && room.brain.phase === 'vote') return room.brain.votes.size;
  let n = 0;
  for (const p of room.players.values()) {
    if (p.answers.has(room.questionIndex)) n++;
  }
  return n;
}

// Ideias do brainstorm ranqueadas pelos votos recebidos
function brainRanked(room) {
  const votes = room.brain.ideas.map(() => 0);
  for (const list of room.brain.votes.values()) {
    for (const i of list) if (votes[i] !== undefined) votes[i]++;
  }
  return room.brain.ideas
    .map((idea, i) => ({ text: idea.text, count: idea.count, votes: votes[i] }))
    .sort((a, b) => b.votes - a.votes || b.count - a.count);
}

/* ==================== Snapshots por papel ==================== */

function questionPublic(q) {
  // Puzzle: todos veem as opções na ordem embaralhada — a correta só aparece na revelação
  const shuffled = q.type === 'puzzle';
  return {
    type: q.type, text: q.text, image: q.image,
    options: shuffled ? q.shuffleMap.map(i => q.options[i]) : q.options,
    optionImages: shuffled ? q.shuffleMap.map(i => q.optionImages[i]) : q.optionImages,
    multi: q.multi, maxAnswers: q.maxAnswers || 1, maxVotes: q.maxVotes || 3,
    scaleLeft: q.scaleLeft, scaleRight: q.scaleRight,
    body: q.body, layout: q.layout || 'classic',
    reactions: q.reactions !== false,
    sliderMin: q.sliderMin, sliderMax: q.sliderMax, sliderStep: q.sliderStep,
    isScored: q.pointsMultiplier > 0,
    // As respostas aceitas (short) e o valor correto (slider) NÃO vão aqui — só na revelação
  };
}

function snapshotFor(room, conn) {
  const base = {
    state: room.state,
    quizName: room.quiz.name,
    totalQuestions: room.quiz.questions.length,
    questionIndex: room.questionIndex,
    playersCount: room.players.size,
    onlineCount: onlineCount(room),
  };
  const q = currentQuestion(room);

  if (room.state === 'lobby') {
    base.players = [...room.players.values()].map(p => ({ name: p.name, avatar: p.avatar }));
  }

  if (room.state === 'question' && q) {
    const limitMs = questionLimitMs(room);
    base.question = questionPublic(q);
    base.remainingMs = Math.max(0, limitMs - (Date.now() - room.questionStartedAt));
    base.limitMs = limitMs;
    base.answeredCount = answeredCount(room);
    if (room.brain) {
      base.brainPhase = room.brain.phase;
      if (room.brain.phase === 'vote') {
        base.ideas = room.brain.ideas.map(i => ({ text: i.text, count: i.count }));
      }
    }
    if (conn.role === 'player') {
      const p = room.players.get(conn.playerId);
      base.answered = room.brain && room.brain.phase === 'vote'
        ? room.brain.votes.has(conn.playerId)
        : !!(p && p.answers.has(room.questionIndex));
    }
  }

  if (room.state === 'reveal' && q) {
    base.question = questionPublic(q);
    if (q.type === 'wordcloud' || q.type === 'short') {
      base.words = wordCloud(room);
    } else {
      base.counts = answerCounts(room);
    }
    if (q.type === 'quiz' || q.type === 'tf') {
      base.corrects = q.corrects;
    }
    if (q.type === 'short') {
      base.acceptedAnswers = q.answers; // reveladas só depois que o tempo fecha
    }
    if (q.type === 'slider') {
      // valor correto e respostas de todos — revelados só depois que o tempo fecha
      base.sliderAnswer = q.sliderAnswer;
      base.sliderTolerance = q.sliderTolerance;
      base.sliderValues = [...room.players.values()]
        .map(p => p.answers.get(room.questionIndex))
        .filter(a => a && typeof a.value === 'number')
        .map(a => a.value);
    }
    if (q.type === 'pin') {
      base.pins = [...room.players.values()]
        .map(p => p.answers.get(room.questionIndex))
        .filter(a => a && a.value && typeof a.value.x === 'number')
        .map(a => a.value);
    }
    if (q.type === 'brainstorm' && room.brain) {
      base.ideas = brainRanked(room);
    }
    if (q.type === 'puzzle') {
      base.correctOrder = q.options; // a ordem correta, revelada só agora
      base.correctImages = q.optionImages;
      base.orderRight = [...room.players.values()]
        .filter(p => { const a = p.answers.get(room.questionIndex); return a && a.correct; }).length;
    }
    if (q.type === 'open') {
      base.responses = [...room.players.values()]
        .map(p => ({ name: p.name, avatar: p.avatar, answer: p.answers.get(room.questionIndex) }))
        .filter(r => r.answer && typeof r.answer.value === 'string')
        .map(r => ({ name: r.name, avatar: r.avatar, text: r.answer.value }));
    }
    base.showRanking = room.quiz.showRanking;
    if (room.quiz.showRanking) {
      // top 10 — o telão exibe em duas colunas de 5
      base.leaderboard = leaderboard(room).slice(0, 10)
        .map(p => ({ ...p, delta: room.rankDeltas.get(p.id) || 0, online: isConnected(room, p.id) }));
    }
    base.isLast = room.questionIndex + 1 >= room.quiz.questions.length;
    if (conn.role === 'player') {
      const p = room.players.get(conn.playerId);
      const a = p ? p.answers.get(room.questionIndex) : null;
      const all = leaderboard(room);
      const me = all.find(x => x.id === conn.playerId);
      base.me = {
        answered: !!a,
        correct: a ? a.correct : null,
        points: a ? a.points : 0,
        value: a ? a.value : null, // a própria resposta, para comparar com a correta no celular
        score: p ? p.score : 0,
        rank: room.quiz.showRanking && me ? me.rank : null,
        delta: room.quiz.showRanking ? (room.rankDeltas.get(conn.playerId) || 0) : 0,
        streak: p ? p.streak : 0,
      };
    }
  }

  if (room.state === 'podium') {
    const all = leaderboard(room);
    base.leaderboard = all;
    base.passScore = room.quiz.passScore;
    base.scorableTotal = room.scorableTotal;
    base.results = all.map(p => {
      const player = room.players.get(p.id);
      const percent = room.scorableTotal > 0
        ? Math.round((player.correctCount / room.scorableTotal) * 100) : null;
      return { ...p, percent, passed: percent === null ? null : percent >= room.quiz.passScore };
    });
    if (conn.role === 'player') {
      base.me = base.results.find(x => x.id === conn.playerId) || null;
    }
    if (conn.role === 'host') {
      // Replay: dados por questão para "reassistir" o preenchimento depois (sem imagens — quota
      // do localStorage do instrutor; exceção: largar marcador, que não faz sentido sem a foto)
      base.replay = room.quiz.questions.map((q, qi) => {
        if (q.type === 'slide') return null;
        const rq = {
          question: {
            type: q.type, text: q.text,
            options: q.options, optionImages: [],
            multi: q.multi, scaleLeft: q.scaleLeft, scaleRight: q.scaleRight,
            maxAnswers: q.maxAnswers, maxVotes: q.maxVotes,
            sliderMin: q.sliderMin, sliderMax: q.sliderMax,
            image: q.type === 'pin' ? q.image : null,
          },
          limitMs: ((q.timeLimit || room.quiz.timePerQuestion) * 1000),
          corrects: q.corrects,
          acceptedAnswers: q.type === 'short' ? q.answers : undefined,
          sliderAnswer: q.type === 'slider' ? q.sliderAnswer : undefined,
          sliderTolerance: q.type === 'slider' ? q.sliderTolerance : undefined,
          correctOrder: q.type === 'puzzle' ? q.options : undefined,
          shuffleMap: q.type === 'puzzle' ? q.shuffleMap : undefined,
          ideas: (room.archive.get(qi) || {}).ideas,
          events: [],
        };
        for (const p of room.players.values()) {
          const a = p.answers.get(qi);
          if (!a) continue;
          rq.events.push({ ms: a.ms, value: a.value, correct: a.correct, name: p.name, avatar: p.avatar });
        }
        rq.events.sort((x, y) => x.ms - y.ms);
        return rq;
      }).filter(Boolean);
    }
  }

  return base;
}

function broadcast(room) {
  for (const conn of room.connections) {
    try {
      conn.res.write(`data: ${JSON.stringify(snapshotFor(room, conn))}\n\n`);
    } catch { /* conexão morta — removida no evento close */ }
  }
}

/* ==================== Transições de estado ==================== */

function startQuestion(room, index) {
  clearTimeout(room.questionTimer);
  room.state = 'question';
  room.questionIndex = index;
  room.questionStartedAt = Date.now();
  const q = room.quiz.questions[index];
  room.brain = q && q.type === 'brainstorm'
    ? { phase: 'ideas', ideas: [], votes: new Map() } : null;
  room.questionTimer = setTimeout(() => questionTimeUp(room), questionLimitMs(room) + REVEAL_DELAY_MS);
  touch(room);
  broadcast(room);
}

// Fim do tempo: brainstorm passa para a votação; os demais tipos revelam
function questionTimeUp(room) {
  if (room.brain && room.brain.phase === 'ideas') startBrainVote(room);
  else reveal(room);
}

// Brainstorm: agrega as ideias enviadas e abre a fase de votação (com novo tempo)
function startBrainVote(room) {
  if (room.state !== 'question' || !room.brain || room.brain.phase !== 'ideas') return;
  clearTimeout(room.questionTimer);
  const dedup = new Map(); // minúsculas -> { text, count }
  for (const p of room.players.values()) {
    const a = p.answers.get(room.questionIndex);
    if (!a || !Array.isArray(a.value)) continue;
    for (const text of a.value) {
      const key = String(text).toLowerCase();
      const entry = dedup.get(key) || { text: String(text), count: 0 };
      entry.count++;
      dedup.set(key, entry);
    }
  }
  const ideas = [...dedup.values()].sort((a, b) => b.count - a.count).slice(0, 40);
  if (ideas.length === 0) return reveal(room); // ninguém enviou ideias
  room.brain = { phase: 'vote', ideas, votes: new Map() };
  room.questionStartedAt = Date.now(); // novo tempo para votar
  room.questionTimer = setTimeout(() => reveal(room), questionLimitMs(room) + REVEAL_DELAY_MS);
  touch(room);
  broadcast(room);
}

function reveal(room) {
  if (room.state !== 'question') return;
  clearTimeout(room.questionTimer);
  room.state = 'reveal';
  // Arquiva o que o replay não consegue recompor das respostas individuais
  if (room.brain) {
    room.archive.set(room.questionIndex, { ideas: brainRanked(room) });
  }
  // Variação de posição: compara com o ranking anterior a esta questão
  const lb = leaderboard(room);
  room.rankDeltas = new Map(lb.map(p => {
    const prev = room.prevRanks.get(p.id);
    return [p.id, prev === undefined ? 0 : prev - p.rank];
  }));
  room.prevRanks = new Map(lb.map(p => [p.id, p.rank]));
  touch(room);
  broadcast(room);
}

function endGame(room) {
  clearTimeout(room.questionTimer);
  room.state = 'podium';
  touch(room);
  broadcast(room);
}

/* ==================== Registro de respostas ==================== */

function registerAnswer(room, player, body) {
  const q = currentQuestion(room);
  const limitMs = questionLimitMs(room);
  const elapsedMs = Date.now() - room.questionStartedAt;
  if (elapsedMs > limitMs + REVEAL_DELAY_MS) return { error: 'Tempo esgotado.', status: 409 };

  let value, correct = null;

  if (q.type === 'slide') {
    return { error: 'Slides não recebem resposta.', status: 400 };
  }

  if (q.type === 'short') {
    const text = String(body.answer || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!text) return { error: 'Digite uma resposta.', status: 400 };
    value = text;
    correct = q.answers.some(a => a.toLowerCase() === text.toLowerCase());
  } else if (q.type === 'open') {
    const text = String(body.answer || '').trim().replace(/\s+/g, ' ').slice(0, 250);
    if (!text) return { error: 'Digite uma resposta.', status: 400 };
    value = text;
  } else if (q.type === 'puzzle') {
    // valor = sequência de posições exibidas, na ordem escolhida pelo participante
    const arr = Array.isArray(body.answer) ? body.answer.map(Number) : null;
    const n = q.options.length;
    const valid = arr && arr.length === n &&
      new Set(arr).size === n && arr.every(i => Number.isInteger(i) && i >= 0 && i < n);
    if (!valid) return { error: 'Ordene todas as alternativas.', status: 400 };
    value = arr;
    correct = arr.every((dispIdx, k) => q.shuffleMap[dispIdx] === k);
  } else if (q.type === 'slider') {
    const v = Number(body.answer);
    if (!Number.isFinite(v) || v < q.sliderMin || v > q.sliderMax) {
      return { error: 'Valor fora da faixa.', status: 400 };
    }
    value = v;
    correct = Math.abs(v - q.sliderAnswer) <= q.sliderTolerance;
  } else if (q.type === 'pin') {
    const x = Number(body.answer && body.answer.x);
    const y = Number(body.answer && body.answer.y);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
      return { error: 'Toque em um ponto da imagem.', status: 400 };
    }
    value = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
  } else if (q.type === 'wordcloud' || q.type === 'brainstorm') {
    // Aceita uma string (clientes antigos) ou uma lista de até maxAnswers textos
    const raw = Array.isArray(body.answer) ? body.answer : [body.answer];
    const maxLen = q.type === 'brainstorm' ? 80 : 30;
    const seen = new Set();
    const texts = [];
    for (const item of raw) {
      if (typeof item !== 'string' && typeof item !== 'number') continue;
      const text = String(item).trim().replace(/\s+/g, ' ').slice(0, maxLen);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue; // ignora repetições do mesmo participante
      seen.add(key);
      texts.push(text);
      if (texts.length >= (q.maxAnswers || 1)) break;
    }
    if (texts.length === 0) return { error: 'Digite uma resposta.', status: 400 };
    value = texts;
  } else if (q.multi) {
    const arr = Array.isArray(body.answer) ? body.answer : null;
    if (!arr || arr.length === 0) return { error: 'Selecione ao menos uma alternativa.', status: 400 };
    value = [...new Set(arr)]
      .filter(i => Number.isInteger(i) && i >= 0 && i < q.options.length)
      .sort((a, b) => a - b);
    if (value.length === 0) return { error: 'Resposta inválida.', status: 400 };
    correct = value.length === q.corrects.length && value.every((v, i) => v === q.corrects[i]);
  } else {
    const idx = Number(body.answer);
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) {
      return { error: 'Resposta inválida.', status: 400 };
    }
    value = idx;
    if (q.type === 'quiz' || q.type === 'tf') correct = q.corrects.includes(idx);
  }

  const points = computePoints(correct === true, elapsedMs, limitMs, q.pointsMultiplier);
  player.answers.set(room.questionIndex, { value, ms: elapsedMs, correct, points });
  player.score += points;
  if (SCORED_TYPES.includes(q.type)) {
    player.streak = correct ? player.streak + 1 : 0;
    if (correct) player.correctCount++;
  }
  return { ok: true };
}

/* ==================== Rotas da API ==================== */

async function handleApi(req, res, urlPath, query) {
  // POST /api/rooms — instrutor cria a sala com o quiz
  if (req.method === 'POST' && urlPath === '/api/rooms') {
    const body = await readBody(req);
    const quiz = sanitizeQuiz(body.quiz);
    if (!quiz) return json(res, 400, { error: 'Quiz inválido: verifique nome e questões.' });
    const room = createRoom(quiz);
    return json(res, 201, { pin: room.pin, hostToken: room.hostToken });
  }

  const match = urlPath.match(/^\/api\/rooms\/(\d{6})(\/[a-z]+)?$/);
  if (!match) return json(res, 404, { error: 'Rota não encontrada.' });
  const room = rooms.get(match[1]);
  if (!room) return json(res, 404, { error: 'Sala não encontrada. Confira o PIN.' });
  const action = match[2] || '';

  // POST /api/rooms/:pin/join — participante entra na sala (ou VOLTA após cair)
  if (req.method === 'POST' && action === '/join') {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    const deviceId = String(body.deviceId || '').slice(0, 80);
    if (room.state === 'podium') return json(res, 409, { error: 'Este jogo já foi encerrado.' });

    // Reentrada pelo aparelho: o mesmo deviceId volta como o MESMO jogador (pontuação preservada)
    if (deviceId) {
      for (const [id, p] of room.players) {
        if (p.deviceId && p.deviceId === deviceId) {
          touch(room);
          broadcast(room);
          return json(res, 200, { playerId: id, name: p.name, avatar: p.avatar, rejoined: true, logo: room.quiz.logo || null });
        }
      }
    }

    if (!name) return json(res, 400, { error: 'Informe seu nome.' });
    const existing = [...room.players.entries()]
      .find(([, p]) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const [id, p] = existing;
      // O nome só é recusado se o dono estiver conectado; desconectado = é a mesma pessoa voltando
      if (isConnected(room, id)) {
        return json(res, 409, { error: 'Já existe um participante com esse nome. Use outro.' });
      }
      if (deviceId) p.deviceId = deviceId;
      touch(room);
      broadcast(room);
      return json(res, 200, { playerId: id, name: p.name, avatar: p.avatar, rejoined: true, logo: room.quiz.logo || null });
    }

    if (room.players.size >= 200) return json(res, 409, { error: 'A sala está cheia.' });
    const avatar = AVATARS.includes(body.avatar)
      ? body.avatar
      : AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const playerId = uid();
    room.players.set(playerId, {
      name, avatar, deviceId, score: 0, streak: 0, correctCount: 0, answers: new Map(),
    });
    touch(room);
    broadcast(room);
    return json(res, 201, { playerId, name, avatar, logo: room.quiz.logo || null });
  }

  // POST /api/rooms/:pin/forget — este navegador não pertence mais àquele jogador
  // (computador compartilhado): desvincula o deviceId para não reentrar como ele
  if (req.method === 'POST' && action === '/forget') {
    const body = await readBody(req);
    const p = room.players.get(String(body.playerId || ''));
    if (p && body.deviceId && p.deviceId === body.deviceId) p.deviceId = '';
    return json(res, 200, { ok: true });
  }

  // GET /api/rooms/:pin/ping — o participante confere se sua sessão ainda vale nesta sala
  if (req.method === 'GET' && action === '/ping') {
    const ok = room.players.has(query.get('playerId') || '');
    return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Participante não encontrado.' });
  }

  // POST /api/rooms/:pin/react — reação emoji; flutua nas telas de todos (evento SSE, sem estado)
  if (req.method === 'POST' && action === '/react') {
    const body = await readBody(req);
    const player = room.players.get(String(body.playerId || ''));
    if (!player) return json(res, 403, { error: 'Participante não encontrado.' });
    if (!REACTIONS.includes(body.emoji)) return json(res, 400, { error: 'Reação inválida.' });
    const now = Date.now();
    if (now - (player.lastReactAt || 0) >= 600) { // ignora spam sem devolver erro
      player.lastReactAt = now;
      touch(room);
      const payload = `event: reaction\ndata: ${JSON.stringify({ emoji: body.emoji })}\n\n`;
      for (const conn of room.connections) {
        try { conn.res.write(payload); } catch { /* conexão morta */ }
      }
    }
    return json(res, 200, { ok: true });
  }

  // POST /api/rooms/:pin/answer — participante responde a questão atual (ou vota no brainstorm)
  if (req.method === 'POST' && action === '/answer') {
    const body = await readBody(req);
    const playerId = String(body.playerId || '');
    const player = room.players.get(playerId);
    if (!player) return json(res, 403, { error: 'Participante não encontrado.' });
    if (room.state !== 'question' || body.questionIndex !== room.questionIndex) {
      return json(res, 409, { error: 'Fora do tempo de resposta.' });
    }

    // Brainstorm em votação: registra os votos (segunda rodada de resposta da mesma questão)
    if (room.brain && room.brain.phase === 'vote') {
      if (room.brain.votes.has(playerId)) {
        return json(res, 409, { error: 'Você já votou.' });
      }
      const q = currentQuestion(room);
      const raw = Array.isArray(body.answer) ? body.answer : [body.answer];
      const ids = [...new Set(raw)]
        .filter(i => Number.isInteger(i) && i >= 0 && i < room.brain.ideas.length)
        .slice(0, q.maxVotes || 3);
      if (ids.length === 0) return json(res, 400, { error: 'Escolha ao menos uma ideia.' });
      room.brain.votes.set(playerId, ids);
      touch(room);
      if (room.brain.votes.size >= room.players.size) reveal(room);
      else broadcast(room);
      return json(res, 200, { ok: true });
    }

    if (player.answers.has(room.questionIndex)) {
      return json(res, 409, { error: 'Você já respondeu esta questão.' });
    }
    const result = registerAnswer(room, player, body);
    if (result.error) return json(res, result.status, { error: result.error });
    touch(room);

    // Todos responderam? Brainstorm abre a votação; os demais revelam na hora.
    if (answeredCount(room) >= room.players.size) {
      if (room.brain && room.brain.phase === 'ideas') startBrainVote(room);
      else reveal(room);
    } else {
      broadcast(room); // atualiza contador de respostas no telão
    }
    return json(res, 200, { ok: true });
  }

  // POST /api/rooms/:pin/action — comandos do instrutor
  if (req.method === 'POST' && action === '/action') {
    const body = await readBody(req);
    if (body.hostToken !== room.hostToken) return json(res, 403, { error: 'Sem permissão.' });
    const cmd = body.command;
    if (cmd === 'start') {
      if (room.state !== 'lobby') return json(res, 409, { error: 'O jogo já começou.' });
      if (room.players.size === 0) return json(res, 409, { error: 'Aguarde ao menos um participante entrar.' });
      startQuestion(room, 0);
    } else if (cmd === 'reveal') {
      reveal(room);
    } else if (cmd === 'brainvote') {
      // Brainstorm: instrutor encerra o envio de ideias e abre a votação
      if (!room.brain || room.brain.phase !== 'ideas' || room.state !== 'question') {
        return json(res, 409, { error: 'Ação indisponível agora.' });
      }
      startBrainVote(room);
    } else if (cmd === 'next') {
      // Slides avançam direto da exibição (sem passar pelo reveal)
      const q = currentQuestion(room);
      const slideShowing = room.state === 'question' && q && q.type === 'slide';
      if (room.state !== 'reveal' && !slideShowing) return json(res, 409, { error: 'Ação indisponível agora.' });
      if (room.questionIndex + 1 >= room.quiz.questions.length) endGame(room);
      else startQuestion(room, room.questionIndex + 1);
    } else if (cmd === 'end') {
      endGame(room);
    } else {
      return json(res, 400, { error: 'Comando desconhecido.' });
    }
    return json(res, 200, { ok: true });
  }

  // GET /api/rooms/:pin/events — stream SSE (host ou participante)
  if (req.method === 'GET' && action === '/events') {
    let conn;
    if (query.get('hostToken') === room.hostToken) {
      conn = { res, role: 'host', playerId: null };
    } else if (room.players.has(query.get('playerId'))) {
      conn = { res, role: 'player', playerId: query.get('playerId') };
    } else {
      return json(res, 403, { error: 'Sem permissão para acompanhar esta sala.' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    room.connections.add(conn);
    res.write(`data: ${JSON.stringify(snapshotFor(room, conn))}\n\n`);
    // Como evento nomeado (não comentário): o cliente usa como sinal de vida para o vigia de conexão
    const heartbeat = setInterval(() => {
      try { res.write('event: ping\ndata: {}\n\n'); } catch { /* ignora */ }
    }, 25000);
    if (conn.role === 'player') broadcast(room); // atualiza o "online" nos telões
    req.on('close', () => {
      clearInterval(heartbeat);
      room.connections.delete(conn);
      if (conn.role === 'player') broadcast(room);
    });
    return;
  }

  return json(res, 404, { error: 'Rota não encontrada.' });
}

/* ==================== Arquivos estáticos ==================== */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (urlPath === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  // no-cache = o navegador revalida a cada carga; após um deploy, todos recebem o JS novo
  const lastModified = fs.statSync(filePath).mtime.toUTCString();
  if (req.headers['if-modified-since'] === lastModified) {
    res.writeHead(304, { 'Cache-Control': 'no-cache', 'Last-Modified': lastModified });
    return res.end();
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end('Internal Server Error');
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Last-Modified': lastModified,
    });
    res.end(data);
  });
}

/* ==================== Servidor ==================== */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = decodeURIComponent(url.pathname);
  try {
    if (urlPath.startsWith('/api/')) {
      await handleApi(req, res, urlPath, url.searchParams);
    } else {
      serveStatic(req, res, urlPath);
    }
  } catch (err) {
    json(res, 400, { error: err.message || 'Requisição inválida.' });
  }
});

// Limpeza periódica de salas expiradas
setInterval(() => {
  const now = Date.now();
  for (const [pin, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      clearTimeout(room.questionTimer);
      for (const conn of room.connections) {
        try { conn.res.end(); } catch { /* ignora */ }
      }
      rooms.delete(pin);
    }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Quiz Copérdia rodando em http://localhost:${PORT}`);
});
