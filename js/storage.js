/* ===== Quiz Copérdia — camada de dados (localStorage) ===== */

const Store = (() => {
  const KEY_TRAININGS = 'qc_trainings';
  const KEY_RESULTS = 'qc_results';
  const KEY_PIN = 'qc_admin_pin';
  const KEY_SEEDED = 'qc_seeded';
  const DEFAULT_PIN = '1234';

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

  // ---- Treinamentos ----
  function getTrainings() {
    return read(KEY_TRAININGS, []);
  }

  function getTraining(id) {
    return getTrainings().find(t => t.id === id) || null;
  }

  function upsertTraining(training) {
    const all = getTrainings();
    const idx = all.findIndex(t => t.id === training.id);
    if (idx >= 0) all[idx] = training; else all.push(training);
    write(KEY_TRAININGS, all);
    return training;
  }

  function deleteTraining(id) {
    write(KEY_TRAININGS, getTrainings().filter(t => t.id !== id));
  }

  function newTraining(data = {}) {
    return {
      id: uid(),
      name: '',
      description: '',
      passScore: 70,        // % mínimo para aprovação
      timePerQuestion: 30,  // segundos por questão (0 = sem limite)
      shuffleQuestions: true,
      questions: [],
      ...data,
    };
  }

  function newQuestion(data = {}) {
    return {
      id: uid(),
      text: '',
      options: ['', '', '', ''],
      correct: 0,
      ...data,
    };
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
      timePerQuestion: 30,
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
        correct: 0,
      }),
      newQuestion({
        text: 'Como funciona a pontuação no jogo ao vivo?',
        options: [
          'Todas as respostas certas valem os mesmos pontos',
          'Quem responde certo mais rápido ganha mais pontos',
          'Os pontos são sorteados',
          'Só a última questão vale pontos',
        ],
        correct: 1,
      }),
      newQuestion({
        text: 'Onde o instrutor pode cadastrar novos treinamentos e perguntas?',
        options: [
          'Somente editando o código-fonte',
          'Enviando e-mail para o suporte',
          'Na área de Administração do próprio sistema',
          'Não é possível cadastrar novos treinamentos',
        ],
        correct: 2,
      }),
    ];
    upsertTraining(sample);
    write(KEY_SEEDED, true);
  }

  return {
    uid,
    getTrainings, getTraining, upsertTraining, deleteTraining,
    newTraining, newQuestion,
    getResults, addResult, clearResults,
    getPin, setPin,
    seedIfEmpty,
  };
})();
