/* ===== Quiz Copérdia — área de administração ===== */

const Admin = (() => {
  let activeTab = 'trainings';
  let editingId = null; // treinamento em edição (null = listagem)

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function isAuthed() {
    return sessionStorage.getItem('qc_admin_ok') === '1';
  }

  // ---- Porta de entrada: PIN ----
  function render(container) {
    if (!isAuthed()) return renderLogin(container);
    if (editingId) {
      const t = Store.getTraining(editingId);
      if (t) return renderEditor(container, t);
      editingId = null;
    }
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

  // ---- Painel com abas ----
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

  // ---- Aba: Treinamentos ----
  function renderTrainingsTab(content, container) {
    const trainings = Store.getTrainings();
    content.innerHTML = `
      <div class="btn-row" style="margin:0 0 16px">
        <button class="btn btn-primary" id="btn-new">+ Novo treinamento</button>
      </div>
      <div id="training-list">
        ${trainings.length === 0 ? `
          <div class="empty-state">
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
                  ${t.timePerQuestion}s por questão
                </p>
              </div>
              <div class="admin-actions">
                <button class="btn btn-primary btn-sm" data-action="play" ${t.questions.length === 0 ? 'disabled title="Adicione questões antes de iniciar"' : ''}>▶ Iniciar ao vivo</button>
                <button class="btn btn-secondary btn-sm" data-action="edit">Editar</button>
                <button class="btn btn-danger btn-sm" data-action="delete">Excluir</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    content.querySelector('#btn-new').addEventListener('click', () => {
      const t = Store.newTraining({ name: 'Novo treinamento' });
      Store.upsertTraining(t);
      editingId = t.id;
      render(container);
    });

    content.querySelectorAll('.admin-training').forEach(card => {
      const id = card.dataset.id;
      card.querySelector('[data-action="edit"]').addEventListener('click', () => {
        editingId = id;
        render(container);
      });
      card.querySelector('[data-action="delete"]').addEventListener('click', () => {
        const t = Store.getTraining(id);
        if (confirm(`Excluir o treinamento "${t.name}"? Esta ação não pode ser desfeita.`)) {
          Store.deleteTraining(id);
          renderPanel(container);
        }
      });
      const playBtn = card.querySelector('[data-action="play"]');
      if (playBtn && !playBtn.disabled) {
        playBtn.addEventListener('click', () => {
          location.hash = `#/host/${id}`;
        });
      }
    });
  }

  // ---- Editor de treinamento + perguntas ----
  function renderEditor(container, training) {
    container.innerHTML = `
      <div class="btn-row" style="margin:0 0 12px">
        <button class="btn btn-ghost btn-sm" id="btn-back">← Voltar aos treinamentos</button>
      </div>
      <div class="card">
        <h2>Dados do treinamento</h2>
        <div class="field">
          <label for="t-name">Nome do treinamento</label>
          <input type="text" id="t-name" value="${esc(training.name)}">
        </div>
        <div class="field">
          <label for="t-desc">Descrição (opcional)</label>
          <textarea id="t-desc" rows="2">${esc(training.description)}</textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="t-pass">Nota mínima para aprovação (%)</label>
            <input type="number" id="t-pass" min="0" max="100" value="${training.passScore}">
          </div>
          <div class="field">
            <label for="t-time">Tempo por questão (segundos)</label>
            <input type="number" id="t-time" min="5" max="600" value="${training.timePerQuestion}">
          </div>
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:8px;font-weight:400">
            <input type="checkbox" id="t-shuffle" ${training.shuffleQuestions ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary)">
            Embaralhar a ordem das questões a cada aplicação
          </label>
        </div>
        <button class="btn btn-primary" id="btn-save-info">Salvar dados</button>
        <span class="muted" id="save-feedback" style="margin-left:10px"></span>
      </div>

      <div class="card">
        <h2>Questões (${training.questions.length})</h2>
        <div id="question-list">
          ${training.questions.map((q, i) => `
            <div class="question-card" data-qid="${q.id}">
              <div class="head">
                <strong>${i + 1}. ${esc(q.text) || '<em>sem enunciado</em>'}</strong>
                <div class="admin-actions">
                  <button class="btn btn-secondary btn-sm" data-action="edit-q">Editar</button>
                  <button class="btn btn-danger btn-sm" data-action="del-q">Excluir</button>
                </div>
              </div>
              <ol type="A">
                ${q.options.map((o, oi) => `<li class="${oi === q.correct ? 'correct' : ''}">${esc(o)}${oi === q.correct ? ' ✔' : ''}</li>`).join('')}
              </ol>
            </div>
          `).join('') || '<p class="muted">Nenhuma questão ainda. Adicione a primeira abaixo.</p>'}
        </div>
        <div id="question-form-area"></div>
        <div class="btn-row">
          <button class="btn btn-primary" id="btn-add-q">+ Adicionar questão</button>
        </div>
      </div>
    `;

    container.querySelector('#btn-back').addEventListener('click', () => {
      editingId = null;
      render(container);
    });

    container.querySelector('#btn-save-info').addEventListener('click', () => {
      training.name = container.querySelector('#t-name').value.trim() || 'Treinamento sem nome';
      training.description = container.querySelector('#t-desc').value.trim();
      training.passScore = Math.min(100, Math.max(0, Number(container.querySelector('#t-pass').value) || 0));
      training.timePerQuestion = Math.min(600, Math.max(5, Number(container.querySelector('#t-time').value) || 30));
      training.shuffleQuestions = container.querySelector('#t-shuffle').checked;
      Store.upsertTraining(training);
      const fb = container.querySelector('#save-feedback');
      fb.textContent = '✔ Salvo';
      setTimeout(() => { fb.textContent = ''; }, 1800);
    });

    container.querySelector('#btn-add-q').addEventListener('click', () => {
      renderQuestionForm(container, training, Store.newQuestion(), true);
    });

    container.querySelectorAll('.question-card').forEach(card => {
      const q = training.questions.find(x => x.id === card.dataset.qid);
      card.querySelector('[data-action="edit-q"]').addEventListener('click', () => {
        renderQuestionForm(container, training, q, false);
      });
      card.querySelector('[data-action="del-q"]').addEventListener('click', () => {
        if (confirm('Excluir esta questão?')) {
          training.questions = training.questions.filter(x => x.id !== q.id);
          Store.upsertTraining(training);
          renderEditor(container, training);
        }
      });
    });
  }

  // ---- Formulário de questão ----
  function renderQuestionForm(container, training, question, isNew) {
    const area = container.querySelector('#question-form-area');
    const options = question.options.slice();
    while (options.length < 2) options.push('');

    const draw = () => {
      area.innerHTML = `
        <div class="card" style="background:var(--primary-light);margin-top:14px">
          <h2>${isNew ? 'Nova questão' : 'Editar questão'}</h2>
          <div class="field">
            <label for="q-text">Enunciado</label>
            <textarea id="q-text" rows="2" placeholder="Digite a pergunta">${esc(question.text)}</textarea>
          </div>
          <label>Alternativas — marque a correta</label>
          <div id="q-options" style="margin-top:8px">
            ${options.map((o, i) => `
              <div class="option-edit-row">
                <input type="radio" name="q-correct" value="${i}" ${i === question.correct ? 'checked' : ''}>
                <input type="text" data-opt="${i}" value="${esc(o)}" placeholder="Alternativa ${String.fromCharCode(65 + i)}">
                ${options.length > 2 ? `<button class="btn btn-ghost btn-sm" data-remove="${i}" title="Remover alternativa">✕</button>` : ''}
              </div>
            `).join('')}
          </div>
          <div class="btn-row" style="margin-top:6px">
            ${options.length < 6 ? '<button class="btn btn-ghost btn-sm" id="btn-add-opt">+ Alternativa</button>' : ''}
          </div>
          <p class="muted" id="q-error" style="color:var(--danger);display:none"></p>
          <div class="btn-row">
            <button class="btn btn-primary" id="btn-save-q">Salvar questão</button>
            <button class="btn btn-ghost" id="btn-cancel-q">Cancelar</button>
          </div>
        </div>
      `;

      const syncOptions = () => {
        area.querySelectorAll('[data-opt]').forEach(inp => {
          options[Number(inp.dataset.opt)] = inp.value;
        });
        const checked = area.querySelector('input[name="q-correct"]:checked');
        if (checked) question.correct = Number(checked.value);
        question.text = area.querySelector('#q-text').value;
      };

      const addOptBtn = area.querySelector('#btn-add-opt');
      if (addOptBtn) addOptBtn.addEventListener('click', () => {
        syncOptions();
        options.push('');
        draw();
      });

      area.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          syncOptions();
          const idx = Number(btn.dataset.remove);
          options.splice(idx, 1);
          if (question.correct >= options.length) question.correct = 0;
          draw();
        });
      });

      area.querySelector('#btn-cancel-q').addEventListener('click', () => {
        area.innerHTML = '';
      });

      area.querySelector('#btn-save-q').addEventListener('click', () => {
        syncOptions();
        const text = question.text.trim();
        const filled = options.map(o => o.trim());
        const err = area.querySelector('#q-error');
        if (!text) {
          err.textContent = 'Informe o enunciado da questão.';
          err.style.display = 'block';
          return;
        }
        if (filled.some(o => !o)) {
          err.textContent = 'Preencha todas as alternativas (ou remova as vazias).';
          err.style.display = 'block';
          return;
        }
        question.text = text;
        question.options = filled;
        if (isNew) training.questions.push(question);
        Store.upsertTraining(training);
        renderEditor(container, training);
      });

      area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    draw();
  }

  // ---- Aba: Resultados ----
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
            <tr><th>Data</th><th>Treinamento</th><th>Participante</th><th>Acertos</th><th>Nota</th><th>Situação</th><th>Tempo</th></tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${new Date(r.date).toLocaleString('pt-BR')}</td>
                <td>${esc(r.trainingName)}</td>
                <td>${esc(r.participant)}</td>
                <td>${r.correct}/${r.total}</td>
                <td><strong>${r.score}%</strong></td>
                <td><span class="pill ${r.passed ? 'pill-pass' : 'pill-fail'}">${r.passed ? 'Aprovado' : 'Reprovado'}</span></td>
                <td>${r.durationSec}s</td>
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
      const header = ['Data', 'Treinamento', 'Participante', 'Acertos', 'Total', 'Nota (%)', 'Situacao', 'Tempo (s)'];
      const csvEsc = v => `"${String(v).replace(/"/g, '""')}"`;
      const lines = [header.join(';')].concat(rows.map(r => [
        new Date(r.date).toLocaleString('pt-BR'),
        r.trainingName, r.participant, r.correct, r.total, r.score,
        r.passed ? 'Aprovado' : 'Reprovado', r.durationSec,
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

  // ---- Aba: Configurações ----
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
