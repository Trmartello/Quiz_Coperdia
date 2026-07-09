/* ===== Quiz Copérdia — camada de dados (localStorage) ===== */

const Store = (() => {
  const KEY_TRAININGS = 'qc_trainings';
  const KEY_RESULTS = 'qc_results';
  const KEY_PIN = 'qc_admin_pin';
  const KEY_SEEDED = 'qc_seeded';
  const DEFAULT_PIN = '1234';

  // Categorias do seletor de tipos (estilo Kahoot)
  const TYPE_CATEGORIES = [
    { id: 'know', label: 'Testar conhecimento' },
    { id: 'opinion', label: 'Coletar opiniões' },
    { id: 'slides', label: 'Slides' },
  ];

  // Tipos de pergunta (estilo Kahoot)
  const QUESTION_TYPES = {
    quiz: { label: 'Quiz', icon: '🟥', cat: 'know', desc: 'Alternativas coloridas com resposta correta. Pontua pela velocidade.' },
    tf: { label: 'Verdadeiro ou falso', icon: '⚖️', cat: 'know', desc: 'Deixe os participantes decidirem se a afirmação é verdadeira ou falsa.' },
    short: { label: 'Resposta curta', icon: '⌨️', cat: 'know', desc: 'Os participantes digitam a resposta. Acerta quem escrever uma das respostas aceitas.' },
    slider: { label: 'Controle deslizante', icon: '🎚️', cat: 'know', desc: 'Os participantes arrastam um controle para acertar o valor correto em uma faixa numérica.' },
    puzzle: { label: 'Puzzle', icon: '🧩', cat: 'know', desc: 'Os participantes colocam as alternativas na ordem correta. Elas aparecem embaralhadas.' },
    poll: { label: 'Enquete', icon: '📊', cat: 'opinion', desc: 'Coleta opiniões com alternativas — sem resposta certa e sem pontos.' },
    scale: { label: 'Escala', icon: '📏', cat: 'opinion', desc: 'Os participantes avaliam de 1 a 5 (ex.: discordo → concordo). Sem pontos.' },
    nps: { label: 'Escala NPS', icon: '💯', cat: 'opinion', desc: 'Meça satisfação e lealdade de 0 a 10 e veja o NPS (promotores − detratores) no telão.' },
    pin: { label: 'Largar marcador', icon: '📍', cat: 'opinion', desc: 'Os participantes tocam em um ponto da imagem — os marcadores aparecem no telão.' },
    wordcloud: { label: 'Nuvem de palavras', icon: '☁️', cat: 'opinion', desc: 'Respostas livres curtas formam uma nuvem de palavras no telão.' },
    brainstorm: { label: 'Brainstorm', icon: '💡', cat: 'opinion', desc: 'Colete ideias dos participantes e depois abra a votação para ranquear as melhores.' },
    open: { label: 'Pergunta aberta', icon: '💬', cat: 'opinion', desc: 'Respostas livres mais longas aparecem como cartões com o nome de quem respondeu.' },
    slide: { label: 'Slide', icon: '🖼️', cat: 'slides', desc: 'Tela de conteúdo (título, texto e imagem) para explicar algo entre as questões.' },
  };

  // Layouts de slide (estilo Kahoot)
  const SLIDE_LAYOUTS = {
    classic: 'Clássico',
    'big-title': 'Título grande',
    'title-text': 'Título e texto',
    bullets: 'Pontos principais',
    quote: 'Citação',
    'big-media': 'Mídia grande',
  };

  const TIME_OPTIONS = [5, 10, 20, 30, 45, 60, 90, 120, 180, 240];

  const POINTS_OPTIONS = {
    standard: { label: 'Padrão', desc: 'Quantidade normal de pontos para respostas corretas' },
    double: { label: 'Pontos duplos', desc: 'O dobro de pontos para respostas corretas' },
    none: { label: 'Nenhum ponto', desc: 'A pergunta não vale pontos' },
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // ---- Modelos ----
  function newTraining(data = {}) {
    return {
      id: uid(),
      name: '',
      description: '',
      passScore: 70,        // % mínimo para aprovação
      timePerQuestion: 20,  // tempo padrão (s) para perguntas sem limite próprio
      shuffleQuestions: false,
      showRanking: true,    // exibe ranking (e subiu/desceu) entre as questões
      questions: [],
      ...data,
    };
  }

  function newQuestion(data = {}) {
    return {
      id: uid(),
      type: 'quiz',          // quiz | tf | short | poll | scale | wordcloud | slide
      text: '',
      options: ['', '', '', ''],
      corrects: [0],         // índices corretos (quiz/tf); vazio nos demais
      answers: [],           // short: respostas aceitas (texto)
      multi: false,          // quiz: múltipla escolha (selecionar várias antes de enviar)
      maxAnswers: 1,         // wordcloud: quantas respostas cada participante pode enviar (1 a 5)
      scaleLeft: '',         // scale/nps: rótulo da ponta esquerda
      scaleRight: '',        // scale/nps: rótulo da ponta direita
      body: '',              // slide: texto de apoio
      layout: 'classic',     // slide: layout visual (SLIDE_LAYOUTS)
      reactions: true,       // participantes podem reagir com emojis nesta questão
      maxVotes: 3,           // brainstorm: votos por participante (1 a 5)
      sliderMin: 0,          // controle deslizante: faixa, passo, resposta e tolerância
      sliderMax: 100,
      sliderStep: 1,
      sliderAnswer: 50,
      sliderTolerance: 0,
      timeLimit: null,       // segundos; null = usa o padrão do treinamento
      points: 'standard',    // standard | double | none
      ...data,
    };
  }

  // Compatibilidade com dados salvos por versões anteriores
  function normalizeQuestion(q) {
    const n = newQuestion(q);
    if (q && q.correct !== undefined && q.corrects === undefined) {
      n.corrects = [q.correct];
      delete n.correct;
    }
    if (n.type === 'tf') {
      n.options = ['Verdadeiro', 'Falso'];
      if (!Array.isArray(n.corrects) || n.corrects.length !== 1) n.corrects = [0];
      n.multi = false;
    }
    const opinion = ['poll', 'wordcloud', 'scale', 'nps', 'pin', 'brainstorm', 'open', 'slide'];
    if (opinion.includes(n.type)) {
      n.corrects = [];
      n.multi = false;
      n.points = 'none';
    }
    if (n.type === 'short' || n.type === 'slider') {
      n.options = [];
      n.corrects = [];
      n.multi = false;
      n.answers = (Array.isArray(n.answers) ? n.answers : []).map(a => String(a));
    }
    if (n.type === 'puzzle') {
      // as opções JÁ estão na ordem correta; o servidor embaralha para os participantes
      n.corrects = [];
      n.multi = false;
      if (n.points === 'none') n.points = 'standard';
    }
    if (['scale', 'nps', 'pin', 'brainstorm', 'open', 'slide'].includes(n.type)) n.options = [];
    if (n.type === 'wordcloud' || n.type === 'brainstorm') {
      n.options = [];
      n.maxAnswers = Math.min(5, Math.max(1, Math.round(Number(n.maxAnswers)) || (n.type === 'brainstorm' ? 3 : 1)));
    } else {
      n.maxAnswers = 1;
    }
    n.maxVotes = Math.min(5, Math.max(1, Math.round(Number(n.maxVotes)) || 3));
    if (n.type === 'slider') {
      n.sliderMin = Number.isFinite(Number(n.sliderMin)) ? Number(n.sliderMin) : 0;
      n.sliderMax = Number.isFinite(Number(n.sliderMax)) ? Number(n.sliderMax) : 100;
      if (n.sliderMax <= n.sliderMin) { n.sliderMin = 0; n.sliderMax = 100; }
      n.sliderStep = Number(n.sliderStep) > 0 ? Number(n.sliderStep) : 1;
      n.sliderAnswer = Math.min(n.sliderMax, Math.max(n.sliderMin, Number(n.sliderAnswer) || n.sliderMin));
      n.sliderTolerance = Number(n.sliderTolerance) >= 0 ? Number(n.sliderTolerance) : 0;
    }
    n.layout = SLIDE_LAYOUTS[n.layout] ? n.layout : 'classic';
    n.reactions = n.reactions !== false;
    return n;
  }

  function normalizeTraining(t) {
    const n = newTraining(t);
    n.questions = (t.questions || []).map(normalizeQuestion);
    return n;
  }

  // ---- Treinamentos ----
  function getTrainings() {
    return read(KEY_TRAININGS, []).map(normalizeTraining);
  }

  function getTraining(id) {
    return getTrainings().find(t => t.id === id) || null;
  }

  function upsertTraining(training) {
    const all = read(KEY_TRAININGS, []);
    const idx = all.findIndex(t => t.id === training.id);
    if (idx >= 0) all[idx] = training; else all.push(training);
    write(KEY_TRAININGS, all);
    return training;
  }

  function deleteTraining(id) {
    write(KEY_TRAININGS, read(KEY_TRAININGS, []).filter(t => t.id !== id));
  }

  // ---- Resultados ----
  function getResults() {
    return read(KEY_RESULTS, []);
  }

  function addResult(result) {
    const all = getResults();
    all.unshift({ id: uid(), ...result });
    write(KEY_RESULTS, all);
  }

  function clearResults() {
    write(KEY_RESULTS, []);
  }

  // ---- PIN da administração ----
  function getPin() {
    return read(KEY_PIN, DEFAULT_PIN);
  }

  function setPin(pin) {
    write(KEY_PIN, pin);
  }

  // ---- Dados de exemplo (primeiro acesso) ----
  function seedIfEmpty() {
    if (read(KEY_SEEDED, false) || getTrainings().length > 0) return;
    const sample = newTraining({
      name: 'Exemplo — Integração de Novos Colaboradores',
      description: 'Quiz de demonstração. Edite ou exclua na área de administração.',
      passScore: 70,
      timePerQuestion: 20,
    });
    sample.questions = [
      newQuestion({
        text: 'Qual é o principal objetivo deste quiz ao final dos treinamentos?',
        options: [
          'Validar o aprendizado dos participantes',
          'Registrar a presença no treinamento',
          'Avaliar o instrutor',
          'Sortear brindes entre os participantes',
        ],
        corrects: [0],
      }),
      newQuestion({
        type: 'tf',
        text: 'Quem responde certo mais rápido ganha mais pontos.',
        options: ['Verdadeiro', 'Falso'],
        corrects: [0],
      }),
      newQuestion({
        type: 'wordcloud',
        text: 'Em uma palavra: o que você mais gostou no treinamento?',
        options: [],
        corrects: [],
        points: 'none',
      }),
    ];
    upsertTraining(sample);
    write(KEY_SEEDED, true);
  }

  return {
    uid,
    QUESTION_TYPES, TYPE_CATEGORIES, SLIDE_LAYOUTS, TIME_OPTIONS, POINTS_OPTIONS,
    getTrainings, getTraining, upsertTraining, deleteTraining,
    newTraining, newQuestion,
    getResults, addResult, clearResults,
    getPin, setPin,
    seedIfEmpty,
  };
})();
