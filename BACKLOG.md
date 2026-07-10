# Backlog — Quiz Copérdia

Itens aprovados para desenvolvimento futuro, em ordem de registro.

## 1. Reassistir os resultados (replay do ao vivo)

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

## 2. Compartilhamento com palestrante e tema

No momento de compartilhar o resultado final (WhatsApp, PDF, CSV e imagem), **solicitar
quem foi o palestrante/instrutor e o tema do Quiz** antes de gerar o conteúdo.

Notas de implementação:
- Pequeno modal antes do compartilhamento com os dois campos, pré-preenchidos com os
  últimos valores usados (localStorage).
- Incluir os dados no cabeçalho do PDF, no texto do WhatsApp, na imagem gerada
  (`sharePng`) e em colunas extras do CSV.
