/* ===== Quiz Copérdia — jogo ao vivo (estilo Kahoot) ===== */

const Live = (() => {
  const COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];
  const SHAPES = ['▲', '◆', '●', '■', '★', '⬟'];
  // Mesma lista do servidor — reações rápidas permitidas
  const REACTIONS = ['👍','👏','❤️','😂','🤔','😮'];
  const TYPE_LABELS = {
    quiz: '🎯 Quiz', tf: '⚖️ Verdadeiro ou falso', short: '⌨️ Resposta curta',
    poll: '📊 Enquete', scale: '📏 Escala', wordcloud: '☁️ Nuvem de palavras', slide: '🖼️ Slide',
  };

  let es = null;            // EventSource ativo
  let countdown = null;     // interval do timer visual
  let lastSnap = null;      // último snapshot recebido (para decisões pós-await)
  // Evita redesenhar a mesma tela a cada snapshot (preserva digitação e animações)
  const View = { key: null };

  function viewOnce(key) {
    if (View.key === key) return false;
    View.key = key;
    return true;
  }

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
    View.key = null;
    es = new EventSource(`/api/rooms/${pin}/events?${params}`);
    es.onmessage = e => {
      lastSnap = JSON.parse(e.data);
      onState(lastSnap);
    };
    es.addEventListener('reaction', e => {
      try { spawnReaction(JSON.parse(e.data).emoji); } catch { /* ignora */ }
    });
    es.onerror = () => { if (onError) onError(); };
  }

  /* ---------- Reações emoji flutuantes (estilo Kahoot) ---------- */

  function reactionLayer() {
    let layer = document.getElementById('reaction-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'reaction-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  // Faz um emoji gigante subir flutuando pela tela
  function spawnReaction(emoji) {
    const layer = reactionLayer();
    if (layer.childElementCount > 40) return; // não sobrecarrega em salas grandes
    const el = document.createElement('span');
    el.className = 'float-emoji';
    el.textContent = emoji;
    el.style.left = (6 + Math.random() * 84) + '%';
    el.style.setProperty('--dur', (2.2 + Math.random() * 1.2).toFixed(2) + 's');
    el.style.setProperty('--rot', (Math.random() * 36 - 18).toFixed(0) + 'deg');
    el.style.fontSize = (1.8 + Math.random() * 1.4).toFixed(2) + 'rem';
    el.addEventListener('animationend', () => el.remove());
    layer.appendChild(el);
  }

  let lastReactAt = 0;
  function reactionBarHtml() {
    return `
      <div class="reaction-bar">
        ${REACTIONS.map(r => `<button type="button" class="reaction-btn" data-react="${r}">${r}</button>`).join('')}
      </div>
    `;
  }

  function wireReactionBar(container) {
    container.querySelectorAll('[data-react]').forEach(btn => {
      btn.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastReactAt < 600) return;
        lastReactAt = now;
        btn.classList.remove('reacted');
        void btn.offsetWidth; // reinicia a animação do botão
        btn.classList.add('reacted');
        api(`/api/rooms/${Player.pin}/react`, { playerId: Player.id, emoji: btn.dataset.react })
          .catch(() => { /* sala pode ter expirado — reação é opcional */ });
      });
    });
  }

  /* ---------- Introdução animada da questão (estilo Kahoot) ---------- */

  // Mostra por ~2,2s uma vinheta com nº, tipo e enunciado antes das alternativas
  function showQuestionIntro(s) {
    const q = s.question;
    const root = document.getElementById('modal-root');
    if (!root || root.querySelector('.q-intro')) return;
    const el = document.createElement('div');
    el.className = 'q-intro';
    el.innerHTML = `
      <span class="q-intro-num">${s.questionIndex + 1}</span>
      <span class="q-intro-type">${TYPE_LABELS[q.type] || 'Quiz'}</span>
      <p class="q-intro-text">${esc(q.text)}</p>
    `;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2400);
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

  // Botões 1–5 da escala, com rótulos nas pontas
  function scaleHtml(q, { tappable = false, counts = null } = {}) {
    const tag = tappable ? 'button' : 'div';
    return `
      <div class="scale-wrap">
        <div class="scale-row ${tappable ? 'tappable' : ''}">
          ${q.options.map((o, i) => `
            <${tag} class="scale-btn" data-index="${i}">
              <span class="scale-num">${esc(o)}</span>
              ${counts ? `<span class="count">${counts[i]}</span>` : ''}
            </${tag}>`).join('')}
        </div>
        ${(q.scaleLeft || q.scaleRight) ? `
          <div class="scale-labels">
            <span>${esc(q.scaleLeft || '')}</span>
            <span>${esc(q.scaleRight || '')}</span>
          </div>` : ''}
      </div>
    `;
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
    if (s.state === 'question') {
      // A mesma questão só é desenhada uma vez — os snapshots seguintes atualizam apenas o contador
      if (!viewOnce(`hq:${s.questionIndex}`)) {
        const el = container.querySelector('#host-answered');
        if (el && s.question && s.question.type !== 'slide') {
          el.textContent = `✋ ${s.answeredCount}/${s.playersCount} responderam`;
        }
        return;
      }
      return drawHostQuestion(container, s);
    }
    View.key = `h:${s.state}:${s.questionIndex}`;
    if (s.state === 'lobby') return drawHostLobby(container, s);
    if (s.state === 'reveal') return drawHostReveal(container, s);
    if (s.state === 'podium') return drawHostPodium(container, s);
  }

  function joinUrl() {
    return `${location.origin}${location.pathname}#/join/${Host.pin}`;
  }

  function qrSvg() {
    if (typeof qrcode !== 'function') return null;
    try {
      const qr = qrcode(0, 'M'); // 0 = tamanho automático
      qr.addData(joinUrl());
      qr.make();
      return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch {
      return null;
    }
  }

  function drawQr(container) {
    const el = container.querySelector('#qr-box');
    if (!el) return;
    const svg = qrSvg();
    if (!svg) { el.style.display = 'none'; return; }
    el.innerHTML = svg;
    el.title = 'Clique para ampliar';
    el.addEventListener('click', openQrZoom);
    const zoomBtn = container.querySelector('#btn-qr-zoom');
    if (zoomBtn) zoomBtn.addEventListener('click', openQrZoom);
  }

  // QR em tela cheia para leitura a longa distância (fora do #app: sobrevive aos re-renders do lobby)
  function openQrZoom() {
    const svg = qrSvg();
    if (!svg) return;
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="qr-zoom" role="dialog" aria-modal="true">
        <div class="qr-zoom-box">${svg}</div>
        <div class="qr-zoom-pin">PIN ${Host.pin}</div>
        <p>Aponte a câmera do celular • toque em qualquer lugar para fechar</p>
      </div>
    `;
    root.querySelector('.qr-zoom').addEventListener('click', () => { root.innerHTML = ''; });
  }

  function drawHostLobby(container, s) {
    const url = joinUrl();
    const shareText = `Participe do quiz "${s.quizName}"! Acesse ${url} ou entre em ${location.host} com o PIN ${Host.pin}.`;
    container.innerHTML = `
      <div class="lobby-layout">
        <div class="card live-hero lobby-main">
          <p class="muted">${esc(s.quizName)}</p>
          <h1 style="margin:6px 0">Entre em <strong>${esc(location.host)}</strong></h1>
          <p class="muted">e digite o PIN do jogo:</p>
          <div class="game-pin">${Host.pin}</div>
          <div class="qr-wrap">
            <div id="qr-box"></div>
            <p class="muted" style="font-size:0.78rem">Aponte a câmera para entrar direto</p>
          </div>
          <div class="btn-row" style="justify-content:center">
            <button class="btn btn-secondary btn-sm" id="btn-qr-zoom">🔍 Ampliar QR</button>
            <button class="btn btn-secondary btn-sm" id="btn-copy">📋 Copiar link</button>
            <a class="btn btn-whatsapp btn-sm" id="btn-whats" target="_blank" rel="noopener"
               href="https://wa.me/?text=${encodeURIComponent(shareText)}">💬 WhatsApp</a>
          </div>
          <p class="muted" id="conn-note"></p>
        </div>
        <div class="card lobby-side">
          <div class="quiz-header">
            <h2 style="margin:0">Participantes (${s.playersCount})</h2>
          </div>
          <div class="player-chips">
            ${s.players && s.players.length
              ? s.players.map((p, i) => `
                  <span class="chip">
                    <span class="chip-avatar" style="animation-delay:${(i % 7) * 0.25}s">${esc(p.avatar || '🙂')}</span>
                    ${esc(p.name)}
                  </span>`).join('')
              : '<p class="muted">Aguardando participantes entrarem...</p>'}
          </div>
          <button class="btn btn-primary btn-lg" id="btn-start" style="margin-top:16px" ${s.playersCount === 0 ? 'disabled' : ''}>▶ Iniciar jogo</button>
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
    const isSlide = q.type === 'slide';
    let body;
    if (isSlide) {
      body = `${q.body ? `<p class="slide-body">${esc(q.body)}</p>` : ''}`;
    } else if (q.type === 'wordcloud' || q.type === 'short') {
      body = `
        <div class="empty-state" style="padding:26px 0">
          <div class="big">${q.type === 'short' ? '⌨️' : '☁️'}</div>
          <p class="muted">Os participantes estão digitando as respostas nos celulares...</p>
          ${q.type === 'wordcloud' && (q.maxAnswers || 1) > 1 ? `<p class="muted">Cada participante pode enviar até ${q.maxAnswers} respostas.</p>` : ''}
        </div>`;
    } else if (q.type === 'scale') {
      body = scaleHtml(q);
    } else {
      body = optionsHtml(q);
    }
    container.innerHTML = `
      <div class="card">
        ${timerHeader(s, ` — PIN ${Host.pin}`)}
        <p class="question-text q-big">${esc(q.text)}</p>
        ${mediaHtml(q)}
        ${body}
        ${q.multi ? '<p class="muted" style="text-align:center;margin-top:10px">Múltipla escolha: selecione todas as corretas e envie</p>' : ''}
        <div class="quiz-header" style="margin-top:16px">
          <span class="quiz-progress-text" id="host-answered">${isSlide ? '' : `✋ ${s.answeredCount}/${s.playersCount} responderam`}</span>
          <button class="btn ${isSlide ? 'btn-primary' : 'btn-secondary'}" id="btn-reveal">${isSlide ? (s.questionIndex + 1 >= s.totalQuestions ? '🏁 Ver pódio' : 'Avançar →') : 'Encerrar tempo'}</button>
        </div>
      </div>
    `;
    startCountdown(container, s.remainingMs, s.limitMs);
    container.querySelector('#btn-reveal').addEventListener('click', () => hostCommand(container, isSlide ? 'next' : 'reveal'));
    showQuestionIntro(s);
  }

  function drawHostReveal(container, s) {
    if (countdown) clearInterval(countdown);
    const q = s.question;
    let body;
    if (q.type === 'wordcloud') {
      body = cloudHtml(s.words);
    } else if (q.type === 'short') {
      body = `
        <div class="accepted-answers">
          <p class="muted" style="margin-bottom:6px">Resposta${(s.acceptedAnswers || []).length > 1 ? 's aceitas' : ' aceita'}:</p>
          ${(s.acceptedAnswers || []).map(a => `<span class="pill pill-pass">✔ ${esc(a)}</span>`).join(' ')}
        </div>
        ${cloudHtml(s.words)}
      `;
    } else if (q.type === 'slide') {
      body = q.body ? `<p class="slide-body">${esc(q.body)}</p>` : '';
    } else if (q.type === 'scale') {
      const total = (s.counts || []).reduce((a, b) => a + b, 0) || 1;
      body = `
        ${scaleHtml(q, { counts: s.counts })}
        <div class="dist-bars">
          ${q.options.map((o, i) => {
            const pct = Math.round((s.counts[i] / total) * 100);
            return `
              <div class="dist-col">
                <span class="dist-count">${pct}%</span>
                <div class="dist-bar green" style="height:${Math.max(8, (s.counts[i] / total) * 170)}px"></div>
                <span class="dist-shape green">${esc(o)} <b>${s.counts[i]}</b></span>
              </div>`;
          }).join('')}
        </div>
      `;
    } else {
      const total = (s.counts || []).reduce((a, b) => a + b, 0) || 1;
      body = `
        ${optionsHtml(q, { corrects: s.corrects || null, counts: s.counts })}
        <div class="dist-bars">
          ${q.options.map((o, i) => {
            const color = q.type === 'tf' ? (i === 0 ? 'blue' : 'red') : COLORS[i];
            const shape = q.type === 'tf' ? (i === 0 ? '✔' : '✖') : SHAPES[i];
            const pct = Math.round((s.counts[i] / total) * 100);
            return `
              <div class="dist-col">
                <span class="dist-count">${pct}%</span>
                <div class="dist-bar ${color}" style="height:${Math.max(8, (s.counts[i] / total) * 170)}px"></div>
                <span class="dist-shape ${color}">${shape} <b>${s.counts[i]}</b></span>
              </div>`;
          }).join('')}
        </div>
      `;
    }
    const scored = q.type === 'quiz' || q.type === 'tf' || q.type === 'short';
    const deltaBadge = d => d > 0
      ? `<span class="rank-delta up">▲ ${d}</span>`
      : d < 0 ? `<span class="rank-delta down">▼ ${-d}</span>` : '<span class="rank-delta">—</span>';
    container.innerHTML = `
      <div class="reveal-layout">
        <div class="card">
          <div class="quiz-header">
            <span class="quiz-progress-text">Questão ${s.questionIndex + 1} de ${s.totalQuestions} — ${scored ? 'resultado' : 'respostas'}</span>
          </div>
          <p class="question-text q-big">${esc(q.text)}</p>
          ${mediaHtml(q, 'small')}
          ${body}
        </div>
        <div class="card reveal-side">
          ${q.type === 'slide' ? '<p class="muted">Slide de conteúdo — sem respostas. 📖</p>'
            : !scored ? '<p class="muted">Esta pergunta não vale pontos — obrigado pelas opiniões! 💬</p>'
            : s.showRanking ? `
            <h2 class="side-title">🏆 Ranking parcial</h2>
            <div class="rank-grid">
              ${s.leaderboard.map(p => `
                <div class="rank-row">
                  <span class="rank-pos">${p.rank}º</span>
                  ${deltaBadge(p.delta)}
                  <span class="rank-name"><span class="rank-avatar">${esc(p.avatar || '🙂')}</span> ${esc(p.name)}</span>
                  <span class="rank-score">${p.score} pts</span>
                </div>`).join('')}
            </div>
          ` : '<p class="muted">Ranking oculto durante o jogo — a classificação aparece no pódio final. 🤫</p>'}
          <button class="btn btn-primary" id="btn-next" style="width:100%;margin-top:12px">${s.isLast ? '🏁 Ver pódio' : 'Próxima questão →'}</button>
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
              <div class="podium-avatar">${esc(podium[i].avatar || '🙂')}</div>
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
                  <td>${esc(r.avatar || '')} ${esc(r.name)}</td>
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
          <button class="btn btn-secondary" id="btn-podium-csv">⬇ Baixar CSV</button>
          <button class="btn btn-secondary" id="btn-podium-pdf">🖨 Baixar PDF</button>
          <button class="btn btn-whatsapp" id="btn-podium-whats">💬 Compartilhar no WhatsApp</button>
        </div>
        <div class="btn-row">
          <a href="#/admin" class="btn btn-primary">Ir para a administração</a>
          <a href="#/" class="btn btn-ghost">Tela inicial</a>
        </div>
      </div>
    `;

    container.querySelector('#btn-podium-csv').addEventListener('click', () => exportCsv(s));
    container.querySelector('#btn-podium-pdf').addEventListener('click', () => exportPdf(s));
    container.querySelector('#btn-podium-whats').addEventListener('click', e => shareWhatsapp(s, e.target));
  }

  /* ---------- Exportações do pódio ---------- */

  function resultRows(s) {
    return s.results.map(r => ({
      rank: r.rank,
      name: r.name,
      avatar: r.avatar || '',
      score: r.score,
      correct: `${r.correct}/${s.scorableTotal}`,
      percent: r.percent === null ? '—' : r.percent + '%',
      status: r.passed === null ? 'Participou' : (r.passed ? 'Aprovado' : 'Reprovado'),
    }));
  }

  function exportCsv(s) {
    const header = ['Posicao', 'Participante', 'Pontos', 'Acertos', 'Nota (%)', 'Situacao'];
    const csvEsc = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [header.join(';')].concat(resultRows(s).map(r =>
      [r.rank + 'º', r.name, r.score, r.correct, r.percent, r.status].map(csvEsc).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `resultado-${s.quizName.replace(/[^\w\d-]+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Abre uma janela formatada para impressão — o usuário salva como PDF
  function exportPdf(s) {
    const rows = resultRows(s);
    const w = window.open('', '_blank');
    if (!w) { alert('Permita pop-ups para gerar o PDF.'); return; }
    w.document.write(`
      <!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Resultado — ${esc(s.quizName)}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1d1d1b; padding: 32px; }
        h1 { color: #0a6e31; margin-bottom: 2px; font-size: 1.4rem; }
        .sub { color: #667; margin-bottom: 4px; }
        .meta { color: #667; font-size: 0.85rem; margin-bottom: 22px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border-bottom: 1px solid #cfd8d2; text-align: left; padding: 9px 12px; font-size: 0.9rem; }
        th { color: #0a6e31; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.05em; }
        .pass { color: #0e9a44; font-weight: 700; }
        .fail { color: #d64545; font-weight: 700; }
        .top { background: #e7f5ec; }
        .footer { margin-top: 26px; font-size: 0.75rem; color: #889; }
        @media print { .no-print { display: none; } }
      </style></head><body>
      <h1>🎓 Quiz Copérdia — Resultado Final</h1>
      <p class="sub"><strong>${esc(s.quizName)}</strong></p>
      <p class="meta">${new Date().toLocaleString('pt-BR')} • ${rows.length} participante(s) •
        aprovação a partir de ${s.passScore}% em ${s.scorableTotal} questão(ões) que valem nota</p>
      <table>
        <thead><tr><th>#</th><th>Participante</th><th>Pontos</th><th>Acertos</th><th>Nota</th><th>Situação</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="${r.rank === 1 ? 'top' : ''}">
              <td>${r.rank}º</td><td>${r.avatar} ${esc(r.name)}</td><td>${r.score}</td>
              <td>${r.correct}</td><td><strong>${r.percent}</strong></td>
              <td class="${r.status === 'Aprovado' ? 'pass' : r.status === 'Reprovado' ? 'fail' : ''}">${r.status}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="footer">Gerado pelo Quiz Copérdia — validação de aprendizado em treinamentos.</p>
      <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
      </body></html>
    `);
    w.document.close();
  }

  // Compartilhar: no celular envia uma IMAGEM do resultado (Web Share); no desktop abre o WhatsApp com o resumo
  async function shareWhatsapp(s, btn) {
    const rows = resultRows(s);
    try {
      const blob = await resultImage(s, rows);
      const file = new File([blob], 'resultado-quiz.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Resultado — ${s.quizName}` });
        return;
      }
    } catch { /* cai para o texto */ }
    const top = rows.slice(0, 3).map(r => `${['🥇','🥈','🥉'][r.rank - 1] || r.rank + 'º'} ${r.name} — ${r.score} pts`).join('\n');
    const approved = rows.filter(r => r.status === 'Aprovado').length;
    const text = `🏁 Resultado do quiz "${s.quizName}"\n\n${top}\n\n` +
      (s.scorableTotal > 0 ? `✅ ${approved} de ${rows.length} participantes aprovados (nota mínima ${s.passScore}%).` : `${rows.length} participantes.`);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  // Desenha o resultado num canvas e devolve um PNG (para o Web Share)
  function resultImage(s, rows) {
    const W = 900;
    const rowH = 46;
    const top = 170;
    const H = top + rows.length * rowH + 90;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0e9a44'; ctx.fillRect(0, 0, W, 86);
    ctx.fillStyle = '#f5a800'; ctx.fillRect(0, 86, W, 5);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px Segoe UI, Arial';
    ctx.fillText('🎓 Quiz Copérdia — Resultado Final', 28, 54);
    ctx.fillStyle = '#1d1d1b';
    ctx.font = 'bold 22px Segoe UI, Arial';
    ctx.fillText(s.quizName.slice(0, 60), 28, 128);
    ctx.fillStyle = '#667';
    ctx.font = '15px Segoe UI, Arial';
    ctx.fillText(`${new Date().toLocaleString('pt-BR')} • ${rows.length} participante(s)` +
      (s.scorableTotal > 0 ? ` • nota mínima ${s.passScore}%` : ''), 28, 154);
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      if (r.rank === 1) { ctx.fillStyle = '#e7f5ec'; ctx.fillRect(16, y - 30, W - 32, rowH - 6); }
      ctx.fillStyle = '#0a6e31';
      ctx.font = 'bold 19px Segoe UI, Arial';
      ctx.fillText(`${r.rank}º`, 28, y);
      ctx.fillStyle = '#1d1d1b';
      ctx.font = '19px Segoe UI, Arial';
      ctx.fillText(`${r.avatar} ${r.name}`.slice(0, 34), 84, y);
      ctx.fillText(`${r.score} pts`, 470, y);
      ctx.fillText(r.percent, 610, y);
      ctx.fillStyle = r.status === 'Aprovado' ? '#0e9a44' : r.status === 'Reprovado' ? '#d64545' : '#667';
      ctx.font = 'bold 19px Segoe UI, Arial';
      ctx.fillText(r.status, 710, y);
    });
    ctx.fillStyle = '#889';
    ctx.font = '13px Segoe UI, Arial';
    ctx.fillText('Gerado pelo Quiz Copérdia — validação de aprendizado em treinamentos.', 28, H - 30);
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas')), 'image/png'));
  }

  /* ==================== PARTICIPANTE (player) ==================== */

  const Player = { pin: null, id: null, name: null, avatar: null };

  async function join(pin, name, avatar) {
    const data = await api(`/api/rooms/${pin}/join`, { name, avatar });
    Player.pin = pin;
    Player.id = data.playerId;
    Player.name = data.name;
    Player.avatar = data.avatar;
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
    if (s.state === 'question') {
      // Não redesenha a mesma questão a cada snapshot — preserva o que o participante digitou/selecionou
      if (!viewOnce(`pq:${s.questionIndex}:${s.answered ? 1 : 0}`)) return;
      return drawPlayerQuestion(container, s);
    }
    View.key = `p:${s.state}:${s.questionIndex}`;
    if (s.state === 'lobby') return drawPlayerLobby(container, s);
    if (s.state === 'reveal') return drawPlayerReveal(container, s);
    if (s.state === 'podium') return drawPlayerPodium(container, s);
  }

  function drawPlayerLobby(container, s) {
    container.innerHTML = `
      <div class="card live-hero">
        <div class="big-avatar">${esc(Player.avatar || '🎉')}</div>
        <h1>Você está dentro, ${esc(Player.name)}!</h1>
        <p class="subtitle">${esc(s.quizName)}</p>
        <p class="muted">Veja seu nome no telão e aguarde o instrutor iniciar o jogo.</p>
        ${reactionBarHtml()}
        <p class="muted" id="conn-note"></p>
      </div>
    `;
    wireReactionBar(container);
  }

  async function sendAnswer(container, s, answer) {
    try {
      await api(`/api/rooms/${Player.pin}/answer`, {
        playerId: Player.id,
        questionIndex: s.questionIndex,
        answer,
      });
      // Se éramos o último a responder, o reveal pode já ter chegado — não sobrescreve
      if (lastSnap && (lastSnap.state !== 'question' || lastSnap.questionIndex !== s.questionIndex)) return;
      View.key = `pq:${s.questionIndex}:1`; // o próximo snapshot (já respondida) não redesenha
      drawWaiting(container);
    } catch { /* fora do tempo — o próximo snapshot resolve a tela */ }
  }

  function drawWaiting(container) {
    container.innerHTML = `
      <div class="card live-hero">
        <div class="big" style="font-size:3rem">⚡</div>
        <h1>Resposta enviada!</h1>
        <p class="muted">Aguardando os demais participantes...</p>
        ${reactionBarHtml()}
      </div>
    `;
    wireReactionBar(container);
  }

  function drawPlayerQuestion(container, s) {
    if (s.answered) return drawWaiting(container);
    const q = s.question;
    showQuestionIntro(s); // vinheta em todos os tipos de questão

    // Slide: só acompanha o telão (sem resposta)
    if (q.type === 'slide') {
      container.innerHTML = `
        <div class="card live-hero">
          ${timerHeader(s)}
          <div class="big" style="font-size:3rem">👀</div>
          <h1 style="font-size:1.3rem">${esc(q.text)}</h1>
          <p class="muted">Acompanhe o conteúdo no telão.</p>
          ${reactionBarHtml()}
        </div>
      `;
      startCountdown(container, s.remainingMs, s.limitMs);
      wireReactionBar(container);
      return;
    }

    // Resposta curta: campo de texto — acerta quem digitar uma resposta aceita
    if (q.type === 'short') {
      container.innerHTML = `
        <div class="card">
          ${timerHeader(s)}
          <p class="question-text">${esc(q.text)}</p>
          ${mediaHtml(q, 'small')}
          <div class="field">
            <input type="text" class="short-answer" maxlength="60" placeholder="Digite sua resposta" autocomplete="off">
          </div>
          <button class="btn btn-primary btn-lg" id="btn-send">Enviar resposta</button>
        </div>
      `;
      startCountdown(container, s.remainingMs, s.limitMs);
      const input = container.querySelector('.short-answer');
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

    // Escala 1–5: um toque no número responde
    if (q.type === 'scale') {
      container.innerHTML = `
        <div class="card">
          ${timerHeader(s)}
          <p class="question-text">${esc(q.text)}</p>
          ${mediaHtml(q, 'small')}
          ${scaleHtml(q, { tappable: true })}
        </div>
      `;
      startCountdown(container, s.remainingMs, s.limitMs);
      container.querySelectorAll('.scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.scale-btn').forEach(b => { b.disabled = true; });
          sendAnswer(container, s, Number(btn.dataset.index));
        });
      });
      return;
    }

    // Nuvem de palavras: campos de texto livre (até q.maxAnswers respostas por participante)
    if (q.type === 'wordcloud') {
      const max = Math.max(1, q.maxAnswers || 1);
      container.innerHTML = `
        <div class="card">
          ${timerHeader(s)}
          <p class="question-text">${esc(q.text)}</p>
          ${mediaHtml(q, 'small')}
          ${max > 1 ? `<p class="muted" style="margin-bottom:10px">☁️ Você pode enviar até ${max} respostas — preencha quantas quiser.</p>` : ''}
          ${Array.from({ length: max }, (_, i) => `
            <div class="field">
              <input type="text" class="cloud-answer" maxlength="30" autocomplete="off"
                     placeholder="${max > 1 ? `Resposta ${i + 1}${i > 0 ? ' (opcional)' : ''}` : 'Digite sua resposta (palavra ou frase curta)'}">
            </div>`).join('')}
          <button class="btn btn-primary btn-lg" id="btn-send">Enviar ${max > 1 ? 'respostas' : 'resposta'}</button>
        </div>
      `;
      startCountdown(container, s.remainingMs, s.limitMs);
      const inputs = [...container.querySelectorAll('.cloud-answer')];
      const send = () => {
        const texts = inputs.map(inp => inp.value.trim()).filter(Boolean);
        if (texts.length === 0) { inputs[0].focus(); return; }
        sendAnswer(container, s, texts);
      };
      container.querySelector('#btn-send').addEventListener('click', send);
      inputs.forEach((inp, i) => inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        // Enter avança para o próximo campo vazio; no último, envia
        const next = inputs.slice(i + 1).find(x => !x.value.trim());
        if (next) next.focus(); else send();
      }));
      inputs[0].focus();
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
    const qType = s.question.type;
    const scored = qType === 'quiz' || qType === 'tf' || qType === 'short';

    if (!scored) {
      const isSlide = qType === 'slide';
      container.innerHTML = `
        <div class="card live-hero">
          <div class="big" style="font-size:3rem">${isSlide ? '👀' : me.answered ? '💬' : '⏰'}</div>
          <h1>${isSlide ? 'Vamos continuar!' : me.answered ? 'Obrigado pela sua opinião!' : 'Tempo esgotado!'}</h1>
          <p class="muted">${isSlide ? 'Aguarde o instrutor avançar.' : 'Veja as respostas de todos no telão.'}</p>
          ${reactionBarHtml()}
        </div>
      `;
      wireReactionBar(container);
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
        ${reactionBarHtml()}
      </div>
    `;
    wireReactionBar(container);
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
        ${reactionBarHtml()}
        <div class="btn-row" style="justify-content:center">
          <a href="#/" class="btn btn-primary">Concluir</a>
        </div>
      </div>
    `;
    wireReactionBar(container);
    sessionStorage.removeItem('qc_player');
  }

  return { renderHost, renderPlayer, join, stop };
})();
