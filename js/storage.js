/* ===== Quiz Copérdia — camada de dados (localStorage) ===== */

const Store = (() => {
  const KEY_TRAININGS = 'qc_trainings';
  const KEY_RESULTS = 'qc_results';
  const KEY_PIN = 'qc_admin_pin';
  const KEY_SEEDED = 'qc_seeded';
  const DEFAULT_PIN = '1234';

  // Tipos de pergunta (estilo Kahoot)
  const QUESTION_TYPES = {
    quiz: { label: 'Quiz', icon: '🟥', desc: 'Alternativas coloridas com resposta correta' },
    tf: { label: 'Verdadeiro ou falso', icon: '⚖️', desc: 'Duas opções: verdadeiro ou falso' },
    poll: { label: 'Enquete', icon: '📊', desc: 'Coleta opiniões — sem resposta certa e sem pontos' },
    wordcloud: { label: 'Nuvem de palavras', icon: '☁️', desc: 'Resposta livre curta — forma uma nuvem no telão' },
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
      type: 'quiz',          // quiz | tf | poll | wordcloud
      text: '',
      options: ['', '', '', ''],
      corrects: [0],         // índices corretos (quiz/tf); vazio em poll/wordcloud
      multi: false,          // quiz: múltipla escolha (selecionar várias antes de enviar)
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
    if (n.type === 'poll' || n.type === 'wordcloud') {
      n.corrects = [];
      n.multi = false;
      n.points = 'none';
    }
    if (n.type === 'wordcloud') n.options = [];
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
    QUESTION_TYPES, TIME_OPTIONS, POINTS_OPTIONS,
    getTrainings, getTraining, upsertTraining, deleteTraining,
    newTraining, newQuestion,
    getResults, addResult, clearResults,
    getPin, setPin,
    seedIfEmpty,
  };
})();
