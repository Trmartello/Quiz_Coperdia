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

const QUESTION_TYPES = ['quiz', 'tf', 'short', 'poll', 'scale', 'wordcloud', 'slide'];
const SCORED_TYPES = ['quiz', 'tf', 'short']; // tipos que valem nota/pontos
const POINTS_MULTIPLIER = { standard: 1, double: 2, none: 0 };

// Mesma lista do cliente (js/app.js) — avatares permitidos
const AVATARS = ['😀','😎','🤩','😜','🤓','😺','🐶','🐼','🦊','🦁','🐸','🐵','🦄','🐙','🐝','🦉','🚀','⚽','🎮','🎸','🔥','⭐','🍕','🤖','👻','🤠','💪','🧠','🎯','🏆'];

// Mesma lista do cliente (js/live.js) — reações rápidas permitidas
const REACTIONS = ['👍','👏','❤️','😂','🤔','😮'];

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
      maxAnswers: 1, // nuvem de palavras: quantas respostas cada participante pode enviar
      scaleLeft: '', // escala: rótulos das pontas
      scaleRight: '',
      body: '',      // slide: texto de apoio
      pointsMultiplier: POINTS_MULTIPLIER[raw.points] !== undefined
        ? POINTS_MULTIPLIER[raw.points] : 1,
    };
    const t = Number(raw.timeLimit);
    if (t >= 5 && t <= 600) q.timeLimit = Math.round(t);

    if (type === 'quiz' || type === 'poll') {
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
      q.pointsMultiplier = 0; // enquete, escala, nuvem e slide não pontuam
      if (type === 'wordcloud') {
        const m = Math.round(Number(raw.maxAnswers));
        q.maxAnswers = m >= 1 && m <= 5 ? m : 1;
      }
    }
    questions.push(q);
  }

  if (questions.length === 0) return null;
  return {
    name: String(quiz.name).slice(0, 200),
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
  if (!q || q.type === 'wordcloud' || q.type === 'short' || q.type === 'slide') return [];
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

function answeredCount(room) {
  let n = 0;
  for (const p of room.players.values()) {
    if (p.answers.has(room.questionIndex)) n++;
  }
  return n;
}

/* ==================== Snapshots por papel ==================== */

function questionPublic(q) {
  return {
    type: q.type, text: q.text, image: q.image,
    options: q.options, optionImages: q.optionImages,
    multi: q.multi, maxAnswers: q.maxAnswers || 1,
    scaleLeft: q.scaleLeft, scaleRight: q.scaleRight,
    body: q.body,
    isScored: q.pointsMultiplier > 0,
    // As respostas aceitas (short) NÃO vão aqui — só na revelação
  };
}

function snapshotFor(room, conn) {
  const base = {
    state: room.state,
    quizName: room.quiz.name,
    totalQuestions: room.quiz.questions.length,
    questionIndex: room.questionIndex,
    playersCount: room.players.size,
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
    if (conn.role === 'player') {
      const p = room.players.get(conn.playerId);
      base.answered = !!(p && p.answers.has(room.questionIndex));
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
    base.showRanking = room.quiz.showRanking;
    if (room.quiz.showRanking) {
      // top 10 — o telão exibe em duas colunas de 5
      base.leaderboard = leaderboard(room).slice(0, 10)
        .map(p => ({ ...p, delta: room.rankDeltas.get(p.id) || 0 }));
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
  room.questionTimer = setTimeout(() => reveal(room), questionLimitMs(room) + REVEAL_DELAY_MS);
  touch(room);
  broadcast(room);
}

function reveal(room) {
  if (room.state !== 'question') return;
  clearTimeout(room.questionTimer);
  room.state = 'reveal';
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
  } else if (q.type === 'wordcloud') {
    // Aceita uma string (clientes antigos) ou uma lista de até maxAnswers textos
    const raw = Array.isArray(body.answer) ? body.answer : [body.answer];
    const seen = new Set();
    const texts = [];
    for (const item of raw) {
      if (typeof item !== 'string' && typeof item !== 'number') continue;
      const text = String(item).trim().replace(/\s+/g, ' ').slice(0, 30);
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

  // POST /api/rooms/:pin/join — participante entra na sala
  if (req.method === 'POST' && action === '/join') {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'Informe seu nome.' });
    if (room.state === 'podium') return json(res, 409, { error: 'Este jogo já foi encerrado.' });
    const taken = [...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase());
    if (taken) return json(res, 409, { error: 'Já existe um participante com esse nome. Use outro.' });
    if (room.players.size >= 200) return json(res, 409, { error: 'A sala está cheia.' });
    const avatar = AVATARS.includes(body.avatar)
      ? body.avatar
      : AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const playerId = uid();
    room.players.set(playerId, {
      name, avatar, score: 0, streak: 0, correctCount: 0, answers: new Map(),
    });
    touch(room);
    broadcast(room);
    return json(res, 201, { playerId, name, avatar });
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

  // POST /api/rooms/:pin/answer — participante responde a questão atual
  if (req.method === 'POST' && action === '/answer') {
    const body = await readBody(req);
    const player = room.players.get(String(body.playerId || ''));
    if (!player) return json(res, 403, { error: 'Participante não encontrado.' });
    if (room.state !== 'question' || body.questionIndex !== room.questionIndex) {
      return json(res, 409, { error: 'Fora do tempo de resposta.' });
    }
    if (player.answers.has(room.questionIndex)) {
      return json(res, 409, { error: 'Você já respondeu esta questão.' });
    }
    const result = registerAnswer(room, player, body);
    if (result.error) return json(res, result.status, { error: result.error });
    touch(room);

    // Todos responderam? Revela na hora.
    if (answeredCount(room) >= room.players.size) {
      reveal(room);
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
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* ignora */ }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      room.connections.delete(conn);
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
