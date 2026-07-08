# 🎓 Quiz Copérdia

Quiz interativo **ao vivo (estilo Kahoot)** para validar o aprendizado ao final dos treinamentos.

O instrutor projeta as perguntas no telão, os participantes entram pelo celular com um **PIN de 6 dígitos**, respondem com botões coloridos, ganham **pontos por velocidade** e acompanham o **ranking em tempo real**. Ao final, o sistema mostra o pódio e registra a **nota e a situação (aprovado/reprovado)** de cada participante.

## Como funciona

### Instrutor
1. Acesse **Administração** (PIN padrão: `1234` — altere na aba Configurações).
2. Cadastre o treinamento e as questões (2 a 6 alternativas, tempo por questão e nota mínima configuráveis).
3. Clique em **▶ Iniciar ao vivo** e projete a tela: ela exibe o PIN do jogo.
4. Quando todos entrarem, clique em **Iniciar jogo**. Entre uma questão e outra o telão mostra a resposta correta, a distribuição das respostas e o ranking parcial.
5. Ao final, o pódio é exibido e o resultado de todos (nota % e aprovação) é gravado na aba **Resultados**, com exportação para **CSV**.

### Participante
1. Abra o endereço do sistema no celular.
2. Digite o **PIN** exibido no telão e o seu **nome**.
3. Responda cada questão tocando no botão colorido — quanto mais rápido acertar, mais pontos (500 a 1000 por acerto).

## Regras de pontuação e aprovação

- Acerto vale de **500 a 1000 pontos**, conforme a velocidade da resposta (fórmula estilo Kahoot).
- Erro ou tempo esgotado: 0 pontos.
- O ranking do jogo é por **pontos**; a **aprovação** é pelo **percentual de acertos** comparado à nota mínima do treinamento (ex.: 70%).

## Executar localmente

Requer apenas Node.js 18+ (sem dependências externas):

```bash
npm start
# abre em http://localhost:3000
```

## Publicar no Railway

1. Acesse [railway.app](https://railway.app) e faça login com o GitHub.
2. **New Project → Deploy from GitHub repo** e selecione `trmartello/quiz_coperdia` (autorize o acesso ao repositório se for a primeira vez).
3. Em **Settings → Environment**, nenhuma variável é necessária — o Railway define `PORT` automaticamente.
4. Em **Settings → Networking**, clique em **Generate Domain** para obter a URL pública (ex.: `quiz-coperdia.up.railway.app`).
5. Compartilhe essa URL com os colegas — é ela que os participantes abrem para digitar o PIN.

> O Railway detecta o projeto Node automaticamente e executa `npm start`. Cada push na branch configurada gera um novo deploy.

## Observações técnicas

- **Sem banco de dados**: as salas de jogo ficam em memória no servidor (expiram após 3h de inatividade). Os treinamentos, as questões e o histórico de resultados ficam no `localStorage` do navegador do instrutor — use **Configurações → Exportar/Importar treinamentos** para backup ou para trocar de máquina.
- **Tempo real** via Server-Sent Events (SSE), sem WebSocket e sem dependências.
- O PIN da administração protege apenas contra uso casual (o app roda todo no navegador); não armazene dados sensíveis nas questões.

## Estrutura do projeto

```
├── index.html        # página única (SPA)
├── css/style.css     # estilos (telão, celular, admin)
├── js/
│   ├── storage.js    # treinamentos, resultados e PIN (localStorage)
│   ├── live.js       # jogo ao vivo: telas do instrutor e do participante
│   ├── admin.js      # administração: treinamentos, questões, resultados, config
│   └── app.js        # roteamento e tela de entrada (PIN)
└── server.js         # servidor Node: arquivos estáticos + API do jogo (salas, SSE)
```
