/* head3d.js — голографическая 3D-голова «AI Labor Assistant»
   Подключается к canvas#headCanvas. Данные модели — headdata.js (window.HEAD3D_DATA). Без внешних библиотек.

   • тонкая голографическая сетка модели; чёткие грани (нос, губы, веки, контур лица) светятся ярче
   • схемы и чипы на голове (как у референса), по схемам бегут световые импульсы
   • светящиеся белые глаза — свет повторяет форму разреза глаз
   • анимация появления: луч-сканер проходит сверху вниз и «проявляет» голову, затем прорисовываются схемы
   • автоповорот на 360°, вращение пальцем / мышью (с инерцией), клавиши ← →
   • нажатие (удержание) — голова светится, по клику по ней пробегает волна света
   • событие "assistant-speak" ({detail:{on:true|false}}) — голова поворачивается лицом к зрителю и пульсирует
   • API: window.Head3D.pulse(), window.Head3D.replay() */
(function () {
  'use strict';

  var canvas = document.getElementById('headCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var hint = document.getElementById('headHint');
  var D = window.HEAD3D_DATA;
  if (!D) { if (window.console) console.warn('head3d: не найден headdata.js'); return; }

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var TAU = Math.PI * 2;

  /* ---------- вспомогательные ---------- */
  var seed = 20261024;
  function rand() {                                         // детерминированный генератор: схемы всегда одинаковые
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rnd(a, b) { return a + rand() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ease(t) { t = 1 - t; return 1 - t * t * t; }
  function sm(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function b64(s) { var bin = atob(s), n = bin.length, u = new Uint8Array(n); for (var q = 0; q < n; q++) u[q] = bin.charCodeAt(q); return u.buffer; }

  /* ---------- модель ---------- */
  var NV = D.nv, NT = D.nf, NE = D.ne, Q = D.q, i, j, k;
  var vi = new Int16Array(b64(D.v)), vni = new Int8Array(b64(D.vn));
  var TRI = new Uint16Array(b64(D.f)), EA = new Uint16Array(b64(D.e)), EC = new Uint8Array(b64(D.ec));
  var VX = new Float32Array(NV), VY = new Float32Array(NV), VZ = new Float32Array(NV);
  var VNX = new Float32Array(NV), VNY = new Float32Array(NV), VNZ = new Float32Array(NV), VF = new Float32Array(NV);
  var Y_CHIN = D.chin, YC = 0;
  for (i = 0; i < NV; i++) {
    VX[i] = vi[i * 3] / Q; VY[i] = vi[i * 3 + 1] / Q; VZ[i] = vi[i * 3 + 2] / Q;
    VNX[i] = vni[i * 3] / 127; VNY[i] = vni[i * 3 + 1] / 127; VNZ[i] = vni[i * 3 + 2] / 127;
    var yy = VY[i];                                           // шея плавно гаснет под подбородком
    VF[i] = yy >= Y_CHIN + 0.02 ? 1 : Math.pow(clamp(1 - (Y_CHIN + 0.02 - yy) / 0.4, 0, 1), 2);
  }
  var EYES = D.eyes || [], EYE_LOOPS = D.eyeLoops || [];

  // ось головы (для схем): центр по z
  var Z0 = (function () {
    var mn = 9, mx = -9;
    for (var a = 0; a < NV; a++) if (VY[a] > -0.3 && VY[a] < 0.6) { if (VZ[a] < mn) mn = VZ[a]; if (VZ[a] > mx) mx = VZ[a]; }
    return (mn + mx) / 2;
  })();

  /* ---------- «высотная карта» поверхности для схем: радиус r(θ, y) ---------- */
  var NTH = 240, NYH = 130, YH0 = -1.35, YH1 = 1.15, HF = new Float32Array(NTH * NYH);
  function hfAdd(x, y, z) {
    var th = Math.atan2(x, z - Z0), r = Math.sqrt(x * x + (z - Z0) * (z - Z0));
    var ti = Math.floor((th + Math.PI) / TAU * NTH) % NTH, yi = Math.floor((y - YH0) / (YH1 - YH0) * NYH);
    if (yi < 0 || yi >= NYH) return;
    var id = yi * NTH + ti; if (r > HF[id]) HF[id] = r;
  }
  for (i = 0; i < NV; i++) hfAdd(VX[i], VY[i], VZ[i]);
  for (i = 0; i < NT; i++) {
    var ta = TRI[i * 3], tb = TRI[i * 3 + 1], tc = TRI[i * 3 + 2];
    hfAdd((VX[ta] + VX[tb] + VX[tc]) / 3, (VY[ta] + VY[tb] + VY[tc]) / 3, (VZ[ta] + VZ[tb] + VZ[tc]) / 3);
    hfAdd((VX[ta] + VX[tb]) / 2, (VY[ta] + VY[tb]) / 2, (VZ[ta] + VZ[tb]) / 2);
  }
  for (var pass = 0; pass < 3; pass++) {                      // заполнить пустые ячейки по соседям
    var HF2 = HF.slice();
    for (var yh = 0; yh < NYH; yh++) for (var th2 = 0; th2 < NTH; th2++) {
      if (HF[yh * NTH + th2] > 0) continue;
      var sum = 0, cn = 0;
      for (var dy = -2; dy <= 2; dy++) for (var dt = -2; dt <= 2; dt++) {
        var y3 = yh + dy, t3 = (th2 + dt + NTH) % NTH;
        if (y3 < 0 || y3 >= NYH) continue;
        var rv = HF[y3 * NTH + t3]; if (rv > 0) { sum += rv; cn++; }
      }
      if (cn) HF2[yh * NTH + th2] = sum / cn;
    }
    HF = HF2;
  }
  function H(th, y) {
    var ft = (th + Math.PI) / TAU * NTH - 0.5, fy = clamp((y - YH0) / (YH1 - YH0) * NYH - 0.5, 0, NYH - 1.001);
    var t0 = Math.floor(ft), y0 = Math.floor(fy), wt = ft - t0, wy = fy - y0;
    t0 = (t0 % NTH + NTH) % NTH; var t1 = (t0 + 1) % NTH;
    var a0 = HF[y0 * NTH + t0] * (1 - wt) + HF[y0 * NTH + t1] * wt, a1 = HF[(y0 + 1) * NTH + t0] * (1 - wt) + HF[(y0 + 1) * NTH + t1] * wt;
    return a0 * (1 - wy) + a1 * wy;
  }

  /* ---------- схемы и чипы (как на референсе) ---------- */
  var RAD = 0.8;                                              // перевод длины дуги u в угол θ
  var CX = [], CY = [], CZ = [], CNX = [], CNZ = [], TR = [];
  function addPoly(uy, cls, closed, bold) {
    var pts = [], m, n2, st = CX.length;
    for (m = 0; m < uy.length; m++) {
      var p1 = uy[m], p2 = uy[(m + 1) % uy.length];
      if (m === uy.length - 1 && !closed) { pts.push(p1); break; }
      var dist = Math.sqrt((p2[0] - p1[0]) * (p2[0] - p1[0]) + (p2[1] - p1[1]) * (p2[1] - p1[1]));
      n2 = Math.max(1, Math.ceil(dist / 0.03));
      for (var s2 = 0; s2 < n2; s2++) pts.push([p1[0] + (p2[0] - p1[0]) * s2 / n2, p1[1] + (p2[1] - p1[1]) * s2 / n2]);
    }
    var cum = [0];
    for (m = 0; m < pts.length; m++) {
      var th = pts[m][0] / RAD, yv = pts[m][1], r = H(th, yv) + 0.006;
      CX.push(r * Math.sin(th)); CY.push(yv); CZ.push(Z0 + r * Math.cos(th)); CNX.push(Math.sin(th)); CNZ.push(Math.cos(th));
      if (m) cum.push(cum[m - 1] + Math.sqrt(Math.pow(pts[m][0] - pts[m - 1][0], 2) + Math.pow(pts[m][1] - pts[m - 1][1], 2)));
    }
    TR.push({ s: st, e: CX.length, closed: !!closed, cls: cls, bold: !!bold, cum: cum, total: cum[cum.length - 1] || 0.01, ph: rand(), sp: rnd(0.10, 0.26), t0: rnd(0, 1.3) });
  }
  function pad(u, y, cls) { var h = 0.011; addPoly([[u - h, y - h], [u + h, y - h], [u + h, y + h], [u - h, y + h]], cls, true); }
  function ring(u, y, r, cls) { var pts = []; for (var a = 0; a < 8; a++) pts.push([u + r * Math.cos(a * TAU / 8), y + r * Math.sin(a * TAU / 8)]); addPoly(pts, cls, true); }
  function chip(u, y, R, cls) {
    var oct = [], a, h = R * 0.5;
    for (a = 0; a < 8; a++) oct.push([u + R * Math.cos(a * TAU / 8 + TAU / 16), y + R * Math.sin(a * TAU / 8 + TAU / 16)]);
    addPoly(oct, 1, true, true);
    addPoly([[u - h, y - h], [u + h, y - h], [u + h, y + h], [u - h, y + h]], 1, true, true);
    ring(u, y, R * 0.16, cls);
    for (a = 0; a < 8; a += 2) {                              // выводы чипа
      var ox = u + R * Math.cos(a * TAU / 8 + TAU / 16), oy = y + R * Math.sin(a * TAU / 8 + TAU / 16);
      var ex = ox + Math.cos(a * TAU / 8 + TAU / 16) * R * 0.9, ey = oy + Math.sin(a * TAU / 8 + TAU / 16) * R * 0.9;
      addPoly([[ox, oy], [ex, ey]], cls, false); pad(ex, ey, cls);
    }
  }
  var DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  function allowed(u, y) {
    var ath = Math.abs(u / RAD);
    if (Math.abs(u) > 2.4 || y > 0.97) return false;
    if (ath > 2.2) return y > -0.25;                          // затылок
    if (ath > 1.1) return y > 0.4;                            // виски (уши ниже)
    return y > 0.46;                                          // лоб и макушка
  }
  function walk(u0, y0, steps, cls) {
    var d = Math.floor(rand() * 8), u = u0, y = y0, pts = [[u, y]], L;
    for (var s3 = 0; s3 < steps; s3++) {
      L = 0.06 * (2 + Math.floor(rand() * 4));
      var nu = u + DIRS[d][0] * L * (d % 2 ? 0.707 : 1), ny = y + DIRS[d][1] * L * (d % 2 ? 0.707 : 1);
      if (!allowed(nu, ny)) break;
      u = nu; y = ny; pts.push([u, y]);
      if (rand() < 0.55) d = (d + (rand() < 0.5 ? 1 : -1) * (rand() < 0.65 ? 1 : 2) + 8) % 8;
    }
    if (pts.length < 2) return;
    addPoly(pts, cls, false);
    if (rand() < 0.75) { if (rand() < 0.5) pad(u, y, cls); else ring(u, y, 0.016, cls); }
  }
  // лоб: центральный чип и дорожки вниз к переносице
  chip(0, 0.67, 0.115, 0);
  addPoly([[0, 0.555], [0, 0.3]], 0, false); ring(0, 0.3, 0.014, 0);
  addPoly([[0, 0.50], [0.09, 0.50], [0.09, 0.40]], 0, false); pad(0.09, 0.40, 0);
  addPoly([[0, 0.44], [-0.09, 0.44], [-0.09, 0.35]], 0, false); pad(-0.09, 0.35, 0);
  for (var sg = -1; sg <= 1; sg += 2) {
    addPoly([[sg * 0.115, 0.67], [sg * 0.30, 0.67], [sg * 0.30, 0.56], [sg * 0.46, 0.56], [sg * 0.46, 0.42]], 0, false); pad(sg * 0.46, 0.42, 0);
    addPoly([[sg * 0.115, 0.72], [sg * 0.22, 0.72], [sg * 0.22, 0.80], [sg * 0.40, 0.80]], 2, false); pad(sg * 0.40, 0.80, 2);
    chip(sg * 0.62, 0.83, 0.055, 0);
    // линии по скуле и контуру лица (как на референсе)
    addPoly([[sg * 0.58, 0.30], [sg * 0.58, 0.10], [sg * 0.72, -0.04], [sg * 0.72, -0.40], [sg * 0.62, -0.58], [sg * 0.62, -0.80], [sg * 0.42, -0.98]], 0, false, true);
    addPoly([[sg * 0.50, 0.22], [sg * 0.50, 0.08], [sg * 0.62, -0.06], [sg * 0.62, -0.38], [sg * 0.54, -0.52], [sg * 0.54, -0.74], [sg * 0.36, -0.90]], 0, false);
    addPoly([[sg * 0.72, -0.18], [sg * 0.86, -0.18], [sg * 0.86, -0.30]], 0, false); pad(sg * 0.86, -0.30, 0);
    addPoly([[sg * 0.62, -0.62], [sg * 0.50, -0.62]], 2, false); ring(sg * 0.49, -0.62, 0.014, 2);
  }
  // макушка, виски, затылок
  chip(0.95, 0.86, 0.075, 0); chip(-1.05, 0.84, 0.065, 0); chip(1.8, 0.74, 0.08, 0); chip(-1.9, 0.78, 0.07, 0); chip(2.35, 0.2, 0.07, 0); chip(-2.3, 0.3, 0.06, 0);
  for (i = 0; i < 36; i++) walk(rnd(-2.3, 2.3), rnd(0.5, 0.95), 5 + Math.floor(rand() * 11), rand() < 0.13 ? 2 : 0);
  for (i = 0; i < 18; i++) walk((rand() < 0.5 ? -1 : 1) * rnd(1.8, 2.35), rnd(-0.2, 0.6), 5 + Math.floor(rand() * 9), rand() < 0.12 ? 2 : 0);
  var NC = CX.length;
  var CXa = new Float32Array(CX), CYa = new Float32Array(CY), CZa = new Float32Array(CZ), CNXa = new Float32Array(CNX), CNZa = new Float32Array(CNZ);
  var CSX = new Float32Array(NC), CSY = new Float32Array(NC), CFA = new Float32Array(NC);

  /* ---------- блёстки на вершинах ---------- */
  var SPK = [];
  for (i = 0; i < 260; i++) { var sv = Math.floor(rand() * NV); if (VF[sv] > 0.9) SPK.push({ v: sv, ph: rand() * TAU, sp: rnd(1.2, 3.2), c: rand() < 0.3 ? 1 : 0 }); }

  /* ---------- состояние ---------- */
  var W = 0, H2 = 0, dpr = 1, S = 100, cx = 0, cy = 0, CAM = 4.0;
  var yaw = 0, yawV = 0, pitchDrag = 0, glow = 0, holding = false, speaking = false, nextSpeakPulse = 0;
  var clock = 0, lastNow = 0, introStart = null, away = false, pulses = [], visible = true, raf = 0, dragState = null;
  var SX = new Float32Array(NV), SY = new Float32Array(NV), FA = new Float32Array(NV), FX = new Float32Array(NV), FY = new Float32Array(NV);
  var NB = 9, EB = [], EBN = new Int32Array(NB), TBX = [], TBN = new Int32Array(3), CB = [], CBN = new Int32Array(9);
  for (i = 0; i < NB; i++) EB.push(new Float32Array(NE * 4 + 8));
  for (i = 0; i < 3; i++) TBX.push(new Float32Array(NT * 6 + 8));
  for (i = 0; i < 9; i++) CB.push(new Float32Array(NC * 4 + 8));
  var E_COL = ['60,135,255', '70,205,255', '200,246,255'], E_A = [0.30, 0.55, 0.95], A_MUL = [0.45, 0.75, 1.0];
  var C_COL = ['90,235,255', '215,252,255', '255,176,115'];

  function pulse(amp) {
    amp = amp || 1;
    pulses.push({ t0: clock, amp: amp });
    if (pulses.length > 4) pulses.shift();
    glow = Math.max(glow, 0.85 * amp);
    start();
  }
  function replay() { introStart = clock; yaw = 0; yawV = 0; pitchDrag = 0; pulses.length = 0; start(); }
  function hideHint() { if (hint) hint.classList.add('hide'); }

  function resize() {
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (w === 0 || h === 0) { W = 0; H2 = 0; away = true; return; }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    W = w; H2 = h; S = Math.min(H2 / 3.05, W / 2.7); cx = W / 2; cy = H2 / 2;
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
      if (speaking && introDone) { yaw += (Math.round(yaw / TAU) * TAU - yaw) * Math.min(1, dt * 3.2); yawV = 0; }
      else { yawV *= Math.exp(-dt * 1.6); yaw += (yawV + (introDone && !reduce ? 0.38 : 0)) * dt; }
    }
    pitchDrag *= Math.exp(-dt * (dragState ? 0 : 1.3));
    var introYaw = T < 3.4 ? -(1 - ease(clamp(T / 3.4, 0, 1))) * TAU * 0.9 : 0;
    var yw = yaw + introYaw;
    var pitch = 0.06 + pitchDrag + (reduce ? 0 : 0.03 * Math.sin(clock * 0.7));
    var cyw = Math.cos(yw), syw = Math.sin(yw), cp = Math.cos(pitch), sp = Math.sin(pitch);

    // --- свечение и волны ---
    var target = holding ? 0.8 : (speaking ? 0.4 + 0.15 * Math.sin(clock * 5) : 0);
    glow += (target - glow) * Math.min(1, dt * (target > glow ? 10 : 2.2));
    if (speaking && clock > nextSpeakPulse) { nextSpeakPulse = clock + 1.25; pulse(0.55); }
    for (i = pulses.length - 1; i >= 0; i--) if (clock - pulses[i].t0 > 1.3) pulses.splice(i, 1);
    var np = pulses.length, pwY = [], pwA = [];
    for (i = 0; i < np; i++) { pwY.push(-1.3 + (clock - pulses[i].t0) / 1.1 * 2.7); pwA.push(pulses[i].amp * clamp(1.3 - (clock - pulses[i].t0), 0, 1)); }
    var revealY = reduce ? -9 : 1.4 - (T - 0.2) * 1.27;         // луч-сканер идёт сверху вниз: проявлено всё, что выше луча

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H2);
    ctx.globalCompositeOperation = 'lighter';

    // ореол
    var ha = 0.07 + 0.28 * glow;
    var grd = ctx.createRadialGradient(cx, cy, S * 0.1, cx, cy, S * 1.5);
    grd.addColorStop(0, 'rgba(60,140,255,' + ha.toFixed(3) + ')');
    grd.addColorStop(0.55, 'rgba(90,70,255,' + (ha * 0.3).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H2);

    // --- вершины ---
    for (i = 0; i < NV; i++) {
      var x = VX[i], y = VY[i], z = VZ[i];
      var x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp, kk = CAM / (CAM - z2);
      SX[i] = cx + x1 * kk * S; SY[i] = cy - (y2 - YC) * kk * S;
      var nx = VNX[i], ny = VNY[i], nz = VNZ[i];
      var n1 = nx * cyw + nz * syw, nz1 = -nx * syw + nz * cyw;
      FX[i] = n1; FY[i] = ny * cp - nz1 * sp; FA[i] = ny * sp + nz1 * cp;       // нормаль в координатах камеры; FA — «смотрит на нас»
    }
    var gmul = 1 + 0.5 * glow;

    // --- полупрозрачная заливка поверхности (объём голограммы) ---
    TBN.fill(0);
    for (i = 0; i < NT; i++) {
      var a = TRI[i * 3], b = TRI[i * 3 + 1], c = TRI[i * 3 + 2];
      var fav = (FA[a] + FA[b] + FA[c]) / 3; if (fav < 0.02) continue;
      var ym = (VY[a] + VY[b] + VY[c]) / 3; if (ym < revealY) continue;
      if (VF[a] < 0.999 || VF[b] < 0.999 || VF[c] < 0.999) continue;               // заливка только на голове, шея — лишь затухающие линии
      var lam = 0.35 + 0.5 * fav + 0.25 * (-(FX[a] + FX[b] + FX[c]) / 3 * 0.4 + (FY[a] + FY[b] + FY[c]) / 3 * 0.5);
      var bk = lam < 0.5 ? 0 : (lam < 0.8 ? 1 : 2), q = TBN[bk]; TBN[bk] += 6;
      var arr = TBX[bk]; arr[q] = SX[a]; arr[q + 1] = SY[a]; arr[q + 2] = SX[b]; arr[q + 3] = SY[b]; arr[q + 4] = SX[c]; arr[q + 5] = SY[c];
    }
    var fillA = [0.05, 0.085, 0.13];
    for (j = 0; j < 3; j++) {
      var cnt = TBN[j]; if (!cnt) continue;
      var ar = TBX[j];
      ctx.fillStyle = 'rgba(40,110,255,' + (fillA[j] * gmul).toFixed(3) + ')';
      ctx.beginPath();
      for (k = 0; k < cnt; k += 6) { ctx.moveTo(ar[k], ar[k + 1]); ctx.lineTo(ar[k + 2], ar[k + 3]); ctx.lineTo(ar[k + 4], ar[k + 5]); ctx.closePath(); }
      ctx.fill();
    }

    // --- сетка: плоские рёбра тусклые, чёткие грани и контур светятся ---
    EBN.fill(0);
    for (i = 0; i < NE; i++) {
      var ea = EA[i * 2], eb = EA[i * 2 + 1], fa = FA[ea], fb = FA[eb];
      if (fa < -0.12 && fb < -0.12) continue;
      var yE = (VY[ea] + VY[eb]) / 2; if (yE < revealY) continue;
      var vf = Math.min(VF[ea], VF[eb]); if (vf < 0.05) continue;
      var sil = (fa * fb < 0.03 && (fa > -0.3 || fb > -0.3)) ? 0.85 : 0;       // силуэт — контур лица светится
      var sv2 = EC[i] / 255; if (sil > sv2) sv2 = sil;
      var wv = 0;
      for (j = 0; j < np; j++) { var dwy = yE - pwY[j]; wv += pwA[j] * Math.exp(-dwy * dwy * 14); }
      if (wv > 0.02) sv2 = Math.max(sv2, Math.min(0.9, wv));
      var lvl = sv2 < 0.12 ? 0 : (sv2 < 0.3 ? 1 : 2);
      var avgF = (fa + fb) / 2, qa = vf * (avgF > 0.05 ? clamp(0.4 + 0.9 * avgF, 0, 1) : 0.4);
      if (sil) qa = vf;
      var al = qa > 0.66 ? 2 : (qa > 0.33 ? 1 : (qa > 0.06 ? 0 : -1)); if (al < 0) continue;
      var eb2 = lvl * 3 + al, qe = EBN[eb2]; EBN[eb2] += 4;
      var ear = EB[eb2]; ear[qe] = SX[ea]; ear[qe + 1] = SY[ea]; ear[qe + 2] = SX[eb]; ear[qe + 3] = SY[eb];
    }
    ctx.lineWidth = 0.9 * dpr;
    for (j = 0; j < NB; j++) {
      var cnt2 = EBN[j]; if (!cnt2) continue;
      var lv = (j / 3) | 0, alv = j % 3, ae = EB[j];
      ctx.strokeStyle = 'rgba(' + E_COL[lv] + ',' + Math.min(1, E_A[lv] * A_MUL[alv] * gmul).toFixed(3) + ')';
      ctx.beginPath();
      for (k = 0; k < cnt2; k += 4) { ctx.moveTo(ae[k], ae[k + 1]); ctx.lineTo(ae[k + 2], ae[k + 3]); }
      ctx.stroke();
    }

    // --- схемы и чипы ---
    var circA = clamp((T - 1.3) / 1.2, 0, 1);
    if (circA > 0) {
      for (i = 0; i < NC; i++) {
        var cx0 = CXa[i], cz0 = CZa[i], cy0 = CYa[i];
        var qx1 = cx0 * cyw + cz0 * syw, qz1 = -cx0 * syw + cz0 * cyw, qy2 = cy0 * cp - qz1 * sp, qz2 = cy0 * sp + qz1 * cp, qk = CAM / (CAM - qz2);
        CSX[i] = cx + qx1 * qk * S; CSY[i] = cy - (qy2 - YC) * qk * S;
        CFA[i] = -CNXa[i] * syw + CNZa[i] * cyw;
      }
      CBN.fill(0);
      for (var ti = 0; ti < TR.length; ti++) {
        var tr = TR[ti], n3 = tr.e - tr.s, prog = reduce ? 1 : clamp((T - 1.4 - tr.t0) / 1.1, 0, 1);
        var upto = Math.floor(prog * n3); if (upto < 2) continue;
        var cB = tr.cls === 2 ? 2 : (tr.bold ? 1 : 0);
        for (var m = 1; m < upto + (tr.closed && prog >= 1 ? 1 : 0); m++) {
          var p0 = tr.s + m - 1, p1 = tr.s + (m % n3);
          var fmin = Math.min(CFA[p0], CFA[p1]); if (fmin < 0.05) continue;
          var ab = fmin < 0.3 ? 0 : (fmin < 0.6 ? 1 : 2), bi = cB * 3 + ab, qc = CBN[bi]; CBN[bi] += 4;
          var cr = CB[bi]; cr[qc] = CSX[p0]; cr[qc + 1] = CSY[p0]; cr[qc + 2] = CSX[p1]; cr[qc + 3] = CSY[p1];
        }
      }
      ctx.lineWidth = 1.15 * dpr;
      for (j = 0; j < 9; j++) {
        var cn5 = CBN[j]; if (!cn5) continue;
        var cls2 = (j / 3) | 0, ab2 = j % 3, cr2 = CB[j];
        ctx.strokeStyle = 'rgba(' + C_COL[cls2] + ',' + Math.min(1, [0.3, 0.6, 0.95][ab2] * circA * gmul).toFixed(3) + ')';
        ctx.beginPath();
        for (k = 0; k < cn5; k += 4) { ctx.moveTo(cr2[k], cr2[k + 1]); ctx.lineTo(cr2[k + 2], cr2[k + 3]); }
        ctx.stroke();
      }
      // световые импульсы бегут по схемам
      for (var tj = 0; tj < TR.length; tj++) {
        var tq = TR[tj]; if (tq.closed || tq.total < 0.12 || T < 2.6) continue;
        var pos = ((clock * tq.sp + tq.ph) % 1) * tq.total, mi = 1, n4 = tq.e - tq.s;
        while (mi < n4 - 1 && tq.cum[mi] < pos) mi++;
        var pa = tq.s + mi - 1, pb = tq.s + mi;
        var ff = Math.min(CFA[pa], CFA[pb]); if (ff < 0.15) continue;
        var seg = tq.cum[mi] - tq.cum[mi - 1] || 1e-6, u2 = clamp((pos - tq.cum[mi - 1]) / seg, 0, 1);
        var dx = CSX[pa] + (CSX[pb] - CSX[pa]) * u2, dy2 = CSY[pa] + (CSY[pb] - CSY[pa]) * u2;
        var da = clamp(ff * 1.4, 0, 1) * circA;
        ctx.fillStyle = 'rgba(' + (tq.cls === 2 ? '255,190,130' : '120,240,255') + ',' + (0.28 * da).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(dx, dy2, 4.2 * dpr, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(245,255,255,' + (0.95 * da).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(dx, dy2, 1.5 * dpr, 0, TAU); ctx.fill();
      }
    }

    // --- блёстки на вершинах ---
    for (i = 0; i < SPK.length; i++) {
      var sk = SPK[i], v2 = sk.v;
      if (FA[v2] < 0.2 || VY[v2] < revealY) continue;
      var tw = 0.5 + 0.5 * Math.sin(clock * sk.sp + sk.ph); if (tw < 0.35) continue;
      ctx.fillStyle = 'rgba(' + (sk.c ? '170,140,255' : '190,245,255') + ',' + (0.85 * tw * clamp(FA[v2] * 1.5, 0, 1)).toFixed(3) + ')';
      var rs = 1.3 * dpr * (0.8 + tw * 0.6);
      ctx.fillRect(SX[v2] - rs / 2, SY[v2] - rs / 2, rs, rs);
    }

    // --- светящиеся белые глаза: свет повторяет форму разреза и идёт как будто изнутри ---
    var eapp = clamp((T - 2.4) / 1.0, 0, 1);
    if (eapp > 0) {
      for (var ei = 0; ei < EYES.length && ei < EYE_LOOPS.length; ei++) {
        var E = EYES[ei], LP = EYE_LOOPS[ei];
        var fe = clamp((-(E[0] > 0 ? 0.35 : -0.35) * syw + cyw) / 1.06, 0, 1);
        if (fe < 0.03) continue;
        var eal = eapp * Math.pow(fe, 1.3) * clamp(0.72 + 0.28 * glow + 0.06 * Math.sin(clock * 2.3 + ei * 1.7), 0, 1);
        var npt = LP.length / 3, exs = [], eys = [], minY = 1e9, maxY = -1e9, q2;
        for (q2 = 0; q2 < npt; q2++) {
          var gx = LP[q2 * 3], gy = LP[q2 * 3 + 1], gz = LP[q2 * 3 + 2];
          var gx1 = gx * cyw + gz * syw, gz1 = -gx * syw + gz * cyw, gy2 = gy * cp - gz1 * sp, gz2 = gy * sp + gz1 * cp, gk = CAM / (CAM - gz2);
          var sx2 = cx + gx1 * gk * S, sy2 = cy - (gy2 - YC) * gk * S;
          exs.push(sx2); eys.push(sy2);
          if (sy2 < minY) minY = sy2; if (sy2 > maxY) maxY = sy2;
        }
        var ecy = (minY + maxY) / 2, eh = Math.max(maxY - minY, dpr * 2);
        ctx.beginPath();
        for (q2 = 0; q2 < npt; q2++) { if (q2) ctx.lineTo(exs[q2], eys[q2]); else ctx.moveTo(exs[q2], eys[q2]); }
        ctx.closePath();
        var eg = ctx.createLinearGradient(0, ecy - eh / 2, 0, ecy + eh / 2);
        eg.addColorStop(0, 'rgba(120,215,255,' + (0.7 * eal).toFixed(3) + ')');
        eg.addColorStop(0.5, 'rgba(255,255,255,' + (1.0 * eal).toFixed(3) + ')');
        eg.addColorStop(1, 'rgba(120,215,255,' + (0.7 * eal).toFixed(3) + ')');
        ctx.shadowColor = 'rgba(80,200,255,' + (0.95 * eal).toFixed(3) + ')'; ctx.shadowBlur = 22 * dpr;
        ctx.fillStyle = eg; ctx.fill(); ctx.fill();
        ctx.shadowBlur = 0; ctx.lineJoin = 'round';
        ctx.lineWidth = 1.4 * dpr; ctx.strokeStyle = 'rgba(210,248,255,' + (0.7 * eal).toFixed(3) + ')'; ctx.stroke();
      }
    }

    // луч-сканер при появлении
    if (T < 3.0) {
      var by0 = cy - (revealY - YC) * S, ba = Math.sin(clamp(T / 3.0, 0, 1) * Math.PI);
      var lg = ctx.createLinearGradient(cx - S, 0, cx + S, 0);
      lg.addColorStop(0, 'rgba(80,230,255,0)'); lg.addColorStop(0.5, 'rgba(150,245,255,' + (0.9 * ba).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(80,230,255,0)');
      ctx.fillStyle = lg; ctx.fillRect(cx - S, by0 - dpr, S * 2, 2 * dpr);
    }

    ctx.globalCompositeOperation = 'source-over';
    if (clock - introStart < 8) {                         // метка версии (первые секунды) — чтобы видеть, что загрузился новый файл; можно удалить
      ctx.font = (11 * dpr) + 'px sans-serif'; ctx.fillStyle = 'rgba(160,200,255,0.55)';
      ctx.fillText('head3d v18', 8 * dpr, H2 - 8 * dpr);
    }
    start();
  }

  function start() { if (!raf && visible && !document.hidden && W > 0) raf = requestAnimationFrame(frame); }

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
