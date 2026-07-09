/* ===== Quiz Copérdia — roteamento e tela de entrada ===== */

(() => {
  const app = document.getElementById('app');

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // ---- Tela inicial: entrar em um jogo com PIN (estilo kahoot.it) ----
  function renderHome(prefillPin) {
    app.innerHTML = `
      <div class="card live-hero join-card">
        <div class="big" style="font-size:3rem">🎓</div>
        <h1>Entrar no quiz</h1>
        <p class="subtitle">Digite o PIN exibido no telão e o seu nome.</p>
        <div class="field">
          <input type="text" id="join-pin" class="join-input" inputmode="numeric" maxlength="6"
                 placeholder="PIN do jogo" autocomplete="off" value="${esc(prefillPin || '')}">
        </div>
        <div class="field">
          <input type="text" id="join-name" class="join-input" maxlength="40"
                 placeholder="Seu nome" autocomplete="name">
        </div>
        <p class="muted" id="join-error" style="color:var(--danger);display:none"></p>
        <button class="btn btn-primary btn-lg" id="btn-join">Entrar</button>
        <p class="muted" style="margin-top:22px">
          É o instrutor? Acesse a <a href="#/admin">Administração</a> para criar quizzes e iniciar um jogo.
        </p>
      </div>
    `;

    const pinInput = app.querySelector('#join-pin');
    const nameInput = app.querySelector('#join-name');
    const errEl = app.querySelector('#join-error');

    pinInput.addEventListener('input', () => {
      pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 6);
    });

    const tryJoin = async () => {
      const pin = pinInput.value.trim();
      const name = nameInput.value.trim();
      errEl.style.display = 'none';
      if (pin.length !== 6) {
        errEl.textContent = 'O PIN tem 6 dígitos.';
        errEl.style.display = 'block';
        pinInput.focus();
        return;
      }
      if (!name) {
        errEl.textContent = 'Informe seu nome.';
        errEl.style.display = 'block';
        nameInput.focus();
        return;
      }
      const btn = app.querySelector('#btn-join');
      btn.disabled = true;
      btn.textContent = 'Entrando...';
      try {
        await Live.join(pin, name);
        location.hash = `#/play/${pin}`;
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    };

    app.querySelector('#btn-join').addEventListener('click', tryJoin);
    [pinInput, nameInput].forEach(el =>
      el.addEventListener('keydown', e => { if (e.key === 'Enter') tryJoin(); })
    );
    // Veio pelo QR Code / link com PIN? Vai direto para o nome
    if (prefillPin && prefillPin.length === 6) nameInput.focus();
    else pinInput.focus();
  }

  function renderNotFound(message) {
    app.innerHTML = `
      <div class="card empty-state">
        <div class="big">🔎</div>
        <p>${esc(message || 'Página não encontrada.')}</p>
        <div class="btn-row" style="justify-content:center">
          <a href="#/" class="btn btn-primary">Ir para o início</a>
        </div>
      </div>
    `;
  }

  // ---- Roteador por hash ----
  function route() {
    Live.stop(); // encerra conexões/timers da tela anterior
    const hash = location.hash || '#/';
    const parts = hash.replace(/^#\//, '').split('/');

    if (parts[0] === '' || parts[0] === undefined) {
      renderHome();
    } else if (parts[0] === 'join' && parts[1]) {
      renderHome(parts[1].replace(/\D/g, '').slice(0, 6));
    } else if (parts[0] === 'play' && parts[1]) {
      Live.renderPlayer(app, parts[1]);
    } else if (parts[0] === 'host' && parts[1]) {
      Live.renderHost(app, parts[1]);
    } else if (parts[0] === 'admin') {
      Admin.render(app);
    } else {
      renderNotFound();
    }
    window.scrollTo(0, 0);
  }

  Store.seedIfEmpty();
  window.addEventListener('hashchange', route);
  route();
})();
