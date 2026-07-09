/* ===== Quiz Copérdia — área de administração (one page, cadastros via modal) ===== */

const Admin = (() => {
  let activeTab = 'trainings';
  let expandedId = null; // treinamento com a lista de questões aberta

  const OPT_COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];
  const OPT_SHAPES = ['▲', '◆', '●', '■', '★', '⬟'];

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function isAuthed() {
    return sessionStorage.getItem('qc_admin_ok') === '1';
  }

  /* ---------- Modal genérico ---------- */
  function openModal(html, { wide = false } = {}) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
          <button class="modal-close" aria-label="Fechar">✕</button>
          ${html}
        </div>
      </div>
    `;
    document.body.style.overflow = 'hidden';
    const overlay = root.querySelector('.modal-overlay');
    const close = () => closeModal();
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    root.querySelector('.modal-close').addEventListener('click', close);
    root._esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', root._esc);
    return root.querySelector('.modal');
  }

  function closeModal() {
    const root = document.getElementById('modal-root');
    if (root._esc) document.removeEventListener('keydown', root._esc);
    root.innerHTML = '';
    document.body.style.overflow = '';
  }

  /* ---------- Upload de imagem com compressão no navegador ---------- */
  function pickImage(maxSize, cb) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        cb(canvas.toDataURL('image/jpeg', 0.78));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => alert('Não foi possível ler a imagem.');
      img.src = URL.createObjectURL(file);
    };
    input.click();
  }

  /* ---------- Entrada ---------- */
  function render(container) {
    if (!isAuthed()) return renderLogin(container);
    renderPanel(container);
  }

  function renderLogin(container) {
    container.innerHTML = `
      <div class="card" style="max-width:420px;margin:40px auto">
        <h1>Administração</h1>
        <p class="subtitle">Informe o PIN de acesso.</p>
        <div class="field">
          <label for="pin">PIN</label>
          <input type="password" id="pin" inputmode="numeric" placeholder="••••">
        </div>
        <p class="muted" id="pin-error" style="color:var(--danger);display:none">PIN incorreto.</p>
        <div class="btn-row">
          <button class="btn btn-primary" id="btn-login">Entrar</button>
          <a href="#/" class="btn btn-ghost">Voltar</a>
        </div>
        <p class="muted" style="margin-top:14px">PIN padrão: <strong>1234</strong> — altere na aba Configurações após entrar.</p>
      </div>
    `;
    const pinInput = container.querySelector('#pin');
    const tryLogin = () => {
      if (pinInput.value === Store.getPin()) {
        sessionStorage.setItem('qc_admin_ok', '1');
        render(container);
      } else {
        container.querySelector('#pin-error').style.display = 'block';
        pinInput.value = '';
        pinInput.focus();
      }
    };
    container.querySelector('#btn-login').addEventListener('click', tryLogin);
    pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
    pinInput.focus();
  }

  /* ---------- Painel com abas ---------- */
  function renderPanel(container) {
    container.innerHTML = `
      <h1>Administração</h1>
      <p class="subtitle">Gerencie treinamentos, perguntas e resultados.</p>
      <div class="tabs">
        <button class="tab ${activeTab === 'trainings' ? 'active' : ''}" data-tab="trainings">Treinamentos</button>
        <button class="tab ${activeTab === 'results' ? 'active' : ''}" data-tab="results">Resultados</button>
        <button class="tab ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">Configurações</button>
      </div>
      <div id="tab-content"></div>
    `;
    container.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        renderPanel(container);
      });
    });
    const content = container.querySelector('#tab-content');
    if (activeTab === 'trainings') renderTrainingsTab(content, container);
    else if (activeTab === 'results') renderResultsTab(content);
    else renderSettingsTab(content);
  }

  /* ==================== Aba: Treinamentos ==================== */

  function questionSummary(q, i) {
    const type = Store.QUESTION_TYPES[q.type] || Store.QUESTION_TYPES.quiz;
    let detail = '';
    if (q.type === 'quiz' || q.type === 'tf' || q.type === 'poll') {
      detail = `
        <ol type="A">
          ${q.options.map((o, oi) => `
            <li class="${q.corrects.includes(oi) ? 'correct' : ''}">
              ${esc(o)}${q.corrects.includes(oi) ? ' ✔' : ''}
            </li>`).join('')}
        </ol>`;
    } else if (q.type === 'short') {
      detail = `<p class="muted" style="margin-top:6px">Respostas aceitas:
        ${q.answers.map(a => `<span class="pill pill-pass">✔ ${esc(a)}</span>`).join(' ')}</p>`;
    } else if (q.type === 'scale') {
      detail = `<p class="muted" style="margin-top:6px">Escala de 1
        ${q.scaleLeft ? `(${esc(q.scaleLeft)})` : ''} a 5 ${q.scaleRight ? `(${esc(q.scaleRight)})` : ''} — sem pontos.</p>`;
    } else if (q.type === 'nps') {
      detail = `<p class="muted" style="margin-top:6px">Escala NPS de 0 a 10 — o telão mostra promotores, neutros, detratores e o NPS.</p>`;
    } else if (q.type === 'slider') {
      detail = `<p class="muted" style="margin-top:6px">Controle deslizante de ${q.sliderMin} a ${q.sliderMax}
        (passo ${q.sliderStep}) — resposta: <strong>${q.sliderAnswer}</strong>${Number(q.sliderTolerance) > 0 ? ` ±${q.sliderTolerance}` : ''}.</p>`;
    } else if (q.type === 'pin') {
      detail = `<p class="muted" style="margin-top:6px">Os participantes largam um marcador na imagem — sem pontos.</p>`;
    } else if (q.type === 'brainstorm') {
      detail = `<p class="muted" style="margin-top:6px">Brainstorm: até ${q.maxAnswers || 3} ideias por participante,
        depois votação (${q.maxVotes || 3} votos cada).</p>`;
    } else if (q.type === 'slide') {
      detail = `<p class="muted" style="margin-top:6px">${esc((q.body || '').slice(0, 120)) || 'Slide de conteúdo — sem respostas.'}
        <span class="type-badge">layout: ${Store.SLIDE_LAYOUTS[q.layout] || 'Clássico'}</span></p>`;
    } else {
      const n = q.maxAnswers || 1;
      detail = `<p class="muted" style="margin-top:6px">Resposta livre — forma uma nuvem de palavras no telão
        (${n === 1 ? '1 resposta' : 'até ' + n + ' respostas'} por participante).</p>`;
    }
    return `
      <div class="question-card" data-qid="${q.id}">
        <div class="head">
          <div>
            <span class="type-badge">${type.icon} ${type.label}</span>
            ${q.image ? '<span class="type-badge">🖼️ imagem</span>' : ''}
            ${q.multi ? '<span class="type-badge">☑ múltipla escolha</span>' : ''}
            ${q.timeLimit ? `<span class="type-badge">⏱ ${q.timeLimit}s</span>` : ''}
            ${q.points === 'double' ? '<span class="type-badge">x2 pontos</span>' : ''}
            ${q.points === 'none' ? '<span class="type-badge">sem pontos</span>' : ''}
            ${q.reactions === false ? '<span class="type-badge">🚫 sem reações</span>' : ''}
            <strong style="display:block;margin-top:6px">${i + 1}. ${esc(q.text) || '<em>sem enunciado</em>'}</strong>
          </div>
          <div class="admin-actions">
            <button class="btn btn-secondary btn-sm" data-action="edit-q">Editar</button>
            <button class="btn btn-danger btn-sm" data-action="del-q">Excluir</button>
          </div>
        </div>
        ${detail}
      </div>
    `;
  }

  function renderTrainingsTab(content, container) {
    const trainings = Store.getTrainings();
    content.innerHTML = `
      <div class="btn-row" style="margin:0 0 16px">
        <button class="btn btn-primary" id="btn-new">+ Novo treinamento</button>
      </div>
      ${trainings.length === 0 ? `
        <div class="card empty-state">
          <div class="big">📚</div>
          <p>Nenhum treinamento cadastrado ainda.</p>
        </div>` : trainings.map(t => `
        <div class="admin-training" data-id="${t.id}">
          <div class="admin-training-head">
            <div>
              <h3>${esc(t.name)}</h3>
              <p class="training-meta">
                ${t.questions.length} ${t.questions.length === 1 ? 'questão' : 'questões'} •
                nota mínima ${t.passScore}% •
                tempo padrão ${t.timePerQuestion}s
              </p>
            </div>
            <div class="admin-actions">
              <button class="btn btn-primary btn-sm" data-action="play" ${t.questions.length === 0 ? 'disabled title="Adicione questões antes de iniciar"' : ''}>▶ Iniciar ao vivo</button>
              <button class="btn btn-secondary btn-sm" data-action="questions">${expandedId === t.id ? '▾' : '▸'} Questões</button>
              <button class="btn btn-ghost btn-sm" data-action="edit">✏ Editar</button>
              <button class="btn btn-ghost btn-sm" data-action="duplicate">⧉ Duplicar</button>
              <button class="btn btn-danger btn-sm" data-action="delete">Excluir</button>
            </div>
          </div>
          <div class="questions-area" style="display:${expandedId === t.id ? 'block' : 'none'}">
            ${t.questions.map((q, i) => questionSummary(q, i)).join('') ||
              '<p class="muted" style="margin:10px 0">Nenhuma questão ainda.</p>'}
            <button class="btn btn-primary btn-sm" data-action="add-q" style="margin-top:6px">+ Adicionar questão</button>
          </div>
        </div>
      `).join('')}
    `;

    content.querySelector('#btn-new').addEventListener('click', () => {
      openTrainingModal(null, () => renderPanel(container));
    });

    content.querySelectorAll('.admin-training').forEach(card => {
      const id = card.dataset.id;
      const training = () => Store.getTraining(id);

      const playBtn = card.querySelector('[data-action="play"]');
      if (playBtn && !playBtn.disabled) {
        playBtn.addEventListener('click', () => { location.hash = `#/host/${id}`; });
      }
      card.querySelector('[data-action="questions"]').addEventListener('click', () => {
        expandedId = expandedId === id ? null : id;
        renderPanel(container);
      });
      card.querySelector('[data-action="edit"]').addEventListener('click', () => {
        openTrainingModal(training(), () => renderPanel(container));
      });
      card.querySelector('[data-action="duplicate"]').addEventListener('click', () => {
        const copy = JSON.parse(JSON.stringify(training()));
        copy.id = Store.uid();
        copy.name = copy.name + ' (cópia)';
        copy.questions.forEach(q => { q.id = Store.uid(); });
        Store.upsertTraining(copy);
        renderPanel(container);
      });
      card.querySelector('[data-action="delete"]').addEventListener('click', () => {
        if (confirm(`Excluir o treinamento "${training().name}"? Esta ação não pode ser desfeita.`)) {
          Store.deleteTraining(id);
          renderPanel(container);
        }
      });
      card.querySelector('[data-action="add-q"]').addEventListener('click', () => {
        openTypePicker(training(), type => {
          openQuestionModal(training(), null, () => { expandedId = id; renderPanel(container); }, type);
        });
      });
      card.querySelectorAll('.question-card').forEach(qc => {
        const t = training();
        const q = t.questions.find(x => x.id === qc.dataset.qid);
        qc.querySelector('[data-action="edit-q"]').addEventListener('click', () => {
          openQuestionModal(t, q, () => { expandedId = id; renderPanel(container); });
        });
        qc.querySelector('[data-action="del-q"]').addEventListener('click', () => {
          if (confirm('Excluir esta questão?')) {
            t.questions = t.questions.filter(x => x.id !== q.id);
            Store.upsertTraining(t);
            expandedId = id;
            renderPanel(container);
          }
        });
      });
    });
  }

  /* ---------- Modal: treinamento ---------- */
  function openTrainingModal(training, onSave) {
    const isNew = !training;
    const t = training || Store.newTraining();
    const modal = openModal(`
      <h2>${isNew ? 'Novo treinamento' : 'Editar treinamento'}</h2>
      <div class="field">
        <label for="t-name">Nome do treinamento</label>
        <input type="text" id="t-name" value="${esc(t.name)}" placeholder="Ex.: NR-35 Trabalho em Altura">
      </div>
      <div class="field">
        <label for="t-desc">Descrição (opcional)</label>
        <textarea id="t-desc" rows="2">${esc(t.description)}</textarea>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="t-pass">Nota mínima p/ aprovação (%)</label>
          <input type="number" id="t-pass" min="0" max="100" value="${t.passScore}">
        </div>
        <div class="field">
          <label for="t-time">Tempo padrão por questão</label>
          <select id="t-time">
            ${Store.TIME_OPTIONS.map(s => `<option value="${s}" ${s === t.timePerQuestion ? 'selected' : ''}>${s} segundos</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;font-weight:400">
          <input type="checkbox" id="t-shuffle" ${t.shuffleQuestions ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary)">
          Embaralhar a ordem das questões a cada aplicação
        </label>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;font-weight:400">
          <input type="checkbox" id="t-ranking" ${t.showRanking !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary)">
          Mostrar ranking entre as questões (quem subiu e quem desceu de posição)
        </label>
        <p class="muted" style="margin-top:4px;font-size:0.78rem">Desligado, a classificação só aparece no pódio final.</p>
      </div>
      <p class="muted" id="t-error" style="color:var(--danger);display:none"></p>
      <div class="btn-row">
        <button class="btn btn-primary" id="btn-save">Salvar</button>
        <button class="btn btn-ghost" id="btn-cancel">Cancelar</button>
      </div>
    `);

    modal.querySelector('#btn-cancel').addEventListener('click', closeModal);
    modal.querySelector('#btn-save').addEventListener('click', () => {
      const name = modal.querySelector('#t-name').value.trim();
      if (!name) {
        const err = modal.querySelector('#t-error');
        err.textContent = 'Informe o nome do treinamento.';
        err.style.display = 'block';
        return;
      }
      t.name = name;
      t.description = modal.querySelector('#t-desc').value.trim();
      t.passScore = Math.min(100, Math.max(0, Number(modal.querySelector('#t-pass').value) || 0));
      t.timePerQuestion = Number(modal.querySelector('#t-time').value) || 20;
      t.shuffleQuestions = modal.querySelector('#t-shuffle').checked;
      t.showRanking = modal.querySelector('#t-ranking').checked;
      Store.upsertTraining(t);
      closeModal();
      onSave();
    });
    modal.querySelector('#t-name').focus();
  }

  /* ---------- Modal: escolher o tipo da nova questão (estilo Kahoot) ---------- */

  // Miniatura ilustrativa de cada tipo, usada no balão de pré-visualização
  function typePreviewHtml(key) {
    if (key === 'quiz') return `
      <div class="tp-mini"><div class="tp-media">🖼️</div>
        <div class="tp-opts"><span class="tp-opt red"></span><span class="tp-opt blue"></span><span class="tp-opt yellow"></span><span class="tp-opt green"></span></div></div>`;
    if (key === 'tf') return `
      <div class="tp-mini"><div class="tp-media">🖼️</div>
        <div class="tp-opts"><span class="tp-opt blue">✔</span><span class="tp-opt red">✖</span></div></div>`;
    if (key === 'short') return `
      <div class="tp-mini"><div class="tp-media">🖼️</div><div class="tp-input">| digite a resposta…</div></div>`;
    if (key === 'poll') return `
      <div class="tp-mini"><div class="tp-bars"><i style="height:26px"></i><i style="height:14px"></i><i style="height:20px"></i></div></div>`;
    if (key === 'scale') return `
      <div class="tp-mini"><div class="tp-scale">${[1, 2, 3, 4, 5].map(n => `<span>${n}</span>`).join('')}</div></div>`;
    if (key === 'wordcloud') return `
      <div class="tp-mini"><div class="tp-cloud"><b>equipe</b> <span>foco</span> <b style="font-size:1.1em">união</b> <span>meta</span></div></div>`;
    if (key === 'slider') return `
      <div class="tp-mini"><div class="tp-slider"><span class="tp-track"><i></i></span><small>0&nbsp;··· valor certo ···&nbsp;100</small></div></div>`;
    if (key === 'nps') return `
      <div class="tp-mini"><div class="tp-scale tp-nps">${[0, 2, 4, 6, 8, 10].map(n => `<span>${n}</span>`).join('')}</div>
        <div class="tp-ends"><span>Improvável</span><span>Muito provável</span></div></div>`;
    if (key === 'pin') return `
      <div class="tp-mini"><div class="tp-media tp-pinmap">🖼️<span class="tp-pin p1">📍</span><span class="tp-pin p2">📍</span><span class="tp-pin p3">📍</span></div></div>`;
    if (key === 'brainstorm') return `
      <div class="tp-mini"><div class="tp-opts"><span class="tp-opt blue">💡⭐</span><span class="tp-opt green">💡⭐</span><span class="tp-opt yellow">💡</span><span class="tp-opt red">💡</span></div></div>`;
    return `
      <div class="tp-mini"><div class="tp-slide"><strong>Título</strong><span></span><span style="width:70%"></span></div></div>`;
  }

  function openTypePicker(training, onPick) {
    const modal = openModal(`
      <h2>Adicionar questão</h2>
      <p class="subtitle" style="margin-bottom:14px">Escolha o tipo — passe o mouse para ver como funciona.</p>
      ${Store.TYPE_CATEGORIES.map(cat => `
        <p class="type-cat">${cat.label}</p>
        <div class="type-grid">
          ${Object.entries(Store.QUESTION_TYPES).filter(([, v]) => v.cat === cat.id).map(([key, v]) => `
            <button type="button" class="type-tile" data-type="${key}">
              <span class="type-tile-icon">${v.icon}</span>
              <span class="type-tile-label">${v.label}</span>
              <span class="type-tip">
                ${typePreviewHtml(key)}
                <strong>${v.icon} ${v.label}</strong>
                <small>${v.desc}</small>
              </span>
            </button>`).join('')}
        </div>`).join('')}
    `, { wide: true });

    modal.querySelectorAll('.type-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        closeModal();
        onPick(tile.dataset.type);
      });
    });
  }

  // Ajusta os campos da questão ao trocar/definir o tipo
  function applyTypeDefaults(q, type) {
    q.type = type;
    if (type === 'tf') {
      q.options = ['Verdadeiro', 'Falso'];
      q.optionImages = [null, null];
      q.corrects = [0];
      q.multi = false;
      if (q.points === 'none') q.points = 'standard';
    } else if (type === 'short') {
      q.options = [];
      q.optionImages = [];
      q.corrects = [];
      q.multi = false;
      if (!Array.isArray(q.answers)) q.answers = [];
      if (q.points === 'none') q.points = 'standard';
    } else if (type === 'slider') {
      q.options = [];
      q.optionImages = [];
      q.corrects = [];
      q.multi = false;
      if (q.points === 'none') q.points = 'standard';
      if (!(Number(q.sliderMax) > Number(q.sliderMin))) { q.sliderMin = 0; q.sliderMax = 100; }
      if (!(Number(q.sliderStep) > 0)) q.sliderStep = 1;
      if (!Number.isFinite(Number(q.sliderAnswer))) q.sliderAnswer = q.sliderMin;
      if (!(Number(q.sliderTolerance) >= 0)) q.sliderTolerance = 0;
    } else if (['wordcloud', 'scale', 'nps', 'pin', 'brainstorm', 'slide'].includes(type)) {
      q.options = [];
      q.optionImages = [];
      q.corrects = [];
      q.multi = false;
      q.points = 'none';
      if (type === 'wordcloud') q.maxAnswers = q.maxAnswers || 1;
      if (type === 'brainstorm') {
        q.maxAnswers = Math.min(5, Math.max(1, q.maxAnswers || 3));
        q.maxVotes = Math.min(5, Math.max(1, q.maxVotes || 3));
      }
      if (type === 'slide' && !q.layout) q.layout = 'classic';
    } else if (type === 'poll') {
      if (q.options.length < 2) { q.options = ['', '']; q.optionImages = [null, null]; }
      q.corrects = [];
      q.multi = false;
      q.points = 'none';
    } else if (type === 'quiz') {
      if (q.options.length < 2) { q.options = ['', '', '', '']; q.optionImages = [null, null, null, null]; }
      if (q.corrects.length === 0) q.corrects = [0];
      if (q.points === 'none') q.points = 'standard';
    }
  }

  /* ---------- Modal: questão (estilo Kahoot) ---------- */
  function openQuestionModal(training, question, onSave, initialType) {
    const isNew = !question;
    // Trabalha numa cópia para só persistir no salvar
    const q = JSON.parse(JSON.stringify(question || Store.newQuestion()));
    if (!Array.isArray(q.optionImages)) q.optionImages = q.options.map(() => null);
    if (isNew && initialType) applyTypeDefaults(q, initialType);

    const modal = openModal('', { wide: true });

    const draw = () => {
      const type = q.type;
      const hasOptions = type === 'quiz' || type === 'poll';
      const scored = type === 'quiz' || type === 'tf' || type === 'short';

      modal.innerHTML = `
        <button class="modal-close" aria-label="Fechar">✕</button>
        <h2>${isNew ? 'Nova questão' : 'Editar questão'}</h2>

        <div class="q-editor">
          <div class="q-editor-main">
            <div class="field">
              <label for="q-text">Enunciado</label>
              <textarea id="q-text" rows="2" placeholder="Comece a digitar a pergunta">${esc(q.text)}</textarea>
            </div>

            <div class="q-media-edit ${q.image ? 'has-img' : ''}" id="q-media-edit">
              ${q.image
                ? `<img src="${q.image}" alt=""><button class="btn btn-danger btn-sm" id="btn-del-img">✕ Remover imagem</button>`
                : `<button class="btn btn-ghost" id="btn-add-img">🖼️ Inserir mídia (opcional)</button>`}
            </div>

            ${type === 'wordcloud' ? `
              <div class="notice notice-info">
                ☁️ Os participantes digitam respostas curtas e livres (palavras ou frases). As respostas
                formam uma nuvem de palavras no telão. Não há resposta certa nem pontos.
              </div>` : ''}

            ${type === 'short' ? `
              <label>Respostas aceitas — acerta quem digitar uma delas</label>
              <div id="q-answers" style="margin-top:8px">
                ${[...q.answers, ''].slice(0, 10).map((a, i) => `
                  <div class="option-edit-row">
                    <span class="opt-chip green">✔</span>
                    <input type="text" data-ans="${i}" value="${esc(a)}" maxlength="60"
                           placeholder="${i === 0 ? 'Resposta aceita (obrigatória)' : 'Outra forma de escrever (opcional)'}">
                  </div>`).join('')}
              </div>
              ${q.answers.length < 9 ? '<button class="btn btn-ghost btn-sm" id="btn-add-ans">+ Adicionar outra resposta aceita</button>' : ''}
              <p class="muted" style="font-size:0.78rem;margin-top:6px">A comparação ignora maiúsculas/minúsculas e espaços extras.</p>
            ` : ''}

            ${type === 'scale' || type === 'nps' ? `
              <div class="notice notice-info">
                ${type === 'nps'
                  ? '💯 Os participantes escolhem uma nota de <strong>0 a 10</strong>. O telão mostra o NPS: % de promotores (9–10) menos % de detratores (0–6).'
                  : '📏 Os participantes escolhem uma nota de <strong>1 a 5</strong>. Dê significado às pontas abaixo (opcional).'}
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="q-scale-left">Rótulo do ${type === 'nps' ? '0' : '1'}</label>
                  <input type="text" id="q-scale-left" maxlength="40" value="${esc(q.scaleLeft || '')}" placeholder="${type === 'nps' ? 'Improvável' : 'Ex.: Discordo totalmente'}">
                </div>
                <div class="field">
                  <label for="q-scale-right">Rótulo do ${type === 'nps' ? '10' : '5'}</label>
                  <input type="text" id="q-scale-right" maxlength="40" value="${esc(q.scaleRight || '')}" placeholder="${type === 'nps' ? 'Muito provável' : 'Ex.: Concordo totalmente'}">
                </div>
              </div>` : ''}

            ${type === 'slider' ? `
              <div class="notice notice-info">
                🎚️ Os participantes arrastam um controle e tentam acertar o valor. Acerta quem ficar dentro da margem de erro.
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="q-sl-min">Valor mínimo</label>
                  <input type="number" id="q-sl-min" value="${Number(q.sliderMin) || 0}">
                </div>
                <div class="field">
                  <label for="q-sl-max">Valor máximo</label>
                  <input type="number" id="q-sl-max" value="${Number(q.sliderMax) || 100}">
                </div>
                <div class="field">
                  <label for="q-sl-step">Intervalo (passo)</label>
                  <input type="number" id="q-sl-step" min="0" value="${Number(q.sliderStep) || 1}">
                </div>
              </div>
              <div class="field-row">
                <div class="field">
                  <label for="q-sl-answer">✔ Resposta correta</label>
                  <input type="number" id="q-sl-answer" value="${Number(q.sliderAnswer) || 0}">
                </div>
                <div class="field">
                  <label for="q-sl-tol">± Margem de erro aceita</label>
                  <input type="number" id="q-sl-tol" min="0" value="${Number(q.sliderTolerance) || 0}">
                </div>
              </div>` : ''}

            ${type === 'pin' ? `
              <div class="notice ${q.image ? 'notice-info' : 'notice-warn'}">
                📍 ${q.image
                  ? 'Os participantes tocarão em um ponto desta imagem — todos os marcadores aparecem juntos no telão.'
                  : '<strong>Adicione uma imagem acima</strong> — é nela que os participantes largarão os marcadores.'}
              </div>` : ''}

            ${type === 'brainstorm' ? `
              <div class="notice notice-info">
                💡 Em duas etapas: primeiro cada participante envia ideias; depois o instrutor abre a
                <strong>votação</strong> e todos votam nas melhores. O telão mostra o ranking das ideias.
              </div>` : ''}

            ${type === 'slide' ? `
              <div class="notice notice-info">
                🖼️ Slide de conteúdo: use o enunciado como <strong>título</strong> e o texto abaixo para explicar.
                Os participantes acompanham pelo telão; ninguém responde.
              </div>
              <div class="field">
                <label for="q-body">Texto do slide (opcional)</label>
                <textarea id="q-body" rows="4" maxlength="1000" placeholder="Conteúdo exibido no telão">${esc(q.body || '')}</textarea>
              </div>` : ''}

            ${type === 'tf' ? `
              <label>Qual é a resposta correta?</label>
              <div class="live-options tf" style="margin-top:8px">
                <button class="live-option blue tf-pick ${q.corrects[0] === 0 ? 'is-selected' : ''}" data-tf="0">
                  <span class="shape">✔</span><span>Verdadeiro</span>
                </button>
                <button class="live-option red tf-pick ${q.corrects[0] === 1 ? 'is-selected' : ''}" data-tf="1">
                  <span class="shape">✖</span><span>Falso</span>
                </button>
              </div>` : ''}

            ${hasOptions ? `
              <label>Alternativas${type === 'quiz' ? ' — marque a(s) correta(s)' : ''}</label>
              <div id="q-options" style="margin-top:8px">
                ${q.options.map((o, i) => `
                  <div class="option-edit-row">
                    ${type === 'quiz'
                      ? `<input type="${q.multi ? 'checkbox' : 'radio'}" name="q-correct" value="${i}" ${q.corrects.includes(i) ? 'checked' : ''} title="Correta">`
                      : ''}
                    <span class="opt-chip ${OPT_COLORS[i]}">${OPT_SHAPES[i]}</span>
                    <input type="text" data-opt="${i}" value="${esc(o)}" placeholder="Alternativa ${i + 1}${i >= 2 ? ' (opcional)' : ''}">
                    <button class="btn btn-ghost btn-sm" data-img="${i}" title="${q.optionImages[i] ? 'Trocar imagem' : 'Adicionar imagem'}">
                      ${q.optionImages[i] ? `<img class="opt-thumb" src="${q.optionImages[i]}">` : '🖼️'}
                    </button>
                    ${q.optionImages[i] ? `<button class="btn btn-ghost btn-sm" data-img-del="${i}" title="Remover imagem">✕</button>` : ''}
                    ${q.options.length > 2 ? `<button class="btn btn-ghost btn-sm" data-remove="${i}" title="Remover alternativa">🗑</button>` : ''}
                  </div>
                `).join('')}
              </div>
              ${q.options.length < 6 ? '<button class="btn btn-ghost btn-sm" id="btn-add-opt">+ Adicionar mais respostas</button>' : ''}
            ` : ''}

            <p class="muted" id="q-error" style="color:var(--danger);display:none"></p>
          </div>

          <aside class="q-editor-props">
            <h3>Propriedades da pergunta</h3>
            <div class="field">
              <label for="q-type">🎴 Tipo de pergunta</label>
              <select id="q-type">
                ${Object.entries(Store.QUESTION_TYPES).map(([k, v]) =>
                  `<option value="${k}" ${k === type ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}
              </select>
              <p class="muted" style="margin-top:4px;font-size:0.78rem">${Store.QUESTION_TYPES[type].desc}</p>
            </div>
            <div class="field">
              <label for="q-time">⏱ Limite de tempo</label>
              <select id="q-time">
                <option value="">Padrão do treinamento (${training.timePerQuestion}s)</option>
                ${Store.TIME_OPTIONS.map(s => `<option value="${s}" ${s === q.timeLimit ? 'selected' : ''}>${s} segundos</option>`).join('')}
              </select>
              <a href="javascript:void(0)" id="apply-time-all" class="muted" style="font-size:0.78rem">Aplicar a todas as perguntas</a>
            </div>
            ${scored ? `
              <div class="field">
                <label for="q-points">🏅 Pontos</label>
                <select id="q-points">
                  ${Object.entries(Store.POINTS_OPTIONS).map(([k, v]) =>
                    `<option value="${k}" ${k === q.points ? 'selected' : ''}>${v.label}</option>`).join('')}
                </select>
                <p class="muted" style="margin-top:4px;font-size:0.78rem">${Store.POINTS_OPTIONS[q.points].desc}</p>
              </div>` : ''}
            ${type === 'wordcloud' ? `
              <div class="field">
                <label for="q-max">💬 Respostas por participante</label>
                <select id="q-max">
                  ${[1, 2, 3, 4, 5].map(n =>
                    `<option value="${n}" ${n === (q.maxAnswers || 1) ? 'selected' : ''}>${n === 1 ? '1 resposta' : n + ' respostas'}</option>`).join('')}
                </select>
                <p class="muted" style="margin-top:4px;font-size:0.78rem">
                  Quantas palavras ou frases cada participante pode enviar para a nuvem.
                </p>
              </div>` : ''}
            ${type === 'brainstorm' ? `
              <div class="field">
                <label for="q-max">💡 Ideias por participante</label>
                <select id="q-max">
                  ${[1, 2, 3, 4, 5].map(n =>
                    `<option value="${n}" ${n === (q.maxAnswers || 3) ? 'selected' : ''}>${n === 1 ? '1 ideia' : n + ' ideias'}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="q-maxvotes">⭐ Votos por participante</label>
                <select id="q-maxvotes">
                  ${[1, 2, 3, 4, 5].map(n =>
                    `<option value="${n}" ${n === (q.maxVotes || 3) ? 'selected' : ''}>${n === 1 ? '1 voto' : n + ' votos'}</option>`).join('')}
                </select>
              </div>` : ''}
            ${type === 'slide' ? `
              <div class="field">
                <label for="q-layout">🎛 Layout do slide</label>
                <select id="q-layout">
                  ${Object.entries(Store.SLIDE_LAYOUTS).map(([k, v]) =>
                    `<option value="${k}" ${k === (q.layout || 'classic') ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
                <p class="muted" style="margin-top:4px;font-size:0.78rem">
                  Como o título, o texto e a imagem são organizados no telão.
                </p>
              </div>` : ''}
            <div class="field">
              <label for="q-reactions">😊 Reações</label>
              <select id="q-reactions">
                <option value="yes" ${q.reactions !== false ? 'selected' : ''}>Sim</option>
                <option value="no" ${q.reactions === false ? 'selected' : ''}>Não</option>
              </select>
              <p class="muted" style="margin-top:4px;font-size:0.78rem">
                ${q.reactions !== false
                  ? 'Os participantes podem reagir com emojis durante esta questão: 👍 👏 ❤️ 😂 🤔 😮'
                  : 'As reações com emojis ficam desativadas nesta questão.'}
              </p>
            </div>
            ${type === 'quiz' ? `
              <div class="field">
                <label for="q-mode">☑️ Opções de resposta</label>
                <select id="q-mode">
                  <option value="single" ${!q.multi ? 'selected' : ''}>Seleção simples</option>
                  <option value="multi" ${q.multi ? 'selected' : ''}>Múltipla escolha</option>
                </select>
                <p class="muted" style="margin-top:4px;font-size:0.78rem">
                  ${q.multi ? 'Os participantes podem selecionar múltiplas respostas antes de enviar' : 'Os participantes só podem selecionar uma resposta'}
                </p>
              </div>` : ''}
          </aside>
        </div>

        <div class="btn-row" style="margin-top:18px">
          <button class="btn btn-primary" id="btn-save-q">Salvar questão</button>
          <button class="btn btn-ghost" id="btn-cancel-q">Cancelar</button>
        </div>
      `;

      /* --- coleta o estado atual dos campos --- */
      const sync = () => {
        const textEl = modal.querySelector('#q-text');
        if (textEl) q.text = textEl.value;
        modal.querySelectorAll('[data-opt]').forEach(inp => {
          q.options[Number(inp.dataset.opt)] = inp.value;
        });
        if (q.type === 'quiz') {
          const checked = [...modal.querySelectorAll('input[name="q-correct"]:checked')].map(el => Number(el.value));
          if (checked.length) q.corrects = checked.sort((a, b) => a - b);
        }
        const timeEl = modal.querySelector('#q-time');
        if (timeEl) q.timeLimit = timeEl.value ? Number(timeEl.value) : null;
        const pointsEl = modal.querySelector('#q-points');
        if (pointsEl) q.points = pointsEl.value;
        const maxEl = modal.querySelector('#q-max');
        if (maxEl) q.maxAnswers = Number(maxEl.value) || 1;
        const ansEls = [...modal.querySelectorAll('[data-ans]')];
        if (ansEls.length) q.answers = ansEls.map(el => el.value.trim()).filter(Boolean);
        const slEl = modal.querySelector('#q-scale-left');
        if (slEl) q.scaleLeft = slEl.value.trim();
        const srEl = modal.querySelector('#q-scale-right');
        if (srEl) q.scaleRight = srEl.value.trim();
        const bodyEl = modal.querySelector('#q-body');
        if (bodyEl) q.body = bodyEl.value.trim();
        const layoutEl = modal.querySelector('#q-layout');
        if (layoutEl) q.layout = layoutEl.value;
        const reactEl = modal.querySelector('#q-reactions');
        if (reactEl) q.reactions = reactEl.value !== 'no';
        const votesEl = modal.querySelector('#q-maxvotes');
        if (votesEl) q.maxVotes = Number(votesEl.value) || 3;
        const num = id => { const el = modal.querySelector(id); return el ? Number(el.value) : null; };
        if (modal.querySelector('#q-sl-min')) {
          q.sliderMin = num('#q-sl-min') || 0;
          q.sliderMax = num('#q-sl-max');
          q.sliderStep = num('#q-sl-step');
          q.sliderAnswer = num('#q-sl-answer');
          q.sliderTolerance = num('#q-sl-tol') || 0;
        }
      };

      /* --- troca de tipo --- */
      modal.querySelector('#q-type').addEventListener('change', e => {
        sync();
        applyTypeDefaults(q, e.target.value);
        draw();
      });

      /* --- respostas aceitas (resposta curta) --- */
      const addAns = modal.querySelector('#btn-add-ans');
      if (addAns) addAns.addEventListener('click', () => {
        sync();
        q.answers.push('');
        draw();
      });

      /* --- modo simples/múltipla --- */
      const modeEl = modal.querySelector('#q-mode');
      if (modeEl) modeEl.addEventListener('change', e => {
        sync();
        q.multi = e.target.value === 'multi';
        if (!q.multi && q.corrects.length > 1) q.corrects = [q.corrects[0]];
        draw();
      });

      /* --- verdadeiro/falso --- */
      modal.querySelectorAll('.tf-pick').forEach(btn => {
        btn.addEventListener('click', () => {
          sync();
          q.corrects = [Number(btn.dataset.tf)];
          draw();
        });
      });

      /* --- mídia da pergunta --- */
      const addImg = modal.querySelector('#btn-add-img');
      if (addImg) addImg.addEventListener('click', () => {
        sync();
        pickImage(900, dataUrl => { q.image = dataUrl; draw(); });
      });
      const delImg = modal.querySelector('#btn-del-img');
      if (delImg) delImg.addEventListener('click', () => { sync(); q.image = null; draw(); });

      /* --- imagens das alternativas --- */
      modal.querySelectorAll('[data-img]').forEach(btn => {
        btn.addEventListener('click', () => {
          sync();
          const i = Number(btn.dataset.img);
          pickImage(500, dataUrl => { q.optionImages[i] = dataUrl; draw(); });
        });
      });
      modal.querySelectorAll('[data-img-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          sync();
          q.optionImages[Number(btn.dataset.imgDel)] = null;
          draw();
        });
      });

      /* --- adicionar/remover alternativas --- */
      const addOpt = modal.querySelector('#btn-add-opt');
      if (addOpt) addOpt.addEventListener('click', () => {
        sync();
        q.options.push('');
        q.optionImages.push(null);
        draw();
      });
      modal.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          sync();
          const i = Number(btn.dataset.remove);
          q.options.splice(i, 1);
          q.optionImages.splice(i, 1);
          q.corrects = q.corrects.filter(c => c !== i).map(c => (c > i ? c - 1 : c));
          if ((q.type === 'quiz') && q.corrects.length === 0) q.corrects = [0];
          draw();
        });
      });

      /* --- aplicar tempo a todas --- */
      modal.querySelector('#apply-time-all').addEventListener('click', () => {
        sync();
        const value = q.timeLimit;
        training.questions.forEach(other => { other.timeLimit = value; });
        if (question) question.timeLimit = value;
        Store.upsertTraining(training);
        const link = modal.querySelector('#apply-time-all');
        link.textContent = '✔ Aplicado a todas';
        setTimeout(() => { link.textContent = 'Aplicar a todas as perguntas'; }, 1800);
      });

      /* --- salvar / cancelar / fechar --- */
      modal.querySelector('.modal-close').addEventListener('click', closeModal);
      modal.querySelector('#btn-cancel-q').addEventListener('click', closeModal);
      modal.querySelector('#btn-save-q').addEventListener('click', () => {
        sync();
        const err = modal.querySelector('#q-error');
        const fail = msg => { err.textContent = msg; err.style.display = 'block'; };
        if (!q.text.trim()) return fail('Informe o enunciado da questão.');
        if (q.type === 'quiz' || q.type === 'poll') {
          const filled = q.options.map((o, i) => ({ text: o.trim(), image: q.optionImages[i], i }))
            .filter(o => o.text || o.image);
          if (filled.length < 2) return fail('Preencha pelo menos 2 alternativas (texto ou imagem).');
          const empty = q.options.findIndex((o, i) => !o.trim() && !q.optionImages[i]);
          // remove alternativas totalmente vazias do fim/meio
          if (empty >= 0) {
            const keepIdx = filled.map(o => o.i);
            q.corrects = q.corrects.filter(c => keepIdx.includes(c)).map(c => keepIdx.indexOf(c));
            q.options = filled.map(o => o.text || ' ');
            q.optionImages = filled.map(o => o.image);
          }
          if (q.type === 'quiz' && q.corrects.length === 0) return fail('Marque a alternativa correta.');
        }
        if (q.type === 'short' && q.answers.length === 0) {
          return fail('Informe ao menos uma resposta aceita.');
        }
        if (q.type === 'pin' && !q.image) {
          return fail('Adicione uma imagem — os participantes tocarão nela para largar o marcador.');
        }
        if (q.type === 'slider') {
          if (!(Number(q.sliderMax) > Number(q.sliderMin))) return fail('O valor máximo deve ser maior que o mínimo.');
          if (!(Number(q.sliderStep) > 0)) q.sliderStep = 1;
          const a = Number(q.sliderAnswer);
          if (!Number.isFinite(a) || a < q.sliderMin || a > q.sliderMax) {
            return fail('A resposta correta deve estar dentro da faixa do controle.');
          }
          if (!(Number(q.sliderTolerance) >= 0)) q.sliderTolerance = 0;
        }
        q.text = q.text.trim();
        const saved = Store.getTraining(training.id);
        if (isNew) {
          saved.questions.push(q);
        } else {
          const idx = saved.questions.findIndex(x => x.id === q.id);
          if (idx >= 0) saved.questions[idx] = q; else saved.questions.push(q);
        }
        try {
          Store.upsertTraining(saved);
        } catch {
          return fail('Espaço de armazenamento cheio — use menos imagens ou imagens menores.');
        }
        closeModal();
        onSave();
      });
    };

    draw();
  }

  /* ==================== Aba: Resultados ==================== */
  function renderResultsTab(content) {
    const results = Store.getResults();
    const trainings = [...new Set(results.map(r => r.trainingName))];

    content.innerHTML = `
      <div class="card">
        <div class="quiz-header">
          <h2 style="margin:0">Resultados registrados (${results.length})</h2>
          <div class="admin-actions">
            <select id="filter-training" style="width:auto">
              <option value="">Todos os treinamentos</option>
              ${trainings.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
            </select>
            <button class="btn btn-secondary btn-sm" id="btn-csv" ${results.length === 0 ? 'disabled' : ''}>⬇ Exportar CSV</button>
            <button class="btn btn-danger btn-sm" id="btn-clear" ${results.length === 0 ? 'disabled' : ''}>Limpar</button>
          </div>
        </div>
        <div class="notice notice-info" style="margin-top:12px">
          Ao final de cada jogo ao vivo conduzido <strong>neste navegador</strong>, o resultado de todos os
          participantes (nota e aprovação) é gravado automaticamente aqui.
        </div>
        <div class="table-wrap" id="results-table"></div>
      </div>
    `;

    const tableWrap = content.querySelector('#results-table');
    const filterSel = content.querySelector('#filter-training');

    const drawTable = () => {
      const filter = filterSel.value;
      const rows = filter ? results.filter(r => r.trainingName === filter) : results;
      if (rows.length === 0) {
        tableWrap.innerHTML = '<p class="muted" style="padding:16px 0">Nenhum resultado para exibir.</p>';
        return;
      }
      tableWrap.innerHTML = `
        <table>
          <thead>
            <tr><th>Data</th><th>Treinamento</th><th>Participante</th><th>Acertos</th><th>Nota</th><th>Situação</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${new Date(r.date).toLocaleString('pt-BR')}</td>
                <td>${esc(r.trainingName)}</td>
                <td>${esc(r.participant)}</td>
                <td>${r.correct}/${r.total}</td>
                <td><strong>${r.score === null ? '—' : r.score + '%'}</strong></td>
                <td>${r.passed === null
                  ? '<span class="pill">Participou</span>'
                  : `<span class="pill ${r.passed ? 'pill-pass' : 'pill-fail'}">${r.passed ? 'Aprovado' : 'Reprovado'}</span>`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    };
    drawTable();
    filterSel.addEventListener('change', drawTable);

    content.querySelector('#btn-csv').addEventListener('click', () => {
      const filter = filterSel.value;
      const rows = filter ? results.filter(r => r.trainingName === filter) : results;
      const header = ['Data', 'Treinamento', 'Participante', 'Acertos', 'Total', 'Nota (%)', 'Situacao'];
      const csvEsc = v => `"${String(v).replace(/"/g, '""')}"`;
      const lines = [header.join(';')].concat(rows.map(r => [
        new Date(r.date).toLocaleString('pt-BR'),
        r.trainingName, r.participant, r.correct, r.total,
        r.score === null ? '' : r.score,
        r.passed === null ? 'Participou' : (r.passed ? 'Aprovado' : 'Reprovado'),
      ].map(csvEsc).join(';')));
      // BOM para o Excel abrir acentos corretamente
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `resultados-quiz-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    content.querySelector('#btn-clear').addEventListener('click', () => {
      if (confirm('Apagar TODOS os resultados registrados neste navegador?')) {
        Store.clearResults();
        renderResultsTab(content);
      }
    });
  }

  /* ==================== Aba: Configurações ==================== */
  function renderSettingsTab(content) {
    content.innerHTML = `
      <div class="card">
        <h2>Alterar PIN de acesso</h2>
        <div class="field-row">
          <div class="field">
            <label for="new-pin">Novo PIN</label>
            <input type="password" id="new-pin" placeholder="Mínimo 4 caracteres">
          </div>
          <div class="field">
            <label for="new-pin2">Confirmar novo PIN</label>
            <input type="password" id="new-pin2">
          </div>
        </div>
        <p class="muted" id="pin-msg"></p>
        <button class="btn btn-primary" id="btn-save-pin">Salvar PIN</button>
      </div>
      <div class="card">
        <h2>Backup dos treinamentos</h2>
        <p class="muted" style="margin-bottom:14px">
          Exporte os treinamentos para um arquivo JSON (para guardar ou levar a outro navegador) e importe quando precisar.
        </p>
        <div class="btn-row" style="margin:0">
          <button class="btn btn-secondary" id="btn-export">⬇ Exportar treinamentos</button>
          <button class="btn btn-ghost" id="btn-import">⬆ Importar treinamentos</button>
          <input type="file" id="import-file" accept=".json,application/json" style="display:none">
        </div>
        <p class="muted" id="io-msg" style="margin-top:10px"></p>
      </div>
      <div class="card">
        <h2>Sessão</h2>
        <button class="btn btn-ghost" id="btn-logout">Sair da administração</button>
      </div>
    `;

    content.querySelector('#btn-save-pin').addEventListener('click', () => {
      const p1 = content.querySelector('#new-pin').value;
      const p2 = content.querySelector('#new-pin2').value;
      const msg = content.querySelector('#pin-msg');
      if (p1.length < 4) { msg.textContent = 'O PIN deve ter pelo menos 4 caracteres.'; msg.style.color = 'var(--danger)'; return; }
      if (p1 !== p2) { msg.textContent = 'Os PINs não conferem.'; msg.style.color = 'var(--danger)'; return; }
      Store.setPin(p1);
      msg.textContent = '✔ PIN alterado com sucesso.';
      msg.style.color = 'var(--success)';
      content.querySelector('#new-pin').value = '';
      content.querySelector('#new-pin2').value = '';
    });

    content.querySelector('#btn-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(Store.getTrainings(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `treinamentos-quiz-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    const fileInput = content.querySelector('#import-file');
    content.querySelector('#btn-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const msg = content.querySelector('#io-msg');
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error('formato inválido');
          let count = 0;
          data.forEach(t => {
            if (t && t.name && Array.isArray(t.questions)) {
              if (!t.id) t.id = Store.uid();
              Store.upsertTraining(t);
              count++;
            }
          });
          msg.textContent = `✔ ${count} treinamento(s) importado(s).`;
          msg.style.color = 'var(--success)';
        } catch {
          msg.textContent = 'Arquivo inválido — selecione um JSON exportado por este sistema.';
          msg.style.color = 'var(--danger)';
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });

    content.querySelector('#btn-logout').addEventListener('click', () => {
      sessionStorage.removeItem('qc_admin_ok');
      location.hash = '#/';
    });
  }

  return { render };
})();
