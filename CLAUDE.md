# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O projeto

Quiz interativo ao vivo (estilo Kahoot) para validar o aprendizado ao final de treinamentos da Copérdia. O instrutor projeta o telão com PIN/QR Code; participantes respondem pelo celular; pontuação por velocidade, ranking em tempo real, pódio e registro de aprovação/reprovação.

**Zero dependências de runtime** — apenas Node.js ≥18 e JavaScript puro no navegador (sem build, sem framework, sem banco de dados). A única biblioteca é `js/vendor/qrcode.js` (qrcode-generator, MIT), vendorizada. Manter assim: qualquer nova dependência precisa de forte justificativa.

## Comandos

```bash
npm start          # roda o servidor em http://localhost:3000 (PORT via env)
node --check js/*.js server.js   # validação de sintaxe (não há linter configurado)
```

Não há suite de testes commitada. A verificação é feita com scripts Node avulsos:
- **API**: script que faz `fetch` nos endpoints e lê o stream SSE (criar sala → join → start → answer → reveal → podium), com asserts.
- **UI**: `playwright-core` (npm) + Chromium pré-instalado em `/opt/pw-browsers/` (usar `executablePath`, não baixar browsers), simulando o telão do instrutor e participantes em contexts separados.

## Deploy

- Railway faz deploy automático da branch **`main`** (detecta Node e roda `npm start`). URL de produção: `quizcoperdia-production.up.railway.app`.
- Fluxo: desenvolver na branch de trabalho → push → `git checkout main && git merge --ff-only <branch> && git push origin main` para publicar.

## Arquitetura

```
Navegador do instrutor                    Servidor Node (server.js)          Celular do participante
┌────────────────────────┐   POST /api/rooms   ┌──────────────────┐   POST /join, /answer  ┌──────────────┐
│ admin.js: treinamentos │ ──(quiz JSON)──────▶│ salas em MEMÓRIA │◀───────────────────────│ app.js: PIN  │
│ em localStorage        │                     │ (Map por PIN)    │                        │ + avatar     │
│ live.js (host): lobby, │◀──SSE /events───────│ estado + timers  │───SSE /events─────────▶│ live.js      │
│ telão, pódio           │   snapshots         │ por papel        │   snapshots            │ (player)     │
└────────────────────────┘                     └──────────────────┘                        └──────────────┘
```

Pontos que exigem entender múltiplos arquivos:

- **Os dados dos quizzes vivem no `localStorage` do navegador do instrutor** (`js/storage.js`), não no servidor. Ao iniciar um jogo, `live.js` envia uma cópia do treinamento para `POST /api/rooms`; o servidor sanitiza (`sanitizeQuiz`) e mantém a sala só em memória (TTL 3h). Resultados do jogo voltam para o `localStorage` do instrutor no pódio (`drawHostPodium` → `Store.addResult`).
- **Sincronização em tempo real é SSE, não WebSocket.** `broadcast(room)` gera um snapshot POR CONEXÃO via `snapshotFor(room, conn)` — o payload é diferente para host e player (ex.: player não recebe `corrects` durante a questão). Qualquer campo novo deve ser adicionado ali, decidindo quem pode vê-lo.
- **Máquina de estados da sala**: `lobby → question → reveal → (question... ) → podium`. `reveal` acontece por comando do host, timeout do servidor (`questionTimer`) ou quando todos respondem. Os deltas de posição (▲/▼) são calculados na transição para `reveal` comparando `prevRanks`.
- **Tipos de pergunta** (`quiz`, `tf`, `poll`, `wordcloud`) definidos em `js/storage.js` (`QUESTION_TYPES`) e validados independentemente em `server.js` (`sanitizeQuiz`). `poll`/`wordcloud` não pontuam e ficam fora da base da nota (`scorableTotal`); a aprovação usa % de acertos só de `quiz`+`tf` contra `passScore`.
- **Listas duplicadas cliente/servidor**: a lista de avatares (`AVATARS`) existe em `js/app.js` E `server.js`; os tipos de pergunta existem em `storage.js` E `server.js`. Alterou um, altere o outro.
- **Frontend é SPA com roteamento por hash** (`js/app.js`): `#/` entrada com PIN, `#/join/<pin>` PIN pré-preenchido (QR), `#/play/<pin>` participante, `#/host/<id>` telão, `#/admin` administração. Cada tela é uma função `render*` que substitui `#app` via innerHTML; sempre escapar conteúdo com `esc()`.
- **Modais** (admin) renderizam em `#modal-root`, fora de `#app` — sobrevivem aos re-renders das telas (o zoom do QR usa o mesmo truque).
- **Imagens** de perguntas/alternativas são data-URLs JPEG comprimidas no navegador (`pickImage` em admin.js) e trafegam dentro do JSON do quiz — limites de tamanho validados no servidor (`sanitizeImage`) e limite de payload de 12MB.
- **Compatibilidade de dados**: `storage.js` normaliza treinamentos antigos ao ler (`normalizeQuestion` converte `correct` → `corrects` etc.). Mudanças no modelo devem manter essa migração.

## Convenções

- Idioma: código comentado e toda a UI em **português (pt-BR)**.
- PIN da administração padrão `1234` (localStorage) — proteção apenas casual; não é autenticação real.
- CSS usa variáveis em `:root` com a paleta da logomarca Copérdia (verde `#0e9a44`, laranja `#f5a800`); manter a mesma linha visual em novas telas.
- CSV exportado usa separador `;` e BOM UTF-8 (Excel brasileiro).
