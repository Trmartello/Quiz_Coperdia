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
const DEFAULT_TIME = 30;                // segundos por questão quando não definido
const REVEAL_DELAY_MS = 800;            // margem após o fim do tempo

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
      if (data.length > 1_000_000) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/* ==================== Modelo da sala ==================== */

function sanitizeQuiz(quiz) {
  if (!quiz || typeof quiz.name !== 'string' || !Array.isArray(quiz.questions)) return null;
  const questions = quiz.questions
    .filter(q => q && typeof q.text === 'string' && Array.isArray(q.options) &&
      q.options.length >= 2 && q.options.length <= 6 &&
      Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length)
    .map(q => ({
      text: String(q.text).slice(0, 500),
      options: q.options.map(o => String(o).slice(0, 300)),
      correct: q.correct,
    }));
  if (questions.length === 0) return null;
  const time = Number(quiz.timePerQuestion);
  return {
    name: String(quiz.name).slice(0, 200),
    passScore: Math.min(100, Math.max(0, Number(quiz.passScore) || 0)),
    timePerQuestion: time >= 5 && time <= 600 ? Math.round(time) : DEFAULT_TIME,
    questions,
  };
}

function createRoom(quiz) {
  const room = {
    pin: newPin(),
    hostToken: uid(),
    quiz,
    state: 'lobby', // lobby | question | reveal | podium
    questionIndex: -1,
    questionStartedAt: 0,
    questionTimer: null,
    players: new Map(), // playerId -> { name, score, streak, answers: Map(qIdx -> {answer, ms, points, correct}) }
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

// Pontuação estilo Kahoot: acerto vale 500 + até 500 pela velocidade
function computePoints(correct, elapsedMs, limitMs) {
  if (!correct) return 0;
  const ratio = Math.min(1, Math.max(0, elapsedMs / limitMs));
  return 500 + Math.round(500 * (1 - ratio));
}

function leaderboard(room) {
  return [...room.players.entries()]
    .map(([id, p]) => ({ id, name: p.name, score: p.score, correct: p.correctCount }))
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

function currentQuestion(room) {
  return room.quiz.questions[room.questionIndex] || null;
}

function answerCounts(room) {
  const q = currentQuestion(room);
  const counts = q ? q.options.map(() => 0) : [];
  for (const p of room.players.values()) {
    const a = p.answers.get(room.questionIndex);
    if (a && a.answer != null && counts[a.answer] !== undefined) counts[a.answer]++;
  }
  return counts;
}

function answeredCount(room) {
  let n = 0;
  for (const p of room.players.values()) {
    if (p.answers.has(room.questionIndex)) n++;
  }
  return n;
}

/* ==================== Snapshots por papel ==================== */

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
    base.players = [...room.players.values()].map(p => p.name);
  }

  if (room.state === 'question' && q) {
    const limitMs = room.quiz.timePerQuestion * 1000;
    base.question = { text: q.text, options: q.options };
    base.remainingMs = Math.max(0, limitMs - (Date.now() - room.questionStartedAt));
    base.limitMs = limitMs;
    base.answeredCount = answeredCount(room);
    if (conn.role === 'player') {
      const p = room.players.get(conn.playerId);
      const a = p && p.answers.get(room.questionIndex);
      base.myAnswer = a ? a.answer : null;
    }
  }

  if (room.state === 'reveal' && q) {
    base.question = { text: q.text, options: q.options };
    base.correct = q.correct;
    base.counts = answerCounts(room);
    base.leaderboard = leaderboard(room).slice(0, 5);
    base.isLast = room.questionIndex + 1 >= room.quiz.questions.length;
    if (conn.role === 'player') {
      const p = room.players.get(conn.playerId);
      const a = p ? p.answers.get(room.questionIndex) : null;
      const all = leaderboard(room);
      const me = all.find(x => x.id === conn.playerId);
      base.me = {
        answered: !!a,
        correct: !!(a && a.correct),
        points: a ? a.points : 0,
        score: p ? p.score : 0,
        rank: me ? me.rank : null,
        streak: p ? p.streak : 0,
      };
    }
  }

  if (room.state === 'podium') {
    const all = leaderboard(room);
    base.leaderboard = all;
    base.passScore = room.quiz.passScore;
    base.results = all.map(p => {
      const player = room.players.get(p.id);
      const pct = room.quiz.questions.length
        ? Math.round((player.correctCount / room.quiz.questions.length) * 100) : 0;
      return { ...p, percent: pct, passed: pct >= room.quiz.passScore };
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
  const limitMs = room.quiz.timePerQuestion * 1000;
  room.questionTimer = setTimeout(() => reveal(room), limitMs + REVEAL_DELAY_MS);
  touch(room);
  broadcast(room);
}

function reveal(room) {
  if (room.state !== 'question') return;
  clearTimeout(room.questionTimer);
  room.state = 'reveal';
  touch(room);
  broadcast(room);
}

function endGame(room) {
  clearTimeout(room.questionTimer);
  room.state = 'podium';
  touch(room);
  broadcast(room);
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
    const playerId = uid();
    room.players.set(playerId, {
      name, score: 0, streak: 0, correctCount: 0, answers: new Map(),
    });
    touch(room);
    broadcast(room);
    return json(res, 201, { playerId, name });
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
    const q = currentQuestion(room);
    const answer = Number(body.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= q.options.length) {
      return json(res, 400, { error: 'Resposta inválida.' });
    }
    const elapsedMs = Date.now() - room.questionStartedAt;
    const limitMs = room.quiz.timePerQuestion * 1000;
    if (elapsedMs > limitMs + REVEAL_DELAY_MS) return json(res, 409, { error: 'Tempo esgotado.' });

    const correct = answer === q.correct;
    const points = computePoints(correct, elapsedMs, limitMs);
    player.answers.set(room.questionIndex, { answer, ms: elapsedMs, correct, points });
    player.score += points;
    player.streak = correct ? player.streak + 1 : 0;
    if (correct) player.correctCount++;
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
      if (room.state !== 'reveal') return json(res, 409, { error: 'Ação indisponível agora.' });
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
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end('Internal Server Error');
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
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
