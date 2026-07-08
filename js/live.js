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

  function timerBar(remainingMs, limitMs) {
    return `
      <div class="quiz-header" style="justify-content:flex-end">
        <span class="timer">⏱️ <span id="live-timer-value">${Math.ceil(remainingMs / 1000)}</span>s</span>
      </div>
      <div class="timer-track"><div class="timer-fill" id="live-timer-fill" style="width:${(remainingMs / limitMs) * 100}%"></div></div>
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

  function drawHostLobby(container, s) {
    const joinUrl = `${location.origin}${location.pathname}`;
    container.innerHTML = `
      <div class="card live-hero">
        <p class="muted">${esc(s.quizName)}</p>
        <h1 style="margin:6px 0">Entre em <strong>${esc(joinUrl.replace(/^https?:\/\//, ''))}</strong></h1>
        <p class="muted">e digite o PIN do jogo:</p>
        <div class="game-pin">${Host.pin}</div>
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
    container.querySelector('#btn-start').addEventListener('click', () => hostCommand(container, 'start'));
  }

  function drawHostQuestion(container, s) {
    container.innerHTML = `
      <div class="card">
        <div class="quiz-header">
          <span class="quiz-progress-text">Questão ${s.questionIndex + 1} de ${s.totalQuestions} — PIN ${Host.pin}</span>
          <span class="quiz-progress-text">✋ ${s.answeredCount}/${s.playersCount} responderam</span>
        </div>
        ${timerBar(s.remainingMs, s.limitMs)}
        <p class="question-text" style="font-size:1.5rem;text-align:center">${esc(s.question.text)}</p>
        <div class="live-options">
          ${s.question.options.map((o, i) => `
            <div class="live-option ${COLORS[i]}">
              <span class="shape">${SHAPES[i]}</span><span>${esc(o)}</span>
            </div>`).join('')}
        </div>
        <div class="btn-row" style="justify-content:flex-end">
          <button class="btn btn-secondary" id="btn-reveal">Encerrar tempo</button>
        </div>
      </div>
    `;
    startCountdown(container, s.remainingMs, s.limitMs);
    container.querySelector('#btn-reveal').addEventListener('click', () => hostCommand(container, 'reveal'));
  }

  function drawHostReveal(container, s) {
    if (countdown) clearInterval(countdown);
    const totalAnswers = s.counts.reduce((a, b) => a + b, 0) || 1;
    container.innerHTML = `
      <div class="card">
        <div class="quiz-header">
          <span class="quiz-progress-text">Questão ${s.questionIndex + 1} de ${s.totalQuestions} — resultado</span>
        </div>
        <p class="question-text" style="font-size:1.3rem;text-align:center">${esc(s.question.text)}</p>
        <div class="live-options">
          ${s.question.options.map((o, i) => `
            <div class="live-option ${COLORS[i]} ${i === s.correct ? 'is-correct' : 'is-dim'}">
              <span class="shape">${SHAPES[i]}</span>
              <span style="flex:1">${esc(o)} ${i === s.correct ? '✔' : ''}</span>
              <span class="count">${s.counts[i]}</span>
            </div>`).join('')}
        </div>
        <div class="dist-bars">
          ${s.question.options.map((o, i) => `
            <div class="dist-bar ${COLORS[i]}" style="height:${Math.max(6, (s.counts[i] / totalAnswers) * 90)}px" title="${s.counts[i]}"></div>
          `).join('')}
        </div>
      </div>
      <div class="card">
        <h2>🏆 Ranking parcial</h2>
        ${s.leaderboard.map(p => `
          <div class="rank-row">
            <span class="rank-pos">${p.rank}º</span>
            <span class="rank-name">${esc(p.name)}</span>
            <span class="rank-score">${p.score} pts</span>
          </div>`).join('')}
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
          total: s.totalQuestions,
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
        <p class="muted" style="margin-bottom:12px">Aprovação a partir de ${s.passScore}% de acerto. Resultados gravados na aba Resultados da administração.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Participante</th><th>Pontos</th><th>Acertos</th><th>Nota</th><th>Situação</th></tr></thead>
            <tbody>
              ${s.results.map(r => `
                <tr>
                  <td>${r.rank}º</td>
                  <td>${esc(r.name)}</td>
                  <td>${r.score}</td>
                  <td>${r.correct}/${s.totalQuestions}</td>
                  <td><strong>${r.percent}%</strong></td>
                  <td><span class="pill ${r.passed ? 'pill-pass' : 'pill-fail'}">${r.passed ? 'Aprovado' : 'Reprovado'}</span></td>
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

  function drawPlayerQuestion(container, s) {
    // Já respondeu? Tela de espera.
    if (s.myAnswer != null) {
      container.innerHTML = `
        <div class="card live-hero">
          <div class="big" style="font-size:3rem">⚡</div>
          <h1>Resposta enviada!</h1>
          <p class="muted">Aguardando os demais participantes...</p>
        </div>
      `;
      return;
    }
    container.innerHTML = `
      <div class="card">
        <div class="quiz-header">
          <span class="quiz-progress-text">Questão ${s.questionIndex + 1} de ${s.totalQuestions}</span>
          <span class="timer">⏱️ <span id="live-timer-value">${Math.ceil(s.remainingMs / 1000)}</span>s</span>
        </div>
        <div class="timer-track"><div class="timer-fill" id="live-timer-fill" style="width:${(s.remainingMs / s.limitMs) * 100}%"></div></div>
        <p class="question-text">${esc(s.question.text)}</p>
        <div class="live-options tappable">
          ${s.question.options.map((o, i) => `
            <button class="live-option ${COLORS[i]}" data-answer="${i}">
              <span class="shape">${SHAPES[i]}</span><span>${esc(o)}</span>
            </button>`).join('')}
        </div>
      </div>
    `;
    startCountdown(container, s.remainingMs, s.limitMs);
    container.querySelectorAll('.live-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        container.querySelectorAll('.live-option').forEach(b => { b.disabled = true; });
        try {
          await api(`/api/rooms/${Player.pin}/answer`, {
            playerId: Player.id,
            questionIndex: s.questionIndex,
            answer: Number(btn.dataset.answer),
          });
        } catch { /* fora do tempo — o próximo snapshot resolve a tela */ }
      });
    });
  }

  function drawPlayerReveal(container, s) {
    if (countdown) clearInterval(countdown);
    const me = s.me || {};
    let icon, title, detail;
    if (!me.answered) {
      icon = '⏰'; title = 'Tempo esgotado!'; detail = 'Você não respondeu esta questão.';
    } else if (me.correct) {
      icon = '✅'; title = 'Resposta certa!'; detail = `+${me.points} pontos${me.streak > 1 ? ` • 🔥 ${me.streak} acertos seguidos` : ''}`;
    } else {
      icon = '❌'; title = 'Não foi dessa vez...'; detail = 'A resposta correta está destacada no telão.';
    }
    container.innerHTML = `
      <div class="card live-hero ${me.correct ? 'hero-correct' : 'hero-wrong'}">
        <div class="big" style="font-size:3rem">${icon}</div>
        <h1>${title}</h1>
        <p class="subtitle">${detail}</p>
        <div class="result-stats">
          <div class="stat"><strong>${me.score ?? 0}</strong><span>pontos</span></div>
          <div class="stat"><strong>${me.rank ? me.rank + 'º' : '-'}</strong><span>posição</span></div>
        </div>
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
        <span class="badge ${me.passed ? 'badge-pass' : 'badge-fail'}">
          ${me.passed ? '✅ Aprovado' : '❌ Não atingiu a nota mínima'}
        </span>
        <div class="result-stats">
          <div class="stat"><strong>${me.score ?? 0}</strong><span>pontos</span></div>
          <div class="stat"><strong>${me.correct ?? 0}/${s.totalQuestions}</strong><span>acertos</span></div>
          <div class="stat"><strong>${me.percent ?? 0}%</strong><span>nota (mín. ${s.passScore}%)</span></div>
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
