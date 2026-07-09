/* ===== Quiz Copérdia — jogo ao vivo (estilo Kahoot) ===== */

const Live = (() => {
  const COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];
  const SHAPES = ['▲', '◆', '●', '■', '★', '⬟'];

  let es = null;            // EventSource ativo
  let countdown = null;     // interval do timer visual

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function stop() {
    if (es) { es.close(); es = null; }
    if (countdown) { clearInterval(countdown); countdown = null; }
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro de comunicação com o servidor.');
    return data;
  }

  function listen(pin, params, onState, onError) {
    stop();
    es = new EventSource(`/api/rooms/${pin}/events?${params}`);
    es.onmessage = e => onState(JSON.parse(e.data));
    es.onerror = () => { if (onError) onError(); };
  }

  function startCountdown(container, remainingMs, limitMs) {
    if (countdown) clearInterval(countdown);
    const deadline = Date.now() + remainingMs;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      const valueEl = container.querySelector('#live-timer-value');
      const fillEl = container.querySelector('#live-timer-fill');
      if (!valueEl || !fillEl) { clearInterval(countdown); return; }
      valueEl.textContent = Math.ceil(left / 1000);
      fillEl.style.width = `${(left / limitMs) * 100}%`;
      if (left <= 5000) {
        valueEl.parentElement.classList.add('warning');
        fillEl.classList.add('warning');
      }
      if (left <= 0) clearInterval(countdown);
    };
    tick();
    countdown = setInterval(tick, 250);
  }

  function timerHeader(s, extra) {
    return `
      <div class="quiz-header">
        <span class="quiz-progress-text">Questão ${s.questionIndex + 1} de ${s.totalQuestions}${extra || ''}</span>
        <span class="timer">⏱️ <span id="live-timer-value">${Math.ceil(s.remainingMs / 1000)}</span>s</span>
      </div>
      <div class="timer-track"><div class="timer-fill" id="live-timer-fill" style="width:${(s.remainingMs / s.limitMs) * 100}%"></div></div>
    `;
  }

  // Botões/faixas coloridas das alternativas (telão e celular)
  function optionsHtml(q, { tappable = false, corrects = null, counts = null, selected = [] } = {}) {
    const tf = q.type === 'tf';
    return `
      <div class="live-options ${tappable ? 'tappable' : ''} ${tf ? 'tf' : ''}">
        ${q.options.map((o, i) => {
          const color = tf ? (i === 0 ? 'blue' : 'red') : COLORS[i];
          const shape = tf ? (i === 0 ? '✔' : '✖') : SHAPES[i];
          const isCorrect = corrects && corrects.includes(i);
          const dim = corrects && !isCorrect ? 'is-dim' : '';
          const sel = selected.includes(i) ? 'is-selected' : '';
          const tag = tappable ? 'button' : 'div';
          const img = q.optionImages && q.optionImages[i];
          return `
            <${tag} class="live-option ${color} ${corrects ? (isCorrect ? 'is-correct' : dim) : ''} ${sel}" data-index="${i}">
              <span class="shape">${shape}</span>
              ${img ? `<img class="opt-img" src="${img}" alt="">` : ''}
              <span style="flex:1">${esc(o)} ${isCorrect ? '✔' : ''}</span>
              ${counts ? `<span class="count">${counts[i]}</span>` : ''}
            </${tag}>`;
        }).join('')}
      </div>
    `;
  }

  // Imagem de mídia da pergunta (quando cadastrada)
  function mediaHtml(q, size) {
    return q.image ? `<div class="q-media ${size || ''}"><img src="${q.image}" alt=""></div>` : '';
  }

  function cloudHtml(words) {
    if (!words || words.length === 0) {
      return '<p class="muted" style="text-align:center;padding:24px 0">Nenhuma resposta recebida.</p>';
    }
    const max = words[0].count;
    return `
      <div class="word-cloud">
        ${words.map((w, i) => {
          const scale = 0.9 + (w.count / max) * 1.6;
          return `<span class="cloud-word c${i % 5}" style="font-size:${scale.toFixed(2)}rem">${esc(w.text)}${w.count > 1 ? `<small>×${w.count}</small>` : ''}</span>`;
        }).join('')}
      </div>
    `;
  }

  /* ==================== INSTRUTOR (host) ==================== */

  const Host = { pin: null, token: null, saved: false };

  async function renderHost(container, trainingId) {
    stop();
    const training = Store.getTraining(trainingId);
    if (!training || training.questions.length === 0) {
      container.innerHTML = `
        <div class="card empty-state">
          <div class="big">🔎</div>
          <p>Treinamento não encontrado ou sem questões.</p>
          <div class="btn-row" style="justify-content:center"><a href="#/admin" class="btn btn-primary">Administração</a></div>
        </div>`;
      return;
    }

    container.innerHTML = '<div class="card empty-state"><div class="big">⏳</div><p>Criando sala do jogo...</p></div>';

    // Embaralha a ordem das questões, se configurado no treinamento
    const quiz = { ...training };
    if (training.shuffleQuestions) {
      const qs = training.questions.slice();
      for (let i = qs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [qs[i], qs[j]] = [qs[j], qs[i]];
      }
      quiz.questions = qs;
    }

    try {
      const { pin, hostToken } = await api('/api/rooms', { quiz });
      Host.pin = pin;
      Host.token = hostToken;
      Host.saved = false;
      listen(pin, `hostToken=${encodeURIComponent(hostToken)}`, s => drawHost(container, s), () => {
        const note = container.querySelector('#conn-note');
        if (note) note.textContent = 'Reconectando...';
      });
    } catch (err) {
      container.innerHTML = `
        <div class="card empty-state">
          <div class="big">⚠️</div>
          <p>${esc(err.message)}</p>
          <div class="btn-row" style="justify-content:center"><a href="#/admin" class="btn btn-primary">Voltar</a></div>
        </div>`;
    }
  }

  async function hostCommand(container, command) {
    try {
      await api(`/api/rooms/${Host.pin}/action`, { hostToken: Host.token, command });
    } catch (err) {
      alert(err.message);
    }
  }

  function drawHost(container, s) {
    if (s.state === 'lobby') return drawHostLobby(container, s);
    if (s.state === 'question') return drawHostQuestion(container, s);
    if (s.state === 'reveal') return drawHostReveal(container, s);
    if (s.state === 'podium') return drawHostPodium(container, s);
  }

  function joinUrl() {
    return `${location.origin}${location.pathname}#/join/${Host.pin}`;
  }

  function drawQr(container) {
    const el = container.querySelector('#qr-box');
    if (!el || typeof qrcode !== 'function') return;
    try {
      const qr = qrcode(0, 'M'); // 0 = tamanho automático
      qr.addData(joinUrl());
      qr.make();
      el.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch {
      el.style.display = 'none';
    }
  }

  function drawHostLobby(container, s) {
    const url = joinUrl();
    const shareText = `Participe do quiz "${s.quizName}"! Acesse ${url} ou entre em ${location.host} com o PIN ${Host.pin}.`;
    container.innerHTML = `
      <div class="card live-hero">
        <p class="muted">${esc(s.quizName)}</p>
        <div class="lobby-grid">
          <div>
            <h1 style="margin:6px 0">Entre em <strong>${esc(location.host)}</strong></h1>
            <p class="muted">e digite o PIN do jogo:</p>
            <div class="game-pin">${Host.pin}</div>
            <div class="btn-row" style="justify-content:center">
              <button class="btn btn-secondary btn-sm" id="btn-copy">📋 Copiar link</button>
              <a class="btn btn-whatsapp btn-sm" id="btn-whats" target="_blank" rel="noopener"
                 href="https://wa.me/?text=${encodeURIComponent(shareText)}">💬 WhatsApp</a>
            </div>
          </div>
          <div class="qr-wrap">
            <div id="qr-box"></div>
            <p class="muted" style="font-size:0.78rem">Aponte a câmera para entrar direto</p>
          </div>
        </div>
        <p class="muted" id="conn-note"></p>
      </div>
      <div class="card">
        <div class="quiz-header">
          <h2 style="margin:0">Participantes (${s.playersCount})</h2>
          <button class="btn btn-primary" id="btn-start" ${s.playersCount === 0 ? 'disabled' : ''}>▶ Iniciar jogo</button>
        </div>
        <div class="player-chips">
          ${s.players && s.players.length
            ? s.players.map(n => `<span class="chip">${esc(n)}</span>`).join('')
            : '<p class="muted">Aguardando participantes entrarem...</p>'}
        </div>
      </div>
    `;
    drawQr(container);
    container.querySelector('#btn-start').addEventListener('click', () => hostCommand(container, 'start'));
    container.querySelector('#btn-copy').addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(url); } catch {
        const inp = document.createElement('input');
        inp.value = url; document.body.appendChild(inp); inp.select();
        document.execCommand('copy'); inp.remove();
      }
      e.target.textContent = '✔ Copiado!';
      setTimeout(() => { e.target.textContent = '📋 Copiar link'; }, 1800);
    });
  }

  function drawHostQuestion(container, s) {
    const q = s.question;
    container.innerHTML = `
      <div class="card">
        ${timerHeader(s, ` — PIN ${Host.pin}`)}
        <p class="question-text" style="font-size:1.5rem;text-align:center">${esc(q.text)}</p>
        ${mediaHtml(q)}
        ${q.type === 'wordcloud' ? `
          <div class="empty-state" style="padding:26px 0">
            <div class="big">☁️</div>
            <p class="muted">Os participantes estão digitando as respostas nos celulares...</p>
          </div>
        ` : optionsHtml(q)}
        ${q.multi ? '<p class="muted" style="text-align:center;margin-top:10px">Múltipla escolha: selecione todas as corretas e envie</p>' : ''}
        <div class="quiz-header" style="margin-top:16px">
          <span class="quiz-progress-text">✋ ${s.answeredCount}/${s.playersCount} responderam</span>
          <button class="btn btn-secondary" id="btn-reveal">Encerrar tempo</button>
        </div>
      </div>
    `;
    startCountdown(container, s.remainingMs, s.limitMs);
    container.querySelector('#btn-reveal').addEventListener('click', () => hostCommand(container, 'reveal'));
  }

  function drawHostReveal(container, s) {
    if (countdown) clearInterval(countdown);
    const q = s.question;
    let body;
    if (q.type === 'wordcloud') {
      body = cloudHtml(s.words);
    } else {
      const total = (s.counts || []).reduce((a, b) => a + b, 0) || 1;
      body = `
        ${optionsHtml(q, { corrects: s.corrects || null, counts: s.counts })}
        <div class="dist-bars">
          ${q.options.map((o, i) => {
            const color = q.type === 'tf' ? (i === 0 ? 'blue' : 'red') : COLORS[i];
            return `<div class="dist-bar ${color}" style="height:${Math.max(6, (s.counts[i] / total) * 90)}px" title="${s.counts[i]}"></div>`;
          }).join('')}
        </div>
      `;
    }
    const scored = q.type === 'quiz' || q.type === 'tf';
    const deltaBadge = d => d > 0
      ? `<span class="rank-delta up">▲ ${d}</span>`
      : d < 0 ? `<span class="rank-delta down">▼ ${-d}</span>` : '<span class="rank-delta">—</span>';
    container.innerHTML = `
      <div class="card">
        <div class="quiz-header">
          <span class="quiz-progress-text">Questão ${s.questionIndex + 1} de ${s.totalQuestions} — ${scored ? 'resultado' : 'respostas'}</span>
        </div>
        <p class="question-text" style="font-size:1.3rem;text-align:center">${esc(q.text)}</p>
        ${mediaHtml(q, 'small')}
        ${body}
      </div>
      <div class="card">
        ${!scored ? '<p class="muted">Esta pergunta não vale pontos — obrigado pelas opiniões! 💬</p>'
          : s.showRanking ? `
          <h2>🏆 Ranking parcial</h2>
          ${s.leaderboard.map(p => `
            <div class="rank-row">
              <span class="rank-pos">${p.rank}º</span>
              ${deltaBadge(p.delta)}
              <span class="rank-name">${esc(p.name)}</span>
              <span class="rank-score">${p.score} pts</span>
            </div>`).join('')}
        ` : '<p class="muted">Ranking oculto durante o jogo — a classificação aparece no pódio final. 🤫</p>'}
        <div class="btn-row" style="justify-content:flex-end">
          <button class="btn btn-primary" id="btn-next">${s.isLast ? '🏁 Ver pódio' : 'Próxima questão →'}</button>
        </div>
      </div>
    `;
    container.querySelector('#btn-next').addEventListener('click', () => hostCommand(container, 'next'));
  }

  function drawHostPodium(container, s) {
    if (countdown) clearInterval(countdown);

    // Grava os resultados no registro local do instrutor (uma vez por jogo)
    if (!Host.saved) {
      Host.saved = true;
      s.results.forEach(r => {
        Store.addResult({
          trainingId: 'live-' + Host.pin,
          trainingName: s.quizName + ' (ao vivo)',
          participant: r.name,
          correct: r.correct,
          total: s.scorableTotal,
          score: r.percent,
          passed: r.passed,
          durationSec: 0,
          date: new Date().toISOString(),
        });
      });
    }

    const podium = s.leaderboard.slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];
    container.innerHTML = `
      <div class="card live-hero">
        <h1>🏁 Fim de jogo!</h1>
        <p class="subtitle">${esc(s.quizName)}</p>
        <div class="podium">
          ${[1, 0, 2].filter(i => podium[i]).map(i => `
            <div class="podium-place p${i + 1}">
              <div class="medal">${medals[i]}</div>
              <div class="podium-name">${esc(podium[i].name)}</div>
              <div class="podium-score">${podium[i].score} pts</div>
              <div class="podium-bar"></div>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <h2>Resultado final (${s.results.length} participantes)</h2>
        <p class="muted" style="margin-bottom:12px">
          ${s.scorableTotal > 0
            ? `Aprovação a partir de ${s.passScore}% de acerto nas ${s.scorableTotal} questões que valem nota. Resultados gravados na aba Resultados da administração.`
            : 'Este quiz não possui questões que valem nota.'}
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Participante</th><th>Pontos</th><th>Acertos</th><th>Nota</th><th>Situação</th></tr></thead>
            <tbody>
              ${s.results.map(r => `
                <tr>
                  <td>${r.rank}º</td>
                  <td>${esc(r.name)}</td>
                  <td>${r.score}</td>
                  <td>${r.correct}/${s.scorableTotal}</td>
                  <td><strong>${r.percent === null ? '—' : r.percent + '%'}</strong></td>
                  <td>${r.passed === null
                    ? '<span class="pill">Participou</span>'
                    : `<span class="pill ${r.passed ? 'pill-pass' : 'pill-fail'}">${r.passed ? 'Aprovado' : 'Reprovado'}</span>`}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="btn-row">
          <a href="#/admin" class="btn btn-primary">Ir para a administração</a>
          <a href="#/" class="btn btn-ghost">Tela inicial</a>
        </div>
      </div>
    `;
  }

  /* ==================== PARTICIPANTE (player) ==================== */

  const Player = { pin: null, id: null, name: null };

  async function join(pin, name) {
    const data = await api(`/api/rooms/${pin}/join`, { name });
    Player.pin = pin;
    Player.id = data.playerId;
    Player.name = data.name;
    sessionStorage.setItem('qc_player', JSON.stringify(Player));
    return data;
  }

  function restoreSession(pin) {
    try {
      const saved = JSON.parse(sessionStorage.getItem('qc_player'));
      if (saved && saved.pin === pin && saved.id) {
        Object.assign(Player, saved);
        return true;
      }
    } catch { /* ignora */ }
    return false;
  }

  function renderPlayer(container, pin) {
    stop();
    if (!restoreSession(pin) || Player.pin !== pin) {
      location.hash = '#/';
      return;
    }
    listen(pin, `playerId=${encodeURIComponent(Player.id)}`, s => drawPlayer(container, s), () => {
      const note = container.querySelector('#conn-note');
      if (note) note.textContent = 'Reconectando...';
    });
  }

  function drawPlayer(container, s) {
    if (s.state === 'lobby') return drawPlayerLobby(container, s);
    if (s.state === 'question') return drawPlayerQuestion(container, s);
    if (s.state === 'reveal') return drawPlayerReveal(container, s);
    if (s.state === 'podium') return drawPlayerPodium(container, s);
  }

  function drawPlayerLobby(container, s) {
    container.innerHTML = `
      <div class="card live-hero">
        <div class="big" style="font-size:3rem">🎉</div>
        <h1>Você está dentro, ${esc(Player.name)}!</h1>
        <p class="subtitle">${esc(s.quizName)}</p>
        <p class="muted">Veja seu nome no telão e aguarde o instrutor iniciar o jogo.</p>
        <p class="muted" id="conn-note"></p>
      </div>
    `;
  }

  async function sendAnswer(container, s, answer) {
    try {
      await api(`/api/rooms/${Player.pin}/answer`, {
        playerId: Player.id,
        questionIndex: s.questionIndex,
        answer,
      });
      drawWaiting(container);
    } catch { /* fora do tempo — o próximo snapshot resolve a tela */ }
  }

  function drawWaiting(container) {
    container.innerHTML = `
      <div class="card live-hero">
        <div class="big" style="font-size:3rem">⚡</div>
        <h1>Resposta enviada!</h1>
        <p class="muted">Aguardando os demais participantes...</p>
      </div>
    `;
  }

  function drawPlayerQuestion(container, s) {
    if (s.answered) return drawWaiting(container);
    const q = s.question;

    // Nuvem de palavras: campo de texto livre
    if (q.type === 'wordcloud') {
      container.innerHTML = `
        <div class="card">
          ${timerHeader(s)}
          <p class="question-text">${esc(q.text)}</p>
          ${mediaHtml(q, 'small')}
          <div class="field">
            <input type="text" id="cloud-answer" maxlength="30" placeholder="Digite sua resposta (1 a 3 palavras)" autocomplete="off">
          </div>
          <button class="btn btn-primary btn-lg" id="btn-send">Enviar resposta</button>
        </div>
      `;
      startCountdown(container, s.remainingMs, s.limitMs);
      const input = container.querySelector('#cloud-answer');
      const send = () => {
        const text = input.value.trim();
        if (!text) { input.focus(); return; }
        sendAnswer(container, s, text);
      };
      container.querySelector('#btn-send').addEventListener('click', send);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
      input.focus();
      return;
    }

    // Quiz múltipla escolha: seleciona várias e envia
    if (q.multi) {
      container.innerHTML = `
        <div class="card">
          ${timerHeader(s)}
          <p class="question-text">${esc(q.text)}</p>
          ${mediaHtml(q, 'small')}
          <p class="muted" style="margin-bottom:10px">Selecione todas as corretas e toque em Enviar.</p>
          ${optionsHtml(q, { tappable: true })}
          <button class="btn btn-primary btn-lg" id="btn-send" style="margin-top:14px" disabled>Enviar</button>
        </div>
      `;
      startCountdown(container, s.remainingMs, s.limitMs);
      const selected = new Set();
      const sendBtn = container.querySelector('#btn-send');
      container.querySelectorAll('.live-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.index);
          if (selected.has(i)) { selected.delete(i); btn.classList.remove('is-selected'); }
          else { selected.add(i); btn.classList.add('is-selected'); }
          sendBtn.disabled = selected.size === 0;
        });
      });
      sendBtn.addEventListener('click', () => {
        sendAnswer(container, s, [...selected].sort((a, b) => a - b));
      });
      return;
    }

    // Quiz seleção simples / verdadeiro-falso / enquete: um toque responde
    container.innerHTML = `
      <div class="card">
        ${timerHeader(s)}
        <p class="question-text">${esc(q.text)}</p>
        ${mediaHtml(q, 'small')}
        ${optionsHtml(q, { tappable: true })}
      </div>
    `;
    startCountdown(container, s.remainingMs, s.limitMs);
    container.querySelectorAll('.live-option').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.live-option').forEach(b => { b.disabled = true; });
        sendAnswer(container, s, Number(btn.dataset.index));
      });
    });
  }

  function drawPlayerReveal(container, s) {
    if (countdown) clearInterval(countdown);
    const me = s.me || {};
    const scored = s.question.type === 'quiz' || s.question.type === 'tf';

    if (!scored) {
      container.innerHTML = `
        <div class="card live-hero">
          <div class="big" style="font-size:3rem">${me.answered ? '💬' : '⏰'}</div>
          <h1>${me.answered ? 'Obrigado pela sua opinião!' : 'Tempo esgotado!'}</h1>
          <p class="muted">Veja as respostas de todos no telão.</p>
        </div>
      `;
      return;
    }

    let icon, title, detail;
    if (!me.answered) {
      icon = '⏰'; title = 'Tempo esgotado!'; detail = 'Você não respondeu esta questão.';
    } else if (me.correct) {
      icon = '✅'; title = 'Resposta certa!'; detail = `+${me.points} pontos${me.streak > 1 ? ` • 🔥 ${me.streak} acertos seguidos` : ''}`;
    } else {
      icon = '❌'; title = 'Não foi dessa vez...'; detail = 'A resposta correta está destacada no telão.';
    }
    const deltaMsg = me.delta > 0
      ? `<p class="rank-move up">🔺 Você subiu ${me.delta} ${me.delta === 1 ? 'posição' : 'posições'}!</p>`
      : me.delta < 0
        ? `<p class="rank-move down">🔻 Você caiu ${-me.delta} ${me.delta === -1 ? 'posição' : 'posições'}.</p>`
        : '';
    container.innerHTML = `
      <div class="card live-hero ${me.correct ? 'hero-correct' : 'hero-wrong'}">
        <div class="big" style="font-size:3rem">${icon}</div>
        <h1>${title}</h1>
        <p class="subtitle">${detail}</p>
        <div class="result-stats">
          <div class="stat"><strong>${me.score ?? 0}</strong><span>pontos</span></div>
          ${me.rank ? `<div class="stat"><strong>${me.rank}º</strong><span>posição</span></div>` : ''}
        </div>
        ${me.rank ? deltaMsg : ''}
      </div>
    `;
  }

  function drawPlayerPodium(container, s) {
    if (countdown) clearInterval(countdown);
    const me = s.me || {};
    container.innerHTML = `
      <div class="card live-hero">
        <div class="big" style="font-size:3rem">${me.rank === 1 ? '🥇' : me.rank === 2 ? '🥈' : me.rank === 3 ? '🥉' : '🏁'}</div>
        <h1>${me.rank ? me.rank + 'º lugar' : 'Fim de jogo'}</h1>
        <p class="subtitle">${esc(s.quizName)}</p>
        ${me.passed === null ? '' : `
          <span class="badge ${me.passed ? 'badge-pass' : 'badge-fail'}">
            ${me.passed ? '✅ Aprovado' : '❌ Não atingiu a nota mínima'}
          </span>`}
        <div class="result-stats">
          <div class="stat"><strong>${me.score ?? 0}</strong><span>pontos</span></div>
          ${s.scorableTotal > 0 ? `
            <div class="stat"><strong>${me.correct ?? 0}/${s.scorableTotal}</strong><span>acertos</span></div>
            <div class="stat"><strong>${me.percent ?? 0}%</strong><span>nota (mín. ${s.passScore}%)</span></div>
          ` : ''}
        </div>
        <div class="btn-row" style="justify-content:center">
          <a href="#/" class="btn btn-primary">Concluir</a>
        </div>
      </div>
    `;
    sessionStorage.removeItem('qc_player');
  }

  return { renderHost, renderPlayer, join, stop };
})();
