/* future.js — два раздела AI Labor Lab:
   1) «Будущая профессия» — подбор профессий по интересам + голографическая 3D-карта;
   2) «Сценарии будущего» — условное моделирование: профессия × сценарий × 2026 → 2030 → 2040.
   Использует данные из script.js (professions, GROUPS, COLORS). */
(function () {
  'use strict';
  if (typeof professions === 'undefined' || typeof GROUPS === 'undefined') return;

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function el(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function escH(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setupCanvas(cv) {
    var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return null;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    return { W: r.width, H: r.height, dpr: dpr };
  }
  function sprite(r, g, b) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
    gr.addColorStop(0.3, 'rgba(' + r + ',' + g + ',' + b + ',0.38)');
    gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c;
  }
  var SPR = [sprite(90, 215, 255), sprite(255, 150, 230), sprite(175, 140, 255)];

  // =====================================================================
  //  1. БУДУЩАЯ ПРОФЕССИЯ
  // =====================================================================
  var INTERESTS = [
    { id: 'people',   icon: '👥', title: 'Работа с людьми',           desc: 'Общаться, помогать, обучать, договариваться' },
    { id: 'data',     icon: '📊', title: 'Анализ данных',             desc: 'Искать закономерности, считать, делать выводы' },
    { id: 'create',   icon: '💡', title: 'Создание новых решений',    desc: 'Придумывать, проектировать, экспериментировать' },
    { id: 'tech',     icon: '⚙️', title: 'Технические задачи',        desc: 'Работать с оборудованием, кодом и системами' },
    { id: 'process',  icon: '🗂️', title: 'Организация процессов',     desc: 'Планировать, координировать, наводить порядок' },
    { id: 'research', icon: '🔭', title: 'Исследование мира',         desc: 'Изучать природу, общество, людей и технологии' }
  ];
  var LEVELS = ['Не моё', 'Немного', 'Интересно', 'Очень'];

  // сродство профессиональных групп с типами задач (0..1), порядок как в GROUPS
  var AFF = {
    'IT и технологии':                [0.15, 0.85, 0.60, 0.95, 0.30, 0.35],
    'Промышленность и производство':  [0.10, 0.20, 0.30, 0.95, 0.50, 0.10],
    'Сельское хозяйство':             [0.15, 0.35, 0.30, 0.50, 0.45, 0.50],
    'Медицина и здоровье':            [0.95, 0.45, 0.25, 0.30, 0.30, 0.50],
    'Образование':                    [0.95, 0.25, 0.50, 0.10, 0.45, 0.35],
    'Экономика и финансы':            [0.35, 0.95, 0.20, 0.15, 0.60, 0.30],
    'Право':                          [0.65, 0.45, 0.25, 0.05, 0.45, 0.35],
    'Международные отношения':        [0.70, 0.40, 0.25, 0.05, 0.45, 0.60],
    'Инженерия и строительство':      [0.20, 0.40, 0.70, 0.95, 0.55, 0.30],
    'Транспорт и логистика':          [0.20, 0.35, 0.15, 0.50, 0.95, 0.10],
    'Наука и исследования':           [0.20, 0.80, 0.60, 0.45, 0.25, 0.98],
    'Творчество и медиа':             [0.45, 0.15, 0.98, 0.20, 0.25, 0.20],
    'Торговля и услуги':              [0.90, 0.20, 0.20, 0.10, 0.50, 0.05],
    'Государственное управление':     [0.55, 0.35, 0.15, 0.05, 0.85, 0.20],
    'Гостиничный бизнес и питание':   [0.85, 0.05, 0.35, 0.05, 0.60, 0.05],
    'Экология и природные ресурсы':   [0.20, 0.50, 0.35, 0.35, 0.35, 0.90]
  };
  // слова в названии профессии, усиливающие совпадение с типом задач
  var KW = [
    /врач|педиатр|медсестр|фельдшер|психолог|учител|воспитател|тьютор|логопед|тренер|консультант|продав|социальн|дипломат|медиатор|гид|официант|бариста|администратор отел|педагог|преподават/,
    /аналитик|данн|актуар|аудитор|экономист|статист|бухгалтер|data|машинного обучения|финансов/,
    /дизайнер|архитектор|разработчик|художник|режисс|сценарист|композитор|писател|фотограф|конструктор|изобретат|шеф|редактор|продюсер|скульптор|аниматор|иллюстратор|журналист/,
    /инженер|техник|оператор|наладчик|сварщик|слесар|токар|фрезеровщик|механик|электрик|монтажник|программист|тестировщик|администратор баз|сетев|devops|робот|системный|кибербез|пилот|машинист|разработчик/,
    /менеджер|руководител|логист|координатор|диспетчер|мастер|технолог|директор|закуп|планиров|управляющ|комплаенс|методист/,
    /учён|исследоват|биолог|геолог|эколог|астроном|физик|химик|историк|археолог|климат|метеоролог|геофизик|океанолог|ботаник|зоолог|лаборант|международный аналитик|селекционер|агроном/
  ];

  function criteriaTerm(i, s) {
    var R = s.R / 10, D = s.D / 10, H = s.H / 10, A = s.A / 10, C = s.C / 10;
    switch (i) {
      case 0: return H;
      case 1: return 0.5 * D + 0.3 * C + 0.2 * (1 - H);
      case 2: return C;
      case 3: return 0.6 * (1 - H) + 0.4 * D;
      case 4: return 0.5 * A + 0.3 * R + 0.2 * H;
      default: return 0.6 * C + 0.4 * A;
    }
  }
  function interestScore(p, i) {
    var aff = (AFF[p.group] || [0.3, 0.3, 0.3, 0.3, 0.3, 0.3])[i];
    var kw = KW[i].test(p.name.toLowerCase()) ? 0.3 : 0;
    return clamp(0.55 * aff + 0.30 * criteriaTerm(i, p.scores) + kw, 0, 1);
  }
  // ratings: массив из 6 чисел 0..3. Возвращает до 6 профессий (не более 2 из одной группы)
  function rank(ratings) {
    var sel = [], sum = 0, i;
    for (i = 0; i < 6; i++) if (ratings[i] > 0) { sel.push(i); sum += ratings[i]; }
    if (!sel.length) return [];
    var scored = professions.map(function (p) {
      var mean = 0, mx = 0, parts = [];
      sel.forEach(function (k) {
        var s = interestScore(p, k);
        mean += ratings[k] * s / sum; if (s > mx) mx = s;
        parts.push({ k: k, s: s, w: ratings[k] * s });
      });
      parts.sort(function (a, b) { return b.w - a.w; });
      var why = parts.filter(function (x) { return x.s >= 0.5; }).slice(0, 3).map(function (x) { return INTERESTS[x.k].title; });
      return { p: p, score: 0.78 * mean + 0.22 * mx, why: why };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var out = [], perGroup = {};
    for (i = 0; i < scored.length && out.length < 6; i++) {
      var g = scored[i].p.group;
      if ((perGroup[g] || 0) >= 2) continue;
      perGroup[g] = (perGroup[g] || 0) + 1; out.push(scored[i]);
    }
    return out;
  }

  // ---------------- голографическая 3D-карта ----------------
  function HoloMap(canvas, hintEl) {
    var ctx = canvas.getContext('2d'), W = 0, H = 0, DPR = 1, S = 1, cx = 0, cy = 0;
    var yaw = 0.7, pitch = 0.95, spin = reduceMotion ? 0 : 0.14;
    var dragging = false, lx = 0, ly = 0, dx0 = 0, dy0 = 0, t0 = 0, lastInteract = -9999;
    var recs = [], sel = -1, hover = -1, mx = 0, my = 0, mouseIn = false, visible = true, self = this;
    var NS = [];                                    // экранные позиции вершин столбов
    self.onSelect = null;

    function resize() { var s = setupCanvas(canvas); if (!s) { W = H = 0; return; } W = s.W; H = s.H; DPR = s.dpr; S = Math.min(W / 3.3, H / 2.5); cx = W / 2; cy = H * 0.68; }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize);
    if (window.IntersectionObserver) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) resize(); }).observe(canvas);
    resize();

    function P(x, y, z) {
      var c = Math.cos(yaw), s = Math.sin(yaw), x1 = x * c + z * s, z1 = -x * s + z * c;
      var cp = Math.cos(pitch), sp = Math.sin(pitch), up = y * cp - z1 * sp, d = z1 * cp + y * sp, k = 4.5 / (4.5 - d);
      return [cx + x1 * k * S, cy - up * k * S, d, k];
    }
    function wx(p) { return (p.itp - 5) / 5; }
    function wz(p) { return (p.inch - 5) / 5; }

    self.setRecs = function (list) { recs = list || []; sel = -1; hover = -1; if (hintEl) hintEl.style.display = recs.length ? 'none' : ''; };
    self.select = function (i) { sel = i; };

    function pos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function nearest(px, py) {
      var best = -1, bd = 26 * 26;
      for (var i = 0; i < NS.length; i++) { var dx = NS[i][0] - px, dy = NS[i][1] - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
      return best;
    }
    canvas.addEventListener('pointerdown', function (e) {
      var p = pos(e); dragging = true; lx = dx0 = p[0]; ly = dy0 = p[1]; t0 = performance.now(); lastInteract = t0;
      try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = pos(e); mx = p[0]; my = p[1];
      if (dragging) { yaw += (p[0] - lx) * 0.009; pitch = clamp(pitch + (p[1] - ly) * 0.005, 0.45, 1.35); lx = p[0]; ly = p[1]; lastInteract = performance.now(); }
      else if (e.pointerType === 'mouse') mouseIn = true;
    });
    function up(e, cancel) {
      if (!dragging) return; dragging = false;
      var p = pos(e), now = performance.now(); lastInteract = now;
      if (!cancel && Math.hypot(p[0] - dx0, p[1] - dy0) < 7 && now - t0 < 500) {
        var i = nearest(p[0], p[1]);
        if (i >= 0) { sel = i; if (self.onSelect) self.onSelect(i); }
      }
    }
    canvas.addEventListener('pointerup', function (e) { up(e, false); });
    canvas.addEventListener('pointercancel', function (e) { up(e, true); });
    canvas.addEventListener('pointerleave', function () { mouseIn = false; hover = -1; });

    function line(a, b) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }

    function draw(time) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      var i, t, a, b, flick = 0.9 + 0.1 * Math.sin(time * 0.011);
      // подсветка диска-проектора
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 1.5);
      g.addColorStop(0, 'rgba(60,170,255,0.20)'); g.addColorStop(1, 'rgba(60,170,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // сетка пола
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(90,200,255,' + (0.17 * flick).toFixed(3) + ')'; ctx.beginPath();
      for (t = -1; t <= 1.001; t += 0.2) { line(P(t, 0, -1), P(t, 0, 1)); line(P(-1, 0, t), P(1, 0, t)); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(130,230,255,' + (0.6 * flick).toFixed(3) + ')'; ctx.lineWidth = 1.5; ctx.beginPath();
      a = P(-1, 0, -1); ctx.moveTo(a[0], a[1]);
      [P(1, 0, -1), P(1, 0, 1), P(-1, 0, 1), P(-1, 0, -1)].forEach(function (q) { ctx.lineTo(q[0], q[1]); });
      ctx.stroke();
      // оси и деления
      ctx.globalCompositeOperation = 'source-over'; ctx.font = '600 10px Inter, Arial, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(170,215,255,0.85)';
      [[0, 0], [5, 0], [10, 0]].forEach(function (v) { var q = P((v[0] - 5) / 5, 0, 1.09); ctx.textAlign = 'center'; ctx.fillText(String(v[0]), q[0], q[1]); });
      [0, 5, 10].forEach(function (v) { var q = P(-1.09, 0, (v - 5) / 5); ctx.textAlign = 'center'; ctx.fillText(String(v), q[0], q[1]); });
      var tx = P(0, 0, 1.28), tz = P(-1.28, 0, 0);
      ctx.fillStyle = '#7fe3ff'; ctx.font = '700 11px Inter, Arial, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('ИТП →', tx[0], tx[1]); ctx.fillText('ИНЧ →', tz[0], tz[1]);
      ctx.globalCompositeOperation = 'lighter';

      // все профессии базы — тусклые точки на «полу»
      for (i = 0; i < professions.length; i++) {
        var pr = professions[i], q = P(wx(pr), 0, wz(pr)), col = (typeof COLORS !== 'undefined' ? COLORS[GROUPS.indexOf(pr.group) % COLORS.length] : '#55dfff');
        ctx.globalAlpha = 0.28 + 0.3 * clamp((q[2] + 1) / 2, 0, 1);
        ctx.fillStyle = col; ctx.fillRect(q[0] - 1.3, q[1] - 1.3, 2.6, 2.6);
      }
      ctx.globalAlpha = 1;

      // «ваш профиль» — центр выбранных профессий
      NS = [];
      if (recs.length) {
        var mxs = 0, mzs = 0; recs.forEach(function (r) { mxs += wx(r.p) / recs.length; mzs += wz(r.p) / recs.length; });
        var c0 = P(mxs, 0, mzs), pulse = 0.5 + 0.5 * Math.sin(time * 0.004);
        ctx.strokeStyle = 'rgba(255,160,230,' + (0.35 + 0.4 * pulse).toFixed(3) + ')'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(c0[0], c0[1], 10 + 8 * pulse, (10 + 8 * pulse) * Math.sin(pitch), 0, 0, 6.2832); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#ffb9ec'; ctx.font = '700 10px Inter, Arial, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('ВЫ', c0[0], c0[1] + 22); ctx.globalCompositeOperation = 'lighter';
      }
      // столбы рекомендованных профессий (дальние — раньше)
      var order = recs.map(function (r, k) { var h = 0.28 + 0.95 * r.score; return { k: k, base: P(wx(r.p), 0, wz(r.p)), top: P(wx(r.p), h, wz(r.p)) }; });
      order.sort(function (A, B) { return A.base[2] - B.base[2]; });
      order.forEach(function (o) {
        var isSel = o.k === sel, isHov = o.k === hover, r = recs[o.k];
        var lg = ctx.createLinearGradient(o.base[0], o.base[1], o.top[0], o.top[1]);
        lg.addColorStop(0, 'rgba(90,215,255,0.05)'); lg.addColorStop(1, isSel ? 'rgba(255,170,235,0.95)' : 'rgba(110,225,255,0.85)');
        ctx.strokeStyle = lg; ctx.lineWidth = isSel ? 3 : 2; ctx.beginPath(); ctx.moveTo(o.base[0], o.base[1]); ctx.lineTo(o.top[0], o.top[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,225,255,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(o.base[0], o.base[1], 9 * o.base[3], 9 * o.base[3] * Math.sin(pitch), 0, 0, 6.2832); ctx.stroke();
        var gs = (isSel ? 40 : (isHov ? 34 : 26)) * o.top[3];
        ctx.globalAlpha = 0.9; ctx.drawImage(SPR[isSel ? 1 : 0], o.top[0] - gs, o.top[1] - gs, gs * 2, gs * 2); ctx.globalAlpha = 1;
        ctx.fillStyle = '#f4fbff'; ctx.beginPath(); ctx.arc(o.top[0], o.top[1], (isSel ? 4.6 : 3.8) * o.top[3], 0, 6.2832); ctx.fill();
        NS[o.k] = [o.top[0], o.top[1]];
      });
      for (i = 0; i < recs.length; i++) if (!NS[i]) NS[i] = [-999, -999];
      // подписи
      ctx.globalCompositeOperation = 'source-over'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      var placed = [];
      order.slice().sort(function (A, B) { return A.top[1] - B.top[1]; }).forEach(function (o) {
        var isSel = o.k === sel, r = recs[o.k], txt = (o.k + 1) + '  ' + r.p.name;
        ctx.font = (isSel ? '700 ' : '600 ') + '11px Inter, Arial, sans-serif';
        var w = ctx.measureText(txt).width + 14, x = clamp(o.top[0], w / 2 + 3, W - w / 2 - 3), y = o.top[1] - 19, tries = 0, hit = true;
        while (hit && tries < 8) {
          hit = false;
          for (var q = 0; q < placed.length; q++) {
            if (Math.abs(placed[q].y - y) < 22 && Math.abs(placed[q].x - x) < (placed[q].w + w) / 2 + 2) { y = placed[q].y - 23; hit = true; break; }
          }
          tries++;
        }
        y = Math.max(12, y); placed.push({ x: x, y: y, w: w });
        ctx.fillStyle = isSel ? 'rgba(70,30,90,0.92)' : 'rgba(4,20,44,0.86)';
        ctx.strokeStyle = isSel ? 'rgba(255,170,235,0.9)' : 'rgba(110,225,255,0.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 10, w, 20, 10); else ctx.rect(x - w / 2, y - 10, w, 20); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f3f9ff'; ctx.fillText(txt, x, y + 0.5);
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    var last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!visible || document.hidden || !W || !H) return;
      if (!dragging && now - lastInteract > 2200) yaw += spin * dt;
      hover = (mouseIn && !dragging) ? nearest(mx, my) : -1;
      canvas.style.cursor = dragging ? 'grabbing' : (hover >= 0 ? 'pointer' : 'grab');
      draw(now);
    }
    requestAnimationFrame(frame);
    self.resize = resize;
  }

  // ---------------- интерфейс раздела «Будущая профессия» ----------------
  var ratings = [0, 0, 0, 0, 0, 0], fpMap = null, fpRecs = [], fpSelected = -1, fpShown = false;

  function buildQuiz() {
    var box = el('fpQuestions');
    if (!box) return;
    box.innerHTML = INTERESTS.map(function (q, i) {
      return '<div class="fp-q" data-i="' + i + '"><div class="fp-q-head"><span class="fp-ico">' + q.icon + '</span><div><b>' + escH(q.title) + '</b><small>' + escH(q.desc) + '</small></div></div>' +
        '<div class="fp-levels" role="radiogroup" aria-label="' + escH(q.title) + '">' +
        LEVELS.map(function (l, k) { return '<button type="button" class="fp-lv" data-k="' + k + '" role="radio" aria-checked="false">' + l + '</button>'; }).join('') + '</div></div>';
    }).join('');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.fp-lv'); if (!b) return;
      var i = +b.closest('.fp-q').dataset.i, k = +b.dataset.k;
      ratings[i] = (ratings[i] === k && k > 0) ? 0 : k;
      paintQuiz();
      if (fpShown) runMatch(false);
    });
  }
  function paintQuiz() {
    document.querySelectorAll('#fpQuestions .fp-q').forEach(function (row) {
      var i = +row.dataset.i;
      row.classList.toggle('on', ratings[i] > 0);
      row.querySelectorAll('.fp-lv').forEach(function (b) { var on = +b.dataset.k === ratings[i]; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    });
    var n = ratings.filter(function (v) { return v > 0; }).length;
    var c = el('fpCount'); if (c) c.textContent = n ? ('Выбрано типов задач: ' + n + ' из 6') : 'Отметьте хотя бы один тип задач';
  }

  function runMatch(scroll) {
    var list = rank(ratings);
    if (!list.length) { if (window.toast) toast('Отметьте хотя бы один тип задач, который вам интересен'); return; }
    fpShown = true; fpRecs = list; fpSelected = -1;
    if (fpMap) { fpMap.setRecs(list); }
    renderResults();
    if (scroll) { var r = el('fpResults'); if (r && r.scrollIntoView) setTimeout(function () { r.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); }, 80); }
  }
  function renderResults() {
    var box = el('fpResults'); if (!box) return;
    if (!fpRecs.length) { box.innerHTML = ''; return; }
    var best = fpRecs[0].score;
    box.innerHTML = '<h2>Вам могут подойти</h2><p class="fp-note">Условное совпадение интересов с профилем профессии. Это ознакомительный подбор по демонстрационной базе, а не профориентационный тест и не гарантия успеха.</p><div class="fp-cards">' +
      fpRecs.map(function (r, i) {
        var pct = Math.round(clamp(r.score, 0, 0.99) * 100);
        return '<article class="fp-card' + (i === fpSelected ? ' sel' : '') + '" data-i="' + i + '" tabindex="0">' +
          '<div class="fp-rank">' + (i + 1) + '</div><div class="fp-card-main"><h3>' + escH(r.p.name) + '</h3><small>' + escH(r.p.group) + '</small>' +
          '<div class="fp-tags">' + (r.why.length ? r.why.map(function (w) { return '<span>' + escH(w) + '</span>'; }).join('') : '<span>общий профиль</span>') + '</div>' +
          '<div class="fp-metrics"><span>ИТП <b>' + r.p.itp + '</b></span><span>ИНЧ <b>' + r.p.inch + '</b></span><span class="fp-pct">совпадение <b>' + pct + '%</b></span></div>' +
          '<div class="fp-bar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="fp-card-actions"><button type="button" class="outline-btn fp-focus" data-i="' + i + '">Показать на карте</button><button type="button" class="primary-btn fp-scen" data-id="' + r.p.id + '">Сценарии будущего →</button></div>' +
          '</div></article>';
      }).join('') + '</div>';
  }
  function selectRec(i, fromMap) {
    fpSelected = i;
    if (fpMap) fpMap.select(i);
    document.querySelectorAll('#fpResults .fp-card').forEach(function (c) { c.classList.toggle('sel', +c.dataset.i === i); });
    if (fromMap) { var c = document.querySelector('#fpResults .fp-card[data-i="' + i + '"]'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }); }
  }

  function initFuture() {
    if (!el('fpQuestions')) return;
    buildQuiz(); paintQuiz();
    fpMap = new HoloMap(el('fpCanvas'), el('fpHint'));
    fpMap.onSelect = function (i) { selectRec(i, true); };
    el('fpGo').addEventListener('click', function () { runMatch(true); });
    el('fpReset').addEventListener('click', function () {
      ratings = [0, 0, 0, 0, 0, 0]; fpRecs = []; fpShown = false; fpSelected = -1; paintQuiz();
      fpMap.setRecs([]); renderResults();
    });
    el('fpResults').addEventListener('click', function (e) {
      var f = e.target.closest('.fp-focus'), s = e.target.closest('.fp-scen'), card = e.target.closest('.fp-card');
      if (f) { selectRec(+f.dataset.i, false); var m = el('fpCanvas'); if (m && m.scrollIntoView) m.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }
      else if (s) openScenario(+s.dataset.id);
      else if (card) selectRec(+card.dataset.i, false);
    });
    window.addEventListener('hashchange', function () { if (location.hash === '#future' && fpMap) setTimeout(fpMap.resize, 60); });
    if (location.hash === '#future') setTimeout(fpMap.resize, 120);
  }

  // =====================================================================
  //  2. СЦЕНАРИИ БУДУЩЕГО (условное моделирование)
  // =====================================================================
  var YEARS = [2026, 2030, 2040];
  var SCEN = {
    slow:     { name: 'Медленный', word: 'Отдельные', desc: 'Технологии внедряются постепенно: обучение людей и правила работы успевают за автоматизацией.', p: [0, 0.10, 0.35] },
    moderate: { name: 'Умеренный', word: 'Заметная часть', desc: 'Технологии заметно входят в работу, но результаты проверяет человек, а сотрудников переучивают.', p: [0, 0.25, 0.65] },
    fast:     { name: 'Быстрый',   word: 'Значительная часть', desc: 'Технологии быстро появляются в рабочих процессах, и большая часть типовых задач цифровизируется.', p: [0, 0.45, 0.95] }
  };
  var DRIFT = { R: 0, D: 0.80, H: 0.20, A: 0.30, C: 0.35 };       // доля «запаса до 10», которая закрывается при полном прогрессе (p = 1)
  var CRIT = { R: 'Рутинность', D: 'Цифровизируемость', H: 'Человеческое взаимодействие', A: 'Ответственность', C: 'Творчество' };

  var GTASK = {
    'IT и технологии':               ['написание типового кода, тестирование и документация', 'проверки качества, безопасности и корректности кода', 'постановки задач, проектирования архитектуры и работы с требованиями'],
    'Промышленность и производство': ['контроль качества, наладка и повторяющиеся операции на линии', 'контроля процессов, безопасности и состояния оборудования', 'настройки, обслуживания и улучшения производственных процессов'],
    'Сельское хозяйство':            ['мониторинг посевов, животных и погодных условий', 'проверки данных датчиков и решений по уходу за посевами и животными', 'агрономических решений и планирования сезона'],
    'Медицина и здоровье':           ['предварительный анализ изображений и медицинских данных, ведение документации', 'проверки результатов анализа и клинических решений', 'общения с пациентом, объяснения диагноза и принятия клинических решений'],
    'Образование':                   ['подготовка заданий, проверка типовых работ и учебных материалов', 'оценки качества материалов и ответов обучающихся', 'наставничества, мотивации и индивидуальной работы с учениками'],
    'Экономика и финансы':           ['обработка первичных документов, сверка и типовые расчёты', 'проверки данных и контроля результатов автоматических расчётов', 'анализа и объяснения финансовых результатов'],
    'Право':                         ['поиск информации в документах и подготовка типовых текстов', 'проверки ссылок, фактов и юридической аргументации', 'консультирования, переговоров и выработки правовой позиции'],
    'Международные отношения':       ['перевод, обработка новостных и аналитических материалов', 'проверки точности перевода и источников', 'переговоров, доверия и понимания культурного контекста'],
    'Инженерия и строительство':     ['расчёты, моделирование и типовые проекты', 'проверки расчётов, норм и безопасности решений', 'проектных решений и координации участников проекта'],
    'Транспорт и логистика':         ['планирование маршрутов и поставок, учёт перевозок', 'контроля исполнения и безопасности перевозок', 'координации людей и решения нестандартных ситуаций'],
    'Наука и исследования':          ['поиск и обзор литературы, первичная обработка данных', 'проверки данных, методов и воспроизводимости результатов', 'постановки вопросов, интерпретации результатов и научной аргументации'],
    'Творчество и медиа':            ['подготовка черновиков, монтаж и обработка контента', 'редакторской проверки, авторского контроля и этики', 'авторского замысла, стиля и работы с аудиторией'],
    'Торговля и услуги':             ['учёт, ответы на типовые вопросы клиентов, рекомендации', 'контроля качества обслуживания и данных', 'личного общения с клиентами и решения нестандартных запросов'],
    'Государственное управление':    ['обработка обращений и документов', 'проверки решений и соблюдения процедур', 'объяснения решений гражданам и принятия управленческих решений'],
    'Гостиничный бизнес и питание':  ['бронирование, учёт и типовые запросы гостей', 'контроля качества и стандартов обслуживания', 'гостеприимства и персонального внимания к гостям'],
    'Экология и природные ресурсы':  ['мониторинг данных датчиков и спутниковых снимков', 'проверки данных и экологических оценок', 'принятия решений и работы с сообществами и организациями']
  };

  function progAt(scn, u) { var t = SCEN[scn].p, i = Math.min(1, Math.floor(u)), f = u - i; return t[i] + (t[i + 1] - t[i]) * f; }
  function scoresAt(base, scn, u) {
    var p = progAt(scn, u), o = {};
    ['R', 'D', 'H', 'A', 'C'].forEach(function (k) { o[k] = base[k] + (10 - base[k]) * DRIFT[k] * p; });
    return o;
  }
  function idx(s) { return { itp: (s.R + s.D + (10 - s.H) + (10 - s.A)) / 4, inch: (s.H + s.A + s.C) / 3 }; }
  function yearAt(u) { return Math.round(u <= 1 ? 2026 + 4 * u : 2030 + 10 * (u - 1)); }
  function f2(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function sgn(v) { return (v > 0.004 ? '+' : (v < -0.004 ? '−' : '±')) + Math.abs(Math.round(v * 100) / 100).toFixed(2); }

  // Текст возможных изменений задач (для года-узла yi = 0|1|2)
  function describe(p, scn, yi) {
    var g = GTASK[p.group] || ['типовые операции', 'проверка результатов', 'работа с людьми и анализ'];
    var b = p.scores, sc = SCEN[scn], year = YEARS[yi], out = [];
    if (yi === 0) {
      var keys = ['R', 'D', 'H', 'A', 'C'].sort(function (a, c) { return b[c] - b[a]; });
      out.push('Исходная оценка 2026: сильнее всего выражены «' + CRIT[keys[0]] + '» и «' + CRIT[keys[1]] + '».');
      out.push('Типовые задачи, которые уже сегодня могут выполнять цифровые системы: ' + g[0] + '.');
      var human = [];
      if (b.H >= 7) human.push('общение и доверие'); if (b.A >= 7) human.push('ответственность за результат'); if (b.C >= 7) human.push('творчество и нестандартные решения');
      out.push('Опорные части профессии, где особенно нужен человек: ' + (human.length ? human.join(', ') : 'сочетание разных задач и проверка результатов') + '.');
      return out;
    }
    if (/бухгалтер/i.test(p.name)) {
      out.push('Больше операций может выполняться автоматически.');
      out.push('Усиливается роль проверки данных.');
      out.push('Возрастает значение анализа и объяснения финансовых результатов.');
    } else {
      out.push(sc.word + ' задач — ' + g[0] + ' — может выполняться цифровыми системами.');
      out.push('Усиливается роль ' + g[1] + '.');
      out.push('Возрастает значение ' + g[2] + '.');
    }
    var top = ['H', 'C', 'A'].sort(function (a, c) { return b[c] - b[a]; })[0];
    if (b[top] >= 8) {
      out.push({ H: 'Доверие и общение с людьми остаются ядром профессии: их сложно передать системам.', C: 'Творческие и нестандартные решения остаются зоной человека.', A: 'Высокая ответственность за результат сохраняет решающую роль человека.' }[top]);
    } else if (b.R >= 8 && b.D >= 8) {
      out.push('Рутинные операции — зона наибольших изменений: профессия может сильнее сместиться к проверке и анализу.');
    }
    out.push('Условный сценарий «' + sc.name.toLowerCase() + '»: реальные изменения зависят от законов, экономики, обучения кадров и самих технологий (' + year + ').');
    return out;
  }

  // ---- состояние симулятора ----
  var scProf = null, scScn = 'moderate', curU = 0, tgtU = 0, playing = false, lastIdx = -1, scCtx = null, scW = 0, scH = 0, scDPR = 1, scVisible = true;
  var scGauges = {}, tlLo = 0, tlHi = 10;
  function updateRange() {
    if (!scProf) return; var mn = 99, mx = -99;
    ['slow', 'moderate', 'fast'].forEach(function (s) { for (var u = 0; u <= 2.001; u += 0.1) { var v = idx(scoresAt(scProf.scores, s, u)); mn = Math.min(mn, v.itp, v.inch); mx = Math.max(mx, v.itp, v.inch); } });
    tlLo = Math.max(0, Math.floor(mn - 0.6)); tlHi = Math.min(10, Math.ceil(mx + 0.6));
    if (tlHi - tlLo < 4) { var m = (tlHi + tlLo) / 2; tlLo = Math.max(0, Math.floor(m - 2)); tlHi = Math.min(10, tlLo + 4); tlLo = Math.max(0, tlHi - 4); }
  }

  function findProf(name) {
    var q = (name || '').trim().toLowerCase(); if (!q) return null;
    var exact = professions.filter(function (p) { return p.name.toLowerCase() === q; })[0];
    return exact || professions.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; })[0] || null;
  }
  function setProfession(p, quiet) {
    if (!p) return;
    scProf = p; updateRange(); var inp = el('scProf'); if (inp) inp.value = p.name;
    lastIdx = -1; if (!quiet) { curU = 0; tgtU = 0; playing = false; paintPlay(); }
    renderChanges(Math.round(clamp(tgtU, 0, 2)));
    document.querySelectorAll('.sc-quick button').forEach(function (b) { b.classList.toggle('on', b.dataset.n === p.name); });
  }
  function openScenario(profId) {
    var p = professions.filter(function (x) { return x.id === profId; })[0];
    if (p) setProfession(p, false);
    if (location.hash !== '#scenarios') location.hash = 'scenarios';
    window.scrollTo(0, 0);
  }
  function setScenario(s) {
    scScn = s; lastIdx = -1;
    document.querySelectorAll('#scSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === s); b.setAttribute('aria-pressed', b.dataset.s === s ? 'true' : 'false'); });
    var d = el('scDesc'); if (d) d.textContent = SCEN[s].desc;
    renderChanges(Math.round(clamp(tgtU, 0, 2)));
  }
  function paintPlay() { var b = el('scPlay'); if (b) b.textContent = playing ? '⏸ Пауза' : '▶ Воспроизвести'; }

  function renderChanges(yi) {
    var box = el('scChanges'); if (!box || !scProf) return;
    if (yi === lastIdx) return; lastIdx = yi;
    var title = yi === 0 ? 'Исходный профиль · 2026' : ('Возможные изменения задач · ' + YEARS[yi]);
    var items = describe(scProf, scScn, yi);
    box.innerHTML = '<h2>' + escH(title) + '</h2><p class="sc-prof-line"><b>' + escH(scProf.name) + '</b> · ' + escH(scProf.group) + ' · сценарий «' + escH(SCEN[scScn].name) + '»</p><ul>' +
      items.map(function (t, i) { return '<li style="animation-delay:' + (i * 70) + 'ms">' + escH(t) + '</li>'; }).join('') + '</ul>';
  }

  var animVals = { itp: 0, inch: 0 };
  function updateGauges() {
    if (!scProf) return;
    var base = scProf.scores, cur = scoresAt(base, scScn, curU), a = idx(base), b = idx(cur);
    var set = function (id, txt) { var n = el(id); if (n && n.textContent !== txt) n.textContent = txt; };
    set('gItp', f2(b.itp)); set('gInch', f2(b.inch));
    var di = b.itp - a.itp, dc = b.inch - a.inch;
    function delta(id, v) { var n = el(id); if (!n) return; n.textContent = sgn(v) + ' к 2026'; n.className = 'sc-delta ' + (v > 0.004 ? 'up' : (v < -0.004 ? 'down' : 'flat')); }
    delta('gItpD', di); delta('gInchD', dc);
    el('gItpBar').style.width = (b.itp * 10) + '%'; el('gItpBase').style.left = (a.itp * 10) + '%';
    el('gInchBar').style.width = (b.inch * 10) + '%'; el('gInchBase').style.left = (a.inch * 10) + '%';
    var yl = el('scYear'); if (yl) yl.textContent = String(yearAt(curU));
    ['R', 'D', 'H', 'A', 'C'].forEach(function (k) {
      var bar = el('cb' + k), val = el('cv' + k), tick = el('ct' + k);
      if (bar) bar.style.width = (cur[k] * 10) + '%'; if (tick) tick.style.left = (base[k] * 10) + '%'; if (val) val.textContent = cur[k].toFixed(1);
    });
  }

  // ---- голографическая шкала времени ----
  function tlGeom() {
    var l = 46, r = scW - 46, base = scH - 46, top = 26;
    return { l: l, r: r, base: base, top: top, x: function (u) { return l + (r - l) * u / 2; }, y: function (v) { return base - 8 - (base - 8 - top) * (v - tlLo) / (tlHi - tlLo); } };
  }
  function drawTimeline(time) {
    var c = scCtx; if (!c || !scProf) return;
    var G = tlGeom(), flick = 0.92 + 0.08 * Math.sin(time * 0.012), i, u, k;
    c.setTransform(scDPR, 0, 0, scDPR, 0, 0); c.clearRect(0, 0, scW, scH);
    var bg = c.createLinearGradient(0, 0, 0, scH); bg.addColorStop(0, 'rgba(40,120,220,0.10)'); bg.addColorStop(1, 'rgba(40,120,220,0)');
    c.fillStyle = bg; c.fillRect(0, 0, scW, scH);
    c.globalCompositeOperation = 'lighter';
    // сетка значений 0 / 5 / 10
    c.lineWidth = 1; c.font = '600 10px Inter, Arial, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'right';
    [tlLo, (tlLo + tlHi) / 2, tlHi].forEach(function (v, vi) {
      c.strokeStyle = 'rgba(90,200,255,' + (vi === 0 ? 0.35 : 0.14) + ')'; c.beginPath(); c.moveTo(G.l - 8, G.y(v)); c.lineTo(G.r + 8, G.y(v)); c.stroke();
      c.fillStyle = 'rgba(150,200,240,0.8)'; c.fillText(String(Math.round(v * 10) / 10), G.l - 14, G.y(v));
    });
    // вертикали лет
    for (i = 0; i < 3; i++) { c.strokeStyle = 'rgba(120,200,255,0.16)'; c.beginPath(); c.moveTo(G.x(i), G.top - 6); c.lineTo(G.x(i), G.base); c.stroke(); }
    // кривые трёх сценариев (выбранный — ярко)
    ['slow', 'moderate', 'fast'].forEach(function (s) {
      ['itp', 'inch'].forEach(function (m) {
        var main = s === scScn, col = m === 'itp' ? '85,223,255' : '176,140,255';
        c.beginPath();
        for (u = 0; u <= 2.001; u += 0.05) { var v = idx(scoresAt(scProf.scores, s, u))[m], x = G.x(u), y = G.y(v); if (u === 0) c.moveTo(x, y); else c.lineTo(x, y); }
        if (main) { c.strokeStyle = 'rgba(' + col + ',0.25)'; c.lineWidth = 7; c.stroke(); }
        c.setLineDash(main ? [] : [4, 5]); c.strokeStyle = 'rgba(' + col + ',' + (main ? 0.95 * flick : 0.3) + ')'; c.lineWidth = main ? 2.2 : 1.1; c.stroke(); c.setLineDash([]);
      });
    });
    // ось времени и узлы
    var lg = c.createLinearGradient(G.l, 0, G.r, 0); lg.addColorStop(0, 'rgba(90,220,255,0.95)'); lg.addColorStop(1, 'rgba(176,140,255,0.95)');
    c.strokeStyle = lg; c.lineWidth = 2; c.beginPath(); c.moveTo(G.l, G.base + 12); c.lineTo(G.r, G.base + 12); c.stroke();
    var near = Math.round(clamp(curU, 0, 2));
    c.globalCompositeOperation = 'source-over'; c.textAlign = 'center';
    for (i = 0; i < 3; i++) {
      var on = i === near, x = G.x(i), y = G.base + 12;
      c.globalCompositeOperation = 'lighter';
      var gs = on ? 22 : 14; c.globalAlpha = on ? 0.95 : 0.6; c.drawImage(SPR[0], x - gs, y - gs, gs * 2, gs * 2); c.globalAlpha = 1;
      c.fillStyle = on ? '#ffffff' : '#9fd8ee'; c.beginPath(); c.arc(x, y, on ? 5 : 3.6, 0, 6.2832); c.fill();
      c.globalCompositeOperation = 'source-over';
      c.font = (on ? '800 ' : '600 ') + '13px Inter, Arial, sans-serif'; c.fillStyle = on ? '#ffffff' : '#9fb4d5'; c.fillText(String(YEARS[i]), x, y + 22);
    }
    // сканер
    var sx = G.x(curU);
    c.globalCompositeOperation = 'lighter';
    var sg = c.createLinearGradient(sx - 14, 0, sx + 14, 0); sg.addColorStop(0, 'rgba(120,220,255,0)'); sg.addColorStop(0.5, 'rgba(160,235,255,' + (0.5 * flick) + ')'); sg.addColorStop(1, 'rgba(120,220,255,0)');
    c.fillStyle = sg; c.fillRect(sx - 14, G.top - 8, 28, G.base - G.top + 20);
    var cur = idx(scoresAt(scProf.scores, scScn, curU));
    [['itp', '85,223,255', 'ИТП'], ['inch', '176,140,255', 'ИНЧ']].forEach(function (m) {
      var v = cur[m[0]], y = G.y(v);
      c.globalAlpha = 0.9; c.drawImage(SPR[m[0] === 'itp' ? 0 : 2], sx - 16, y - 16, 32, 32); c.globalAlpha = 1;
      c.fillStyle = '#fff'; c.beginPath(); c.arc(sx, y, 3.6, 0, 6.2832); c.fill();
    });
    c.globalCompositeOperation = 'source-over';
    // подписи значений рядом со сканером
    c.font = '700 11px Inter, Arial, sans-serif';
    [['itp', '#7fe7ff', 'ИТП '], ['inch', '#c9aeff', 'ИНЧ ']].forEach(function (m, n) {
      var v = cur[m[0]], y = G.y(v), tx = sx + (sx > G.r - 70 ? -10 : 10), al = sx > G.r - 70 ? 'right' : 'left';
      c.textAlign = al; c.fillStyle = m[1]; c.fillText(m[2] + f2(v), tx, y + (v >= cur[m[0] === 'itp' ? 'inch' : 'itp'] ? -12 : 14));
    });
  }

  function scResize() {
    var cv = el('scCanvas'); if (!cv) return;
    var s = setupCanvas(cv); if (!s) { scW = scH = 0; return; }
    scW = s.W; scH = s.H; scDPR = s.dpr;
  }

  function scLoop() {
    var last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!scVisible || document.hidden || !scW || !scProf) return;
      if (playing) {
        curU += dt * 0.32; tgtU = curU;
        if (curU >= 2) { curU = tgtU = 2; playing = false; paintPlay(); }
      } else if (Math.abs(tgtU - curU) > 0.0005) curU += (tgtU - curU) * (1 - Math.exp(-dt * 5)); else curU = tgtU;
      renderChanges(Math.round(clamp(curU, 0, 2)));
      updateGauges(); drawTimeline(now);
    }
    requestAnimationFrame(frame);
  }

  function initScenarios() {
    var cv = el('scCanvas'); if (!cv) return;
    scCtx = cv.getContext('2d'); scResize();
    if (window.ResizeObserver) new ResizeObserver(scResize).observe(cv);
    window.addEventListener('resize', scResize);
    if (window.IntersectionObserver) new IntersectionObserver(function (e) { scVisible = e[0].isIntersecting; if (scVisible) scResize(); }).observe(cv);
    el('scSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setScenario(b.dataset.s); });
    el('scYears').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-u]'); if (!b) return;
      playing = false; paintPlay(); tgtU = +b.dataset.u;
    });
    el('scPlay').addEventListener('click', function () {
      if (playing) { playing = false; } else { if (curU >= 1.999) curU = 0; tgtU = curU; playing = true; }
      paintPlay();
    });
    var inp = el('scProf');
    function fromInput() { var p = findProf(inp.value); if (p) setProfession(p, true); }
    inp.addEventListener('change', fromInput);
    inp.addEventListener('input', function () { var q = inp.value.trim().toLowerCase(); var p = professions.filter(function (x) { return x.name.toLowerCase() === q; })[0]; if (p) setProfession(p, true); });
    // скраббинг по шкале времени
    var drag = false;
    function uFrom(e) { var r = cv.getBoundingClientRect(), G = tlGeom(); return clamp((e.clientX - r.left - G.l) / (G.r - G.l) * 2, 0, 2); }
    cv.addEventListener('pointerdown', function (e) { drag = true; playing = false; paintPlay(); try { cv.setPointerCapture(e.pointerId); } catch (x) {} curU = tgtU = uFrom(e); });
    cv.addEventListener('pointermove', function (e) { if (drag) curU = tgtU = uFrom(e); });
    function end() { if (!drag) return; drag = false; tgtU = Math.round(curU); }
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    // быстрый выбор профессий
    var quick = ['Бухгалтер', 'Программист', 'Врач-терапевт', 'Учитель', 'Юрист', 'Переводчик'].filter(function (n) { return findProf(n); });
    el('scQuick').innerHTML = quick.map(function (n) { return '<button type="button" data-n="' + escH(n) + '">' + escH(n) + '</button>'; }).join('');
    el('scQuick').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setProfession(findProf(b.dataset.n), false); });
    // допущения
    var T = el('scTable');
    if (T) T.innerHTML = '<tr><th>Сценарий</th><th>2026</th><th>2030</th><th>2040</th></tr>' + ['slow', 'moderate', 'fast'].map(function (s) { var p = SCEN[s].p; return '<tr><td>' + SCEN[s].name + '</td><td>' + p[0].toFixed(2) + '</td><td>' + p[1].toFixed(2) + '</td><td>' + p[2].toFixed(2) + '</td></tr>'; }).join('');
    setScenario('moderate');
    setProfession(findProf('Бухгалтер') || professions[0], false);
    window.addEventListener('hashchange', function () { if (location.hash === '#scenarios') setTimeout(scResize, 60); });
    if (location.hash === '#scenarios') setTimeout(scResize, 120);
    scLoop();
  }

  initFuture();
  initScenarios();
  window.AILabFuture = { rank: rank, openScenario: openScenario, model: { scoresAt: scoresAt, idx: idx, progAt: progAt } };
})();
