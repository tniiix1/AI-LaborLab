/* assistant.js — «AI Labor Assistant»: список вопросов и ответы, которые «печатаются» на экране.
   Пока ассистент отвечает, 3D-голова поворачивается к зрителю и чаще «думает» (события assistant-speak). */
(function () {
  'use strict';

  var btn = document.getElementById('askBtn');
  var panel = document.getElementById('assistantPanel');
  var log = document.getElementById('apLog');
  var chipsBox = document.getElementById('apChips');
  var closeBtn = document.getElementById('apClose');
  if (!btn || !panel || !log || !chipsBox) return;

  var GREETING = 'Привет! Я AI Labor Assistant. Выберите вопрос ниже — расскажу, как ИИ меняет профессии и как устроены индексы проекта.';

  // Вопросы и ответы (по материалам сайта и списку стран проекта)
  var QA = [
    { q: 'Что такое AI Labor Lab?',
      a: 'AI Labor Lab — учебный исследовательский проект о том, как искусственный интеллект меняет содержание профессиональных задач.\n\nНа сайте: каталог из более чем 200 профессий в 16 профессиональных группах, калькулятор, два авторских индекса (ИТП и ИНЧ), сравнение профессий и карта стран, где ИИ уже применяется в работе.\n\nИдея проекта — «трансформация вместо исчезновения».' },
    { q: 'Заменит ли ИИ мою профессию?',
      a: 'Скорее изменит задачи, чем отменит профессию целиком. Развитие ИИ не обязательно означает массовое исчезновение профессий: чаще меняются состав задач и способы работы.\n\nМодель проекта показывает потенциал изменения задач, а не точный прогноз исчезновения рабочих мест. Оцените свою профессию в калькуляторе — это займёт пару минут.' },
    { q: 'Что такое индекс ИТП?',
      a: 'ИТП показывает потенциал трансформации задач профессии по модели проекта.\n\nИТП = (R + D + (10 − H) + (10 − A)) / 4\n\nR — рутинность, D — цифровизируемость задач, H — человеческое взаимодействие, A — ответственность за результат. Шкала от 0 до 10: чем выше ИТП, тем больше задач может измениться. Это не значит, что профессия обязательно исчезнет.' },
    { q: 'Что такое индекс ИНЧ?',
      a: 'ИНЧ показывает, какую роль в профессии играют человеческие качества.\n\nИНЧ = (H + A + C) / 3\n\nH — человеческое взаимодействие, A — ответственность за результат, C — творчество. Шкала от 0 до 10: чем выше ИНЧ, тем важнее общение, ответственность и нестандартное мышление.' },
    { q: 'Какие пять критериев оценки профессии?',
      a: 'Каждая профессия оценивается по шкале от 0 до 10:\n• R — рутинность: как часто повторяются однотипные действия;\n• D — цифровизируемость: какая часть задач может выполняться цифровыми системами;\n• H — человеческое взаимодействие: насколько работа зависит от общения и доверия;\n• A — ответственность: насколько серьёзны последствия ошибок;\n• C — творчество: как часто нужны новые, нестандартные решения.' },
    { q: 'Как оценить свою профессию?',
      a: 'Откройте раздел «Калькулятор»:\n1. Введите название профессии и выберите группу.\n2. Оцените пять критериев от 0 до 10.\n3. Нажмите «Рассчитать показатели» — получите ИТП и ИНЧ.\n4. При желании нажмите «Сохранить оценку».\n\nСохранённая оценка остаётся в вашем браузере, на этом устройстве, и помечается как пользовательская — она не считается экспертной.' },
    { q: 'Какие задачи ИИ уже выполняет в профессиях?',
      a: 'По материалам проекта, ИИ уже помогает, например:\n• в медицине — анализирует медицинские изображения и поддерживает диагностику;\n• в программировании — пишет и проверяет код;\n• в финансах — выявляет подозрительные операции и оценивает риски;\n• в маркетинге — готовит рекламные материалы и анализирует аудиторию;\n• в образовании — помогает готовить учебные материалы;\n• в логистике и промышленности — планирует поставки, контролирует качество, прогнозирует неисправности;\n• в обслуживании клиентов — работает чат-ботами и голосовыми помощниками.\n\nПодробности по странам — на планете внизу главной страницы.' },
    { q: 'В каких странах ИИ уже применяют в профессиях?',
      a: 'На планете внизу страницы отмечены 16 стран: США, Китай, Япония, Южная Корея, Великобритания, Германия, Франция, Индия, Сингапур, Канада, Австралия, Швеция, Бельгия, Нидерланды, Эстония и Польша.\n\nНажмите на светящуюся точку — увидите, в каких профессиях и задачах ИИ там уже используется.' },
    { q: 'Какие навыки нужны, чтобы работать с ИИ?',
      a: 'Модель проекта выделяет то, что остаётся за человеком (индекс ИНЧ), а практика стран добавляет цифровые навыки. Полезно развивать:\n• умение ставить задачу и проверять результат;\n• цифровую грамотность и работу с данными;\n• критическое мышление и ответственность за решение;\n• общение, доверие и работу с людьми;\n• творчество и нестандартные решения.\n\nНапример, в Эстонии отдельно развивают цифровые навыки и обучение работе с ИИ.' },
    { q: 'Как безопасно использовать ИИ в работе?',
      a: 'Несколько простых правил:\n• проверяйте факты и результаты — ответ ИИ не всегда верен;\n• не передавайте конфиденциальные и личные данные;\n• решения с высокой ответственностью (высокий A) оставляйте за человеком;\n• отмечайте, где использовали ИИ, если это важно для работы или учёбы.' },
    { q: 'Насколько точны оценки на сайте?',
      a: 'Оценки в первоначальной базе — предварительные демонстрационные значения. Это не официальная статистика и не экспертный консенсус.\n\nЧтобы сделать их объективнее, нужно описать типичные задачи профессий, привлечь независимых оценщиков и сравнить результаты. Подробнее — в разделе «Исследование», пункт «Ограничения».' }
  ];

  var greeted = false, busy = false, timer = null, skipFn = null, asked = {};
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function speak(on) {
    try { window.dispatchEvent(new CustomEvent('assistant-speak', { detail: { on: on } })); } catch (e) {}
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }
  function addMsg(role) {
    var d = document.createElement('div');
    d.className = 'ap-msg ' + role;
    log.appendChild(d); scrollDown();
    return d;
  }

  // «печатаем» ответ по буквам; клик по сообщению или новый вопрос — показать сразу
  function typeInto(el, text, done) {
    busy = true; speak(true); chipsBox.classList.add('hidden');
    el.classList.add('typing');
    var i = 0, step = text.length > 400 ? 3 : 2;
    function finish() {
      if (timer) { clearInterval(timer); timer = null; }
      el.textContent = text; el.classList.remove('typing');
      busy = false; skipFn = null; speak(false); chipsBox.classList.remove('hidden');
      scrollDown();
      if (done) done();
    }
    skipFn = finish;
    if (reduceMotion) { finish(); return; }
    timer = setInterval(function () {
      i = Math.min(text.length, i + step);
      el.textContent = text.slice(0, i);
      scrollDown();
      if (i >= text.length) finish();
    }, 24);
  }

  function botSay(text, done) {
    var m = addMsg('bot');
    m.innerHTML = '<span class="ap-dots"><i></i><i></i><i></i></span>';
    speak(true); chipsBox.classList.add('hidden');
    var wait = setTimeout(function () { m.textContent = ''; typeInto(m, text, done); }, reduceMotion ? 0 : 550);
    skipFn = function () { clearTimeout(wait); m.textContent = ''; typeInto(m, text, done); if (skipFn) skipFn(); };
    m.addEventListener('click', function () { if (busy && skipFn) skipFn(); });
  }

  function renderChips() {
    chipsBox.innerHTML = '<p class="ap-chips-title">Выберите вопрос</p>';
    QA.forEach(function (item, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ap-chip' + (asked[idx] ? ' done' : '');
      b.textContent = item.q;
      b.addEventListener('click', function () { ask(idx); });
      chipsBox.appendChild(b);
    });
  }

  function ask(idx) {
    if (skipFn) skipFn();                                  // дописать предыдущий ответ мгновенно
    asked[idx] = true;
    addMsg('user').textContent = QA[idx].q;
    botSay(QA[idx].a, renderChips);
    renderChips();
  }

  // Окно не должно закрывать голову: на широком экране ставим его слева от головы,
  // на телефоне — снизу, а голову прокручиваем в верхнюю часть экрана.
  function place() {
    var art = document.querySelector('.hero-art'), vw = window.innerWidth;
    panel.style.left = panel.style.right = panel.style.width = panel.style.bottom = panel.style.maxHeight = '';
    if (!art || vw < 761) return;
    var r = art.getBoundingClientRect(), main = document.querySelector('main');
    var minLeft = (main ? main.getBoundingClientRect().left : 0) + 12, avail = r.left - 12 - minLeft;
    if (avail >= 300) {
      panel.style.left = minLeft + 'px'; panel.style.right = 'auto';
      panel.style.width = Math.min(430, avail) + 'px'; panel.style.bottom = '22px';
    }
  }
  function revealHead() {
    var art = document.querySelector('.hero-art');
    if (!art) return;
    var r = art.getBoundingClientRect(), top = window.innerWidth < 761 ? 70 : 84;
    if (r.top < 60 || r.top > window.innerHeight * 0.5 || window.innerWidth < 761)
      window.scrollTo({ top: Math.max(0, r.top + (window.pageYOffset || 0) - top), behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  window.addEventListener('resize', function () { if (!panel.hidden) place(); });

  function open() {
    place(); revealHead();
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('active');
    if (!greeted) { greeted = true; botSay(GREETING, renderChips); }
    renderChips();
    setTimeout(scrollDown, 30);
  }
  function close() {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('active');
    if (skipFn) skipFn();
    speak(false); chipsBox.classList.remove('hidden');
  }

  btn.addEventListener('click', function () { if (panel.hidden) open(); else close(); });
  if (closeBtn) closeBtn.addEventListener('click', close);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) close(); });

  // ассистент живёт на главной: при переходе на другой раздел — закрываем окно
  var home = document.getElementById('home');
  if (home && window.MutationObserver) {
    new MutationObserver(function () { if (!home.classList.contains('active') && !panel.hidden) close(); })
      .observe(home, { attributes: true, attributeFilter: ['class'] });
  }
})();
