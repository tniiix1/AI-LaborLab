/* head3d/head3d.js — 3D-голова «AI Labor Assistant»
   Подключается к canvas#headCanvas на главной странице. Без внешних библиотек.

   • реальная 3D-модель головы (headdata.js, из free_head.obj): контурные срезы + облако точек + редкая сетка, светящиеся нос и глаза
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

  /* ---------- модель головы (headdata.js) ---------- */
  var D = window.HEAD3D_DATA;
  if (!D) { if (window.console) console.warn('head3d: не найден head3d/headdata.js'); return; }
  function b64(str) { var bin = atob(str), n = bin.length, u = new Uint8Array(n); for (var q = 0; q < n; q++) u[q] = bin.charCodeAt(q); return u.buffer; }
  var vi = new Int16Array(b64(D.v)), fi = new Uint16Array(b64(D.f));
  var NV = D.nv, NF = D.nf, EYE_N = D.eyeN;
  var VX = new Float32Array(NV), VY = new Float32Array(NV), VZ = new Float32Array(NV);
  var i, j, e, k;
  for (i = 0; i < NV; i++) { VX[i] = vi[i * 3] / D.q; VY[i] = vi[i * 3 + 1] / D.q; VZ[i] = vi[i * 3 + 2] / D.q; }
  var Y_TOP = D.top, Y_CHIN = D.chin, YC = 0;

  function inMouth(x, y, z) { return Math.abs(x) < 0.46 && y > -1.15 && y < -0.45 && z > -0.3 && z < 0.76; }   // полость рта, дно рта, низ челюсти

  // треугольники: нормаль (наружу), площадь, диапазон z
  var TNX = new Float32Array(NF), TNY = new Float32Array(NF), TNZ = new Float32Array(NF), TAR = new Float32Array(NF);
  var TZ0 = new Float32Array(NF), TZ1 = new Float32Array(NF), TY0 = new Float32Array(NF), TY1 = new Float32Array(NF), TEYE = new Uint8Array(NF);
  var bodyTris = [], eyeTris = [], bodyCum = [], eyeCum = [], bodyArea = 0, eyeArea = 0;
  var nose = { x: 0, y: 0, z: -9 };
  for (i = NV - 1; i >= EYE_N; i--) if (VZ[i] > nose.z) { nose.x = VX[i]; nose.y = VY[i]; nose.z = VZ[i]; }
  for (i = 0; i < NF; i++) {
    var A = fi[i * 3], B = fi[i * 3 + 1], C = fi[i * 3 + 2];
    var ux = VX[B] - VX[A], uy = VY[B] - VY[A], uz = VZ[B] - VZ[A], wx = VX[C] - VX[A], wy = VY[C] - VY[A], wz = VZ[C] - VZ[A];
    var cxn = uy * wz - uz * wy, cyn = uz * wx - ux * wz, czn = ux * wy - uy * wx, ln = Math.sqrt(cxn * cxn + cyn * cyn + czn * czn) || 1;
    var mx = (VX[A] + VX[B] + VX[C]) / 3, my = (VY[A] + VY[B] + VY[C]) / 3, mz = (VZ[A] + VZ[B] + VZ[C]) / 3;
    var sg = (cxn * mx + czn * mz) >= 0 ? 1 : -1;                     // наружу от оси головы
    TNX[i] = sg * cxn / ln; TNY[i] = sg * cyn / ln; TNZ[i] = sg * czn / ln; TAR[i] = ln / 2;
    TZ0[i] = Math.min(VZ[A], VZ[B], VZ[C]); TZ1[i] = Math.max(VZ[A], VZ[B], VZ[C]);
    TY0[i] = Math.min(VY[A], VY[B], VY[C]); TY1[i] = Math.max(VY[A], VY[B], VY[C]);
    if (A >= EYE_N && inMouth(mx, my, mz)) { TEYE[i] = 2; continue; }       // внутренность рта и низ челюсти — не рисуем
    if (A < EYE_N && B < EYE_N && C < EYE_N) { TEYE[i] = 1; eyeArea += TAR[i]; eyeTris.push(i); eyeCum.push(eyeArea); }
    else { bodyArea += TAR[i]; bodyTris.push(i); bodyCum.push(bodyArea); }
  }
  function pick(list, cum, total) {                                   // треугольник по площади
    var r0 = rand() * total, lo = 0, hi = cum.length - 1;
    while (lo < hi) { var md = (lo + hi) >> 1; if (cum[md] < r0) lo = md + 1; else hi = md; }
    return list[lo];
  }
  function sampleTri(ti, out) {
    var u = rand(), v = rand(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    var A = fi[ti * 3], B = fi[ti * 3 + 1], C = fi[ti * 3 + 2], w = 1 - u - v;
    out.x = VX[A] * w + VX[B] * u + VX[C] * v; out.y = VY[A] * w + VY[B] * u + VY[C] * v; out.z = VZ[A] * w + VZ[B] * u + VZ[C] * v;
  }

  /* ---------- облако точек ---------- */
  var P = { x: [], y: [], z: [], nx: [], nz: [], c: [] };
  function neckKeep(y) { if (y >= Y_CHIN + 0.02) return 1; var q = clamp(1 - (Y_CHIN + 0.02 - y) / 0.09, 0, 1); return q * q; }
  function add(x, y, z, nx, nz, ny, c) {
    if (inMouth(x, y, z)) return;
    if (rand() > neckKeep(y)) return;
    var dxn = x - nose.x, dyn = y - nose.y, dzn = z - nose.z;
    if (z > 0 && dxn * dxn + dyn * dyn + dzn * dzn < 0.1 && (c === 0 || rand() < 0.5)) c = 1;     // светящийся нос
    P.x.push(x); P.y.push(y); P.z.push(z); P.nx.push(nx); P.nz.push(nz); P.c.push(c);
  }
  function cls(r) { return r < 0.76 ? 0 : (r < 0.9 ? 1 : 2); }
  var tmp = { x: 0, y: 0, z: 0 };

  // контурные линии: срезы по глубине (спереди — вложенные контуры, как на топографической карте)
  function slice(axis, level, spacing, c0) {
    for (var ti = 0; ti < NF; ti++) {
      if (TEYE[ti]) continue;
      var lo = axis === 2 ? TZ0[ti] : TY0[ti], hi = axis === 2 ? TZ1[ti] : TY1[ti];
      if (level < lo || level >= hi) continue;
      var vs = [fi[ti * 3], fi[ti * 3 + 1], fi[ti * 3 + 2]], pts = [];
      for (var q = 0; q < 3; q++) {
        var p1 = vs[q], p2 = vs[(q + 1) % 3];
        var a1 = axis === 2 ? VZ[p1] : VY[p1], a2 = axis === 2 ? VZ[p2] : VY[p2];
        if ((a1 - level) * (a2 - level) < 0) {
          var f = (level - a1) / (a2 - a1);
          pts.push([VX[p1] + (VX[p2] - VX[p1]) * f, VY[p1] + (VY[p2] - VY[p1]) * f, VZ[p1] + (VZ[p2] - VZ[p1]) * f]);
        }
      }
      if (pts.length < 2) continue;
      var dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1], dz = pts[1][2] - pts[0][2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var cnt = Math.floor(L / spacing + rand());
      for (var n = 0; n < cnt; n++) {
        var tt = rand();
        add(pts[0][0] + dx * tt, pts[0][1] + dy * tt, pts[0][2] + dz * tt, TNX[ti], TNZ[ti], TNY[ti], c0 < 0 ? cls(rand()) : c0);
      }
    }
  }
  var zMin = 9, zMax = -9;
  for (i = EYE_N; i < NV; i++) { if (VZ[i] < zMin) zMin = VZ[i]; if (VZ[i] > zMax) zMax = VZ[i]; }
  for (var zl = zMin + 0.01; zl < zMax; zl += 0.03) slice(2, zl, 0.03, -1);
  for (var yl = -1.55; yl < Y_TOP; yl += 0.15) slice(1, yl, 0.034, 0);

  // мелкая «пыль» по всей поверхности
  for (i = 0; i < 3200; i++) { var ti2 = pick(bodyTris, bodyCum, bodyArea); sampleTri(ti2, tmp); add(tmp.x, tmp.y, tmp.z, TNX[ti2], TNZ[ti2], TNY[ti2], cls(rand())); }
  // плотнее вокруг носа
  for (i = 0, k = 0; i < 4000 && k < 520; i++) {
    var ti3 = pick(bodyTris, bodyCum, bodyArea); sampleTri(ti3, tmp);
    var ddx = tmp.x - nose.x, ddy = tmp.y - nose.y, ddz = tmp.z - nose.z;
    if (ddx * ddx + ddy * ddy + ddz * ddz < 0.07) { add(tmp.x, tmp.y, tmp.z, TNX[ti3], TNZ[ti3], TNY[ti3], 1); k++; }
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
  function node(x, y, z, c, anchor) { nodes.push({ x: x, y: y, z: z, c: c, an: !!anchor }); }
  for (i = 0, k = 0; k < 280 && i < 20000; i++) {
    var ti5 = pick(bodyTris, bodyCum, bodyArea); sampleTri(ti5, tmp);
    if (inMouth(tmp.x, tmp.y, tmp.z) || tmp.y < Y_CHIN + 0.04 ||  (k < 150 && tmp.z < 0)) continue;
    node(tmp.x, tmp.y, tmp.z, rand() < 0.3 ? 1 : 2, false); k++;
  }
  node(nose.x, nose.y, nose.z, 1, true);
  var NN = nodes.length, ea = [], eb = [], ec = [], seen = {};
  for (i = 0; i < NN; i++) {
    var near = [];
    for (j = 0; j < NN; j++) {
      if (j === i) continue;
      var dx2 = nodes[i].x - nodes[j].x, dy2 = nodes[i].y - nodes[j].y, dz2 = nodes[i].z - nodes[j].z;
      var dd = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
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
      var v = 0.36 + 0.34 * rim + (nzv < 0 ? -0.17 : 0.05) + glow * 0.4;
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
