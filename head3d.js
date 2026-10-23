/* head3d/head3d.js — 3D-голова «AI Labor Assistant»
   Подключается к canvas#headCanvas на главной странице. Без внешних библиотек.

   • облако точек (контурные линии-меридианы) + редкая фиолетово-голубая сетка, уши из точек, светящийся нос
   • анимация появления: луч-сканер идёт сверху вниз, точки «слетаются» из пустоты, голова доворачивается
   • автоповорот на 360°, вращение пальцем / мышью (с инерцией), клавиши ← →
   • нажатие (удержание) — голова светится, по клику по ней пробегает волна света
   • ассистент: событие "assistant-speak" ({detail:{on:true|false}}) — голова поворачивается лицом
     к зрителю и пульсирует, пока отвечает
   • API: window.Head3D.pulse(), window.Head3D.replay() */
(function () {
  'use strict';

  var canvas = document.getElementById('headCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var hint = document.getElementById('headHint');

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var TAU = Math.PI * 2;

  /* ---------- вспомогательные ---------- */
  var seed = 20261023;
  function rand() {                       // детерминированный генератор: голова всегда одинаковая
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rnd(a, b) { return a + rand() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ease(t) { t = 1 - t; return 1 - t * t * t; }          // easeOutCubic
  function g2(a, sa, b, sb) { return Math.exp(-(a * a / (sa * sa) + b * b / (sb * sb))); }

  /* ---------- форма головы ---------- */
  var Y_TOP = 1.05, Y_BOT = -1.15, YC = -0.05;

  function halfW(y) {
    if (y >= 0.05) { var u = (y - 0.05) / 1.0; return 0.72 * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.3))); }
    var k = clamp((0.05 - y) / 1.2, 0, 1);
    return 0.72 * (1 - 0.42 * Math.pow(k, 1.4)) * Math.sqrt(Math.max(0, 1 - Math.pow(k, 7)));
  }
  function halfD(y) {
    if (y >= 0.05) { var u = (y - 0.05) / 1.0; return 0.86 * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.3))); }
    var k = clamp((0.05 - y) / 1.2, 0, 1);
    return 0.86 * (1 - 0.28 * k) * Math.sqrt(Math.max(0, 1 - Math.pow(k, 7)));
  }

  // рельеф лица (смещение вперёд по z)
  function feat(x, y) {
    var ax = Math.abs(x), f = 0;
    var win = clamp((y + 0.22) / 0.35, 0, 1) * clamp((0.42 - y) / 0.12, 0, 1);
    f += 0.13 * Math.exp(-(x * x) / (0.075 * 0.075)) * win;               // спинка носа
    f += 0.24 * g2(x, 0.12, y + 0.24, 0.10);                              // кончик носа
    f += 0.07 * g2(ax - 0.13, 0.06, y + 0.29, 0.06);                      // крылья носа
    f -= 0.07 * g2(ax - 0.30, 0.15, y - 0.22, 0.08);                      // глазницы
    f += 0.06 * g2(ax - 0.30, 0.22, y - 0.36, 0.05);                      // брови
    f += 0.05 * g2(ax - 0.42, 0.16, y + 0.05, 0.14);                      // скулы
    f -= 0.06 * g2(x, 0.22, y + 0.585, 0.022);                            // линия рта
    f += 0.05 * g2(x, 0.20, y + 0.52, 0.045);                             // верхняя губа
    f += 0.05 * g2(x, 0.19, y + 0.66, 0.05);                              // нижняя губа
    f += 0.08 * g2(x, 0.22, y + 0.93, 0.12);                              // подбородок
    return f;
  }

  /* ---------- облако точек ---------- */
  var P = { x: [], y: [], z: [], nx: [], nz: [], c: [] };
  function add(x, y, z, nx, nz, c) { P.x.push(x); P.y.push(y); P.z.push(z); P.nx.push(nx); P.nz.push(nz); P.c.push(c); }

  function surf(theta, y) {
    var w = halfW(y), d = Math.max(halfD(y), 0.001);
    var s = Math.sin(theta), c = Math.cos(theta);
    var x = w * s, z = d * c;
    if (c > 0) z += Math.pow(c, 1.2) * feat(x, y);
    var nx = s / Math.max(w, 0.05), nz = c / d, len = Math.sqrt(nx * nx + nz * nz) || 1;
    return { x: x, y: y, z: z, nx: nx / len, nz: nz / len };
  }
  function addSurf(theta, y, c) { var p = surf(theta, y); add(p.x, p.y, p.z, p.nx, p.nz, c); return p; }
  function addXY(x, y, c) {
    var w = halfW(y);
    return addSurf(Math.asin(clamp(x / Math.max(w, 0.05), -0.98, 0.98)), y, c);
  }

  var i, j, s, m, a, t, y, r;

  // меридианы — «контурные линии», вложенные друг в друга, если смотреть спереди
  var M = 60;
  for (m = 0; m < M; m++) {
    var th = -Math.PI + (m + 0.5) * TAU / M;
    for (y = Y_TOP - 0.01; y > Y_BOT + 0.01; y -= 0.022) {
      if (rand() > clamp(halfW(y) / 0.5, 0.22, 1)) continue;
      r = rand();
      addSurf(th + rnd(-0.004, 0.004), y + rnd(-0.006, 0.006), r < 0.76 ? 0 : (r < 0.9 ? 1 : 2));
    }
  }
  // редкие горизонтальные «срезы»
  for (y = 1.0; y > -1.1; y -= 0.12) {
    var n = Math.round(TAU * Math.max(halfW(y), halfD(y)) / 0.035), ph = rand() * TAU;
    for (j = 0; j < n; j++) addSurf(ph + j / n * TAU, y, 0);
  }
  // глаза, брови, нос, рот — голубые точки
  for (s = -1; s <= 1; s += 2) {
    for (j = 0; j < 26; j++) { a = j / 26 * TAU; addXY(s * 0.30 + 0.12 * Math.cos(a), 0.22 + 0.042 * Math.sin(a), 1); }
    for (j = 0; j < 4; j++) addXY(s * 0.30 + rnd(-0.03, 0.03), 0.22 + rnd(-0.015, 0.015), 1);
    for (j = 0; j < 18; j++) { t = j / 17; addXY(s * (0.14 + 0.34 * t), 0.34 + 0.05 * Math.sin(t * Math.PI * 0.8), 1); }
    for (y = 0.32; y > -0.2; y -= 0.03) addXY(s * 0.05, y, 1);                         // спинка носа
    for (j = 0; j < 14; j++) { a = j / 14 * TAU; addXY(s * 0.13 + 0.06 * Math.cos(a), -0.28 + 0.04 * Math.sin(a), 1); }
  }
  for (j = 0; j < 22; j++) { a = j / 22 * TAU; addXY(0.10 * Math.cos(a), -0.24 + 0.07 * Math.sin(a), 1); }
  for (j = 0; j < 30; j++) addXY(rnd(-0.1, 0.1), rnd(-0.34, -0.15), r = (rand() < 0.5 ? 1 : 2));
  for (x = -0.14; x <= 0.14; x += 0.02) addXY(x, -0.335, 1);
  for (j = 0; j < 32; j++) { t = j / 31; addXY(-0.21 + 0.42 * t, -0.58 - 0.02 * Math.sin(t * Math.PI), 1); }
  for (j = 0; j < 24; j++) { t = j / 23; addXY(-0.17 + 0.34 * t, -0.52 + 0.012 * Math.cos(t * TAU), 2); }
  for (j = 0; j < 24; j++) { t = j / 23; addXY(-0.17 + 0.34 * t, -0.67 + 0.03 * Math.sin(t * Math.PI), 2); }
  var x;
  // уши — «пунктиром» по бокам
  for (s = -1; s <= 1; s += 2) {
    var scales = [1, 0.7, 0.42], counts = [46, 30, 18];
    for (var pass = 0; pass < 3; pass++) {
      for (j = 0; j < counts[pass]; j++) {
        a = j / counts[pass] * TAU; var sc = scales[pass];
        add(s * (0.76 + 0.13 * sc * Math.sin(a / 2)), -0.02 + 0.34 * sc * Math.sin(a), -0.06 + 0.2 * sc * Math.cos(a), s, 0, pass === 0 ? 1 : 0);
      }
    }
    for (j = 0; j < 90; j++) {
      a = rand() * TAU; r = Math.sqrt(rand());
      add(s * (0.74 + rnd(0.0, 0.12)), -0.02 + 0.34 * r * Math.sin(a), -0.06 + 0.2 * r * Math.cos(a), s, 0, rand() < 0.25 ? 1 : 0);
    }
  }

  var N = P.x.length;
  var tx = new Float32Array(P.x), ty = new Float32Array(P.y), tz = new Float32Array(P.z);
  var pnx = new Float32Array(P.nx), pnz = new Float32Array(P.nz), pc = new Uint8Array(P.c);
  var ox = new Float32Array(N), oy = new Float32Array(N), oz = new Float32Array(N), dl = new Float32Array(N);
  for (i = 0; i < N; i++) {                         // стартовые положения для анимации появления
    var vx = rnd(-1, 1), vy = rnd(-1, 1), vz = rnd(-1, 1), vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1, dist = rnd(1.2, 3.2);
    ox[i] = vx / vl * dist; oy[i] = vy / vl * dist; oz[i] = vz / vl * dist;
    dl[i] = Math.max(0, (1.1 - ty[i]) * 0.95) + rand() * 0.3;
  }
  var DUR = 1.0;

  /* ---------- сетка (узлы и рёбра) ---------- */
  var nodes = [];
  function node(p, c, anchor) { nodes.push({ x: p.x, y: p.y, z: p.z, c: c, an: !!anchor }); }
  for (i = 0; i < 260; i++) {
    node(surf(i < 120 ? rnd(-1.25, 1.25) : rnd(-Math.PI, Math.PI), rnd(-1.05, 0.98)), rand() < 0.3 ? 1 : 2, false);
  }
  var anchors = [[-0.30, 0.22], [0.30, 0.22], [0, -0.24], [-0.13, -0.29], [0.13, -0.29], [-0.2, -0.58], [0.2, -0.58], [0, -0.96],
                 [-0.3, 0.36], [0.3, 0.36], [0, 0.72], [-0.42, -0.2], [0.42, -0.2], [-0.45, -0.5], [0.45, -0.5], [-0.55, 0.5], [0.55, 0.5], [0, 0.1]];
  for (i = 0; i < anchors.length; i++) {
    var ap = (function (q) { var w = halfW(q[1]); return surf(Math.asin(clamp(q[0] / Math.max(w, 0.05), -0.98, 0.98)), q[1]); })(anchors[i]);
    node(ap, 1, true);
  }
  for (s = -1; s <= 1; s += 2) for (j = 0; j < 5; j++) {
    a = j / 5 * TAU; nodes.push({ x: s * (0.82 + 0.05 * Math.sin(a / 2)), y: -0.02 + 0.3 * Math.sin(a), z: -0.06 + 0.18 * Math.cos(a), c: 1, an: false });
  }
  var NN = nodes.length, ea = [], eb = [], ec = [], seen = {};
  for (i = 0; i < NN; i++) {
    var near = [];
    for (j = 0; j < NN; j++) {
      if (j === i) continue;
      var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, dz = nodes[i].z - nodes[j].z;
      var dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dd < 0.62) near.push([dd, j]);
    }
    near.sort(function (p, q) { return p[0] - q[0]; });
    for (j = 0; j < Math.min(3, near.length); j++) {
      var k2 = Math.min(i, near[j][1]) * 1000 + Math.max(i, near[j][1]);
      if (seen[k2]) continue;
      seen[k2] = 1; ea.push(i); eb.push(near[j][1]);
      ec.push(nodes[i].an && nodes[near[j][1]].an ? 1 : 0);
    }
  }
  var NE = ea.length;
  var nX = new Float32Array(NN), nY = new Float32Array(NN), nZ = new Float32Array(NN), nS = new Float32Array(NN), nA = new Float32Array(NN);
  var edgeBucket = new Uint8Array(NE);

  /* ---------- состояние ---------- */
  var W = 0, H = 0, dpr = 1, S = 100, cx = 0, cy = 0;
  var CAM = 4.0;
  var yaw = 0, yawV = 0, pitchDrag = 0;
  var glow = 0, holding = false, speaking = false, nextSpeakPulse = 0;
  var clock = 0, lastNow = 0, introStart = null, away = false;
  var pulses = [];
  var visible = true, raf = 0, dragState = null;

  var COLORS = [
    ['rgba(60,120,255,0.34)', 'rgba(72,152,255,0.82)', 'rgba(175,216,255,1)'],
    ['rgba(40,220,255,0.40)', 'rgba(60,240,255,0.92)', 'rgba(222,255,255,1)'],
    ['rgba(150,80,255,0.40)', 'rgba(176,102,255,0.92)', 'rgba(242,218,255,1)']
  ];
  var HALO = ['rgba(90,160,255,1)', 'rgba(70,240,255,1)', 'rgba(190,130,255,1)'];
  var NB = 9, bx = [], by = [], bn = new Int32Array(NB);
  for (i = 0; i < NB; i++) { bx.push(new Float32Array(N + 8)); by.push(new Float32Array(N + 8)); }

  function pulse(amp) {
    amp = amp || 1;
    pulses.push({ t0: clock, amp: amp });
    if (pulses.length > 4) pulses.shift();
    glow = Math.max(glow, 0.85 * amp);
    start();
  }
  function replay() { introStart = clock; yaw = 0; yawV = 0; pitchDrag = 0; pulses.length = 0; start(); }
  function hideHint() { if (hint) hint.classList.add('hide'); }

  /* ---------- размер ---------- */
  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (w === 0 || h === 0) { W = 0; H = 0; away = true; return; }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    W = w; H = h;
    S = Math.min(H / 3.05, W / 2.7);
    cx = W / 2; cy = H / 2;
    if (away && introStart !== null) { away = false; replay(); } else away = false;
  }

  /* ---------- кадр ---------- */
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || W === 0) return;
    var t = now / 1000, dt = Math.min(0.05, lastNow ? t - lastNow : 0.016);
    lastNow = t; clock = t;
    if (introStart === null) introStart = clock;
    var T = reduce ? 99 : clock - introStart;

    // --- вращение ---
    var introDone = T > 3.2;
    if (!dragState) {
      if (speaking && introDone) {
        yaw += (Math.round(yaw / TAU) * TAU - yaw) * Math.min(1, dt * 3.2); yawV = 0;
      } else {
        yawV *= Math.exp(-dt * 1.6);
        yaw += (yawV + (introDone && !reduce ? 0.38 : 0)) * dt;
      }
    }
    pitchDrag *= Math.exp(-dt * (dragState ? 0 : 1.3));
    var introYaw = T < 3.4 ? -(1 - ease(clamp(T / 3.4, 0, 1))) * TAU * 0.9 : 0;
    var yw = yaw + introYaw;
    var pitch = 0.06 + pitchDrag + (reduce ? 0 : 0.03 * Math.sin(clock * 0.7));
    var cyw = Math.cos(yw), syw = Math.sin(yw), cp = Math.cos(pitch), sp = Math.sin(pitch);

    // --- свечение ---
    var target = holding ? 0.8 : (speaking ? 0.4 + 0.15 * Math.sin(clock * 5) : 0);
    glow += (target - glow) * Math.min(1, dt * (target > glow ? 10 : 2.2));
    if (speaking && clock > nextSpeakPulse) { nextSpeakPulse = clock + 1.25; pulse(0.55); }
    for (i = pulses.length - 1; i >= 0; i--) if (clock - pulses[i].t0 > 1.3) pulses.splice(i, 1);
    var np = pulses.length, pwY = [], pwA = [];
    for (i = 0; i < np; i++) { pwY.push(-1.3 + (clock - pulses[i].t0) / 1.1 * 2.7); pwA.push(pulses[i].amp * clamp(1.3 - (clock - pulses[i].t0), 0, 1)); }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // ореол
    var ha = 0.07 + 0.30 * glow;
    var grd = ctx.createRadialGradient(cx, cy, S * 0.1, cx, cy, S * 1.5);
    grd.addColorStop(0, 'rgba(70,150,255,' + ha.toFixed(3) + ')');
    grd.addColorStop(0.55, 'rgba(110,70,255,' + (ha * 0.35).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);

    // луч-сканер при появлении
    if (T < 2.6) {
      var by0 = cy - ((1.1 - T / 0.95) - YC) * S, ba = Math.sin(clamp(T / 2.6, 0, 1) * Math.PI);
      var lg = ctx.createLinearGradient(cx - S, 0, cx + S, 0);
      lg.addColorStop(0, 'rgba(80,230,255,0)'); lg.addColorStop(0.5, 'rgba(120,240,255,' + (0.85 * ba).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(80,230,255,0)');
      ctx.fillStyle = lg; ctx.fillRect(cx - S, by0 - dpr, S * 2, 2 * dpr);
    }

    // --- точки ---
    bn.fill(0);
    for (i = 0; i < N; i++) {
      var ap = (T - dl[i]) / DUR;
      if (ap <= 0) continue;
      var inv = 0;
      if (ap < 1) inv = 1 - ease(ap); else ap = 1;
      var px = tx[i] + ox[i] * inv, py = ty[i] + oy[i] * inv, pz = tz[i] + oz[i] * inv;
      var x1 = px * cyw + pz * syw, z1 = -px * syw + pz * cyw;
      var y2 = py * cp - z1 * sp, z2 = py * sp + z1 * cp;
      var k = CAM / (CAM - z2);
      var sx = cx + x1 * k * S, sy = cy - (y2 - YC) * k * S;
      var nzv = -pnx[i] * syw + pnz[i] * cyw;
      var rim = 1 - Math.abs(nzv); rim = rim * rim * rim;
      var v = 0.40 + 0.55 * rim + (nzv < 0 ? -0.17 : 0.05) + glow * 0.4;
      if (ap < 1) v += 0.5;
      for (j = 0; j < np; j++) { var dd2 = ty[i] - pwY[j]; v += pwA[j] * 1.3 * Math.exp(-dd2 * dd2 * 16); }
      var lv = v < 0.5 ? 0 : (v < 0.95 ? 1 : 2), b = pc[i] * 3 + lv, q = bn[b]++;
      bx[b][q] = sx; by[b][q] = sy;
    }
    var sizes = [1.1 * dpr, 1.6 * dpr, 2.3 * dpr];
    for (var b2 = 0; b2 < NB; b2++) {
      var cnt = bn[b2]; if (!cnt) continue;
      var lv2 = b2 % 3, cl = (b2 / 3) | 0, sz = sizes[lv2], hs = sz / 2, X = bx[b2], Y = by[b2];
      ctx.fillStyle = COLORS[cl][lv2];
      ctx.beginPath();
      for (j = 0; j < cnt; j++) ctx.rect(X[j] - hs, Y[j] - hs, sz, sz);
      ctx.fill();
      if (lv2 === 2) {                                   // мягкое свечение вокруг самых ярких точек
        ctx.globalAlpha = 0.2; ctx.fillStyle = HALO[cl];
        var bs = sz * 3, bh = bs / 2;
        ctx.beginPath();
        for (j = 0; j < cnt; j++) ctx.rect(X[j] - bh, Y[j] - bh, bs, bs);
        ctx.fill(); ctx.globalAlpha = 1;
      }
    }

    // --- сетка ---
    var la = clamp((T - 1.6) / 1.4, 0, 1);
    if (la > 0) {
      for (i = 0; i < NN; i++) {
        var nd = nodes[i];
        var nx1 = nd.x * cyw + nd.z * syw, nz1 = -nd.x * syw + nd.z * cyw;
        var ny2 = nd.y * cp - nz1 * sp, nz2 = nd.y * sp + nz1 * cp, kk = CAM / (CAM - nz2);
        nX[i] = cx + nx1 * kk * S; nY[i] = cy - (ny2 - YC) * kk * S; nZ[i] = nz2; nS[i] = kk;
      }
      var gl = Math.min(1, 1 + glow * 1.4);
      var lineA = [0.30, 0.10];
      for (var e = 0; e < NE; e++) edgeBucket[e] = ec[e] * 2 + ((nZ[ea[e]] + nZ[eb[e]]) > 0 ? 0 : 1);
      ctx.lineWidth = 0.9 * dpr;
      for (var bk = 0; bk < 4; bk++) {
        var al = lineA[bk & 1] * la * (1 + glow * 1.6);
        ctx.strokeStyle = (bk >> 1) ? 'rgba(70,230,255,' + Math.min(al * 1.4, 0.9).toFixed(3) + ')' : 'rgba(165,95,255,' + Math.min(al, 0.9).toFixed(3) + ')';
        ctx.beginPath();
        for (e = 0; e < NE; e++) if (edgeBucket[e] === bk) { ctx.moveTo(nX[ea[e]], nY[ea[e]]); ctx.lineTo(nX[eb[e]], nY[eb[e]]); }
        ctx.stroke();
      }
      for (i = 0; i < NN; i++) {
        var fr = nZ[i] > 0, rr = (nodes[i].an ? 2.3 : 1.7) * dpr * (fr ? 1 : 0.7);
        ctx.fillStyle = nodes[i].c === 1 ? 'rgba(80,240,255,' + ((fr ? 0.85 : 0.3) * la * gl).toFixed(3) + ')' : 'rgba(180,110,255,' + ((fr ? 0.8 : 0.28) * la * gl).toFixed(3) + ')';
        ctx.fillRect(nX[i] - rr / 2, nY[i] - rr / 2, rr, rr);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    start();
  }

  function start() {
    if (!raf && visible && !document.hidden && W > 0) raf = requestAnimationFrame(frame);
  }

  /* ---------- управление ---------- */
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;

  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    dragState = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), lt: performance.now(), moved: false, type: e.pointerType };
    holding = true; hideHint(); canvas.style.cursor = 'grabbing'; start();
  });
  canvas.addEventListener('pointermove', function (e) {
    var d = dragState; if (!d || e.pointerId !== d.id) return;
    var nowMs = performance.now(), dx = e.clientX - d.x, dy = e.clientY - d.y, dts = Math.max(0.008, (nowMs - d.lt) / 1000);
    d.x = e.clientX; d.y = e.clientY; d.lt = nowMs;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6) d.moved = true;
    yaw += dx * 0.009;
    yawV = clamp(0.6 * yawV + 0.4 * (dx * 0.009 / dts), -6, 6);
    if (d.type === 'mouse') pitchDrag = clamp(pitchDrag + dy * 0.006, -0.5, 0.5);
  });
  function release(e, cancelled) {
    var d = dragState; if (!d || e.pointerId !== d.id) return;
    holding = false; canvas.style.cursor = '';
    if (!cancelled && !d.moved && performance.now() - d.t < 700) pulse(1);
    dragState = null;
  }
  canvas.addEventListener('pointerup', function (e) { release(e, false); });
  canvas.addEventListener('pointercancel', function (e) { release(e, true); });
  canvas.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideHint(); pulse(1); }
    else if (e.key === 'ArrowLeft') { yawV = -1.6; hideHint(); }
    else if (e.key === 'ArrowRight') { yawV = 1.6; hideHint(); }
  });

  // ассистент отвечает — голова смотрит на зрителя и пульсирует
  window.addEventListener('assistant-speak', function (e) {
    speaking = !!(e.detail && e.detail.on);
    if (speaking) nextSpeakPulse = 0;
    start();
  });

  /* ---------- запуск ---------- */
  if (window.ResizeObserver) new ResizeObserver(function () { resize(); start(); }).observe(canvas);
  window.addEventListener('resize', function () { resize(); start(); });
  if (window.IntersectionObserver) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); }).observe(canvas);
  document.addEventListener('visibilitychange', function () { lastNow = 0; start(); });
  resize(); start();

  window.Head3D = { pulse: function () { pulse(1); }, replay: replay };
})();
