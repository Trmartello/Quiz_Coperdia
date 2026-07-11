# Backlog — Quiz Copérdia

Itens aprovados para desenvolvimento futuro, em ordem de registro.

## 1. Reassistir os resultados (replay do ao vivo) — ✅ ENTREGUE

Após o fim do jogo, poder **reassistir os resultados questão a questão**, vendo cada
gráfico ser preenchido como aconteceu no ao vivo (colunas subindo, nuvem de palavras
se formando, ideias recebendo votos, marcadores caindo na imagem).

Notas de implementação:
- Hoje o resultado salvo (`Store.addResult`) guarda apenas o consolidado por participante.
  Será preciso gravar também, por questão: contagens/percentuais, palavras, ideias e votos,
  marcadores (x/y), valores do deslizante e o instante (`ms`) de cada resposta para animar
  o preenchimento na ordem real.
- O host já possui o snapshot completo de cada revelação em `Host.history` — persistir esse
  histórico junto com o resultado no pódio é o caminho mais curto.
- Tela de replay acessível pela aba **Resultados** da administração (botão "▶ Reassistir"),
  com navegação questão a questão reaproveitando os renderizadores do telão
  (`hostRevealBody`) + animação temporizada das respostas.

## 2. Compartilhamento com palestrante e tema — ✅ ENTREGUE

No momento de compartilhar o resultado final (WhatsApp, PDF, CSV e imagem), **solicitar
quem foi o palestrante/instrutor e o tema do Quiz** antes de gerar o conteúdo.

Notas de implementação:
- Pequeno modal antes do compartilhamento com os dois campos, pré-preenchidos com os
  últimos valores usados (localStorage).
- Incluir os dados no cabeçalho do PDF, no texto do WhatsApp, na imagem gerada
  (`sharePng`) e em colunas extras do CSV.

## 3. Resiliência de conexão e reentrada do participante — ✅ ENTREGUE

Problemas observados em produção: participantes caem da conexão durante o jogo; ao
voltar, não conseguem entrar com o mesmo nome ("já existe um participante com esse
nome") e criam um segundo usuário, perdendo a pontuação. O contador de participantes
não reflete quem está de fato conectado durante o quiz.

Causas identificadas no código atual:
- A sessão do participante fica em `sessionStorage` (`qc_player`) — morre quando o
  navegador do celular descarta a aba em segundo plano (tela bloqueada, troca de app)
  ou quando o usuário fecha/reabre pelo QR Code. Sem a sessão, a única porta é o
  `/join`, que recusa o nome repetido (o servidor ainda considera o jogador ativo).
- O `EventSource` reconecta sozinho em quedas curtas, mas não há vigia para o caso de
  a aba ser suspensa (evento `visibilitychange`/`pageshow`/`online`) nem detecção de
  stream mudo (o servidor manda `: ping` a cada 25s que o cliente ignora).
- `playersCount` = inscritos desde o início; não existe noção de "conectados agora".

Plano:
1. **Identificar o aparelho (deviceId)**: gerar um id aleatório persistido em
   `localStorage` e enviá-lo no `/join`. O servidor guarda `deviceId` no jogador;
   um novo `/join` do mesmo `pin + deviceId` devolve o MESMO `playerId`
   (reentrada transparente, pontuação preservada), mesmo que o nome seja igual.
2. **Retomada automática**: mover `qc_player` para `localStorage` (por PIN, com
   expiração). Ao abrir `#/join/<pin>` com sessão válida, pular o formulário e voltar
   direto ao jogo (`#/play/<pin>`).
3. **Conflito de nome só quando o outro está online**: recusar nome repetido apenas
   se houver conexão SSE ativa daquele jogador; caso contrário, assumir que é a mesma
   pessoa voltando (com deviceId diferente, ex.: trocou de aparelho → confirmar).
4. **Vigia de conexão no cliente**: cronômetro que reabre o `EventSource` se nenhum
   dado/ping chegar em ~40s; reabrir também em `visibilitychange`, `pageshow` e
   `online`. Mostrar aviso discreto "reconectando" sem apagar a tela atual.
5. **Presença no telão**: contar conexões SSE ativas por jogador e exibir
   "X online / Y inscritos" no lobby e durante as questões (o ✋ passa a usar os
   online); marcar visualmente no ranking quem caiu.

## 4. Vinheta da questão só com número e tipo (sem o enunciado) — ✅ ENTREGUE

A tela verde animada exibida antes de cada questão deve mostrar apenas:
- o **número da questão no total**, no formato `3/9`;
- o **modelo de resposta esperado** (ex.: ⚖️ Verdadeiro ou falso, 💬 Pergunta aberta,
  🧩 Puzzle...).

O enunciado NÃO deve aparecer na vinheta — ele só é revelado quando a questão abre.
Cria suspense e evita que alguém comece a ler/pensar na resposta antes de o tempo valer.

Notas de implementação:
- `showQuestionIntro(s)` em `js/live.js`: remover `.q-intro-text` e trocar
  `.q-intro-num` para `${s.questionIndex + 1}/${s.totalQuestions}`; manter
  `TYPE_LABELS[q.type]` como destaque (fonte grande).
- Ajustar o CSS da vinheta (`.q-intro*` em `css/style.css`) para centralizar os dois
  elementos restantes em escala maior, e o teste de UI que valida a vinheta (uitest6).
