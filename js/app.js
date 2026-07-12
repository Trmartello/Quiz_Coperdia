/* ===== Quiz Copérdia — roteamento e tela de entrada ===== */

(() => {
  const app = document.getElementById('app');

  // Versão exibida no rodapé — atualize a cada publicação para conferir se o navegador está com o código novo
  const QC_VERSION = 'v2026-07-13.3';
  const versionEl = document.getElementById('app-version');
  if (versionEl) versionEl.textContent = QC_VERSION;

  // Logomarca personalizada: troca o logotipo no retângulo branco da topbar.
  // Guarda o SVG padrão para poder restaurar.
  const defaultBrandHtml = (document.querySelector('.brand-icon') || {}).outerHTML || '';
  function applyLogo(dataUrl) {
    const current = document.querySelector('.brand-icon');
    if (!current) return;
    if (dataUrl) {
      const img = document.createElement('img');
      img.className = 'brand-icon brand-custom';
      img.src = dataUrl;
      img.alt = 'Logomarca';
      // Link quebrado (imagem fora do ar)? Volta para a logomarca padrão
      img.addEventListener('error', () => {
        if (defaultBrandHtml && img.isConnected) img.outerHTML = defaultBrandHtml;
      });
      current.replaceWith(img);
    } else if (defaultBrandHtml) {
      current.outerHTML = defaultBrandHtml;
    }
  }
  window.QCApplyLogo = applyLogo; // usado por live.js (jogador) e admin.js (upload)
  applyLogo(Store.getLogo());

  // Mesma lista do servidor — avatares permitidos
  const AVATARS = ['😀','😎','🤩','😜','🤓','😺','🐶','🐼','🦊','🦁','🐸','🐵','🦄','🐙','🐝','🦉','🚀','⚽','🎮','🎸','🔥','⭐','🍕','🤖','👻','🤠','💪','🧠','🎯','🏆'];

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
        <div class="field" style="text-align:left">
          <label>Escolha seu avatar</label>
          <div class="avatar-picker" id="avatar-picker">
            ${AVATARS.map(a => `<button type="button" class="avatar-opt" data-avatar="${a}">${a}</button>`).join('')}
          </div>
        </div>
        <p class="muted" id="join-error" style="color:var(--danger);display:none"></p>
        <button class="btn btn-primary btn-lg" id="btn-join">Entrar</button>
      </div>
    `;

    const pinInput = app.querySelector('#join-pin');
    const nameInput = app.querySelector('#join-name');
    const errEl = app.querySelector('#join-error');

    // Avatar: começa com um aleatório já selecionado
    let avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const paintAvatars = () => {
      app.querySelectorAll('.avatar-opt').forEach(b =>
        b.classList.toggle('selected', b.dataset.avatar === avatar));
    };
    paintAvatars();
    app.querySelectorAll('.avatar-opt').forEach(b => {
      b.addEventListener('click', () => { avatar = b.dataset.avatar; paintAvatars(); });
    });

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
        await Live.join(pin, name, avatar);
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

  // ---- Bem-vindo de volta: confirma a identidade antes de retomar a sessão ----
  function renderResume(pin, saved) {
    app.innerHTML = `
      <div class="card live-hero join-card">
        <div class="big-avatar">${esc(saved.avatar || '🙂')}</div>
        <h1>Bem-vindo de volta!</h1>
        <p class="subtitle">Você é <strong>${esc(saved.name)}</strong>? Sua pontuação está guardada.</p>
        <button class="btn btn-primary btn-lg" id="btn-resume">✅ Sim, continuar como ${esc(saved.name)}</button>
        <button class="btn btn-ghost" id="btn-not-me" style="width:100%;margin-top:10px">Não sou eu — entrar como outra pessoa</button>
      </div>
    `;
    app.querySelector('#btn-resume').addEventListener('click', () => {
      location.hash = `#/play/${pin}`;
    });
    app.querySelector('#btn-not-me').addEventListener('click', async e => {
      e.target.disabled = true;
      await Live.forgetSession(pin); // desvincula este navegador do jogador anterior
      renderHome(pin);
    });
  }

  // ---- Roteador por hash ----
  function route() {
    Live.stop(); // encerra conexões/timers da tela anterior
    const hash = location.hash || '#/';
    const parts = hash.replace(/^#\//, '').split('/');

    // O acesso à administração só aparece nas telas do instrutor (telão e a própria administração).
    // Participantes (entrada, QR Code, link e jogo) não veem o botão — o instrutor acessa por /#/admin.
    const nav = document.querySelector('.topbar nav');
    if (nav) nav.style.display = (parts[0] === 'host' || parts[0] === 'admin') ? '' : 'none';

    // Modo telão: no host tudo fica maior e mais denso (público pode estar longe da projeção)
    document.body.classList.toggle('screen-host', parts[0] === 'host');

    if (parts[0] === '' || parts[0] === undefined) {
      renderHome();
    } else if (parts[0] === 'join' && parts[1]) {
      const pin = parts[1].replace(/\D/g, '').slice(0, 6);
      // Sessão guardada para este PIN? Confirma a identidade antes de retomar
      // (em computador compartilhado, outra pessoa pode estar usando o mesmo navegador).
      const saved = pin.length === 6 ? Live.sessionInfo(pin) : null;
      if (saved) {
        renderResume(pin, saved);
      } else {
        renderHome(pin);
      }
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
