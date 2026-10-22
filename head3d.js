/* head3d.js — детализированная интерактивная 3D-голова из нейросети.
   Плотная сетка лица, «печатная плата» в области мозга, светящиеся глаза,
   нейронные импульсы. Чистый canvas 2D, без внешних библиотек.
   Управление: потяните — поворот; наведите курсор на узел — подсветка;
   нажмите на узел — по сети пробежит импульс. */
(function () {
  'use strict';

  var canvas = document.getElementById('headCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var hint = document.getElementById('headHint');
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ==== GEN START ====
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth01(t) { return t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)); }

  function makeSpline(ys, vs) {
    var n = ys.length, m = [], i;
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      m[i] = (vs[b] - vs[a]) / (ys[b] - ys[a]);
    }
    return function (y) {
      if (y <= ys[0]) return vs[0];
      if (y >= ys[n - 1]) return vs[n - 1];
      var k = 0;
      while (y > ys[k + 1]) k++;
      var h = ys[k + 1] - ys[k], t = (y - ys[k]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * vs[k] + (t3 - 2 * t2 + t) * h * m[k] +
             (-2 * t3 + 3 * t2) * vs[k + 1] + (t3 - t2) * h * m[k + 1];
    };
  }

  // Профиль головы (лицо смотрит в +x), y — от подбородка до макушки
  var PY = [-1.15, -1.05, -0.95, -0.80, -0.66, -0.52, -0.40, -0.25, -0.05, 0.15, 0.30, 0.42, 0.55, 0.70, 0.85, 1.00, 1.10];
  var PF = [ 0.15,  0.30,  0.56,  0.70,  0.62,  0.67,  0.71,  0.68,  0.70, 0.70, 0.68, 0.75, 0.73, 0.68, 0.55, 0.30, 0.05];
  var PB = [ 0.10, -0.08, -0.18, -0.38, -0.52, -0.64, -0.73, -0.86, -0.95,-1.00,-1.02,-1.03,-1.01,-0.95,-0.78,-0.43,-0.05];
  var PW = [ 0.08,  0.16,  0.24,  0.36,  0.46,  0.54,  0.60,  0.66,  0.70, 0.72, 0.72, 0.72, 0.71, 0.66, 0.55, 0.36, 0.08];
  var fF = makeSpline(PY, PF), fB = makeSpline(PY, PB), fW = makeSpline(PY, PW);
  var fNose = makeSpline(
    [-0.42, -0.34, -0.27, -0.20, -0.10, 0.02, 0.16, 0.30, 0.45],
    [ 0.00,  0.11,  0.28,  0.33,  0.27, 0.17, 0.08, 0.02, 0.00]);

  function sgnPow(v, p) { return (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), p); }

  function headPoint(y, phi) {
    var c = Math.cos(phi), s = Math.sin(phi);
    var xF = fF(y), xB = fB(y), w = fW(y);
    var cx = (xF + xB) / 2, rx = (xF - xB) / 2;
    var cc = sgnPow(c, 0.82), ss = sgnPow(s, 0.82);
    var x = cx + rx * cc, z = w * ss;
    var front = Math.max(0, c);
    var nz = 0.07 + 0.09 * clamp((0.05 - y) / 0.35, 0, 1);
    x += fNose(y) * Math.exp(-(z * z) / (nz * nz)) * front;                                  // нос
    x += 0.06 * Math.exp(-Math.pow((y - 0.42) / 0.07, 2)) * front;                           // брови
    x -= 0.07 * Math.exp(-Math.pow((y - 0.28) / 0.07, 2)) * Math.exp(-Math.pow((Math.abs(z) - 0.30) / 0.12, 2)) * front; // глазницы
    x += 0.05 * Math.exp(-Math.pow((y + 0.45) / 0.06, 2)) * Math.exp(-Math.pow(z / 0.20, 2)) * front; // губы
    x += 0.035 * Math.exp(-Math.pow((y + 0.80) / 0.09, 2)) * Math.exp(-Math.pow(z / 0.16, 2)) * front; // подбородок
    var ear = Math.exp(-Math.pow((y + 0.08) / 0.16, 2)) * Math.exp(-Math.pow((x + 0.12) / 0.14, 2));
    z += (z < 0 ? -1 : 1) * 0.10 * ear * clamp((Math.abs(ss) - 0.55) / 0.25, 0, 1);         // уши
    return [x, y, z];
  }
  function neckPoint(y, phi) {
    var grow = 1 + 0.28 * clamp((-0.9 - y) / 0.8, 0, 1);
    return [-0.30 + 0.42 * grow * Math.cos(phi), y, 0.38 * grow * Math.sin(phi)];
  }
  function insideHead(p, k) {
    var y = p[1];
    if (y < -1.15 || y > 1.1) return false;
    var xF = fF(y), xB = fB(y), w = fW(y), cx = (xF + xB) / 2, rx = (xF - xB) / 2;
    var a = (p[0] - cx) / (rx * k), b = p[2] / (w * k);
    return a * a + b * b < 1;
  }
  // z поверхности головы в точке (x, y) на боковой стороне; NaN — если мимо черепа
  function surfZ(x, y) {
    if (y < -1.1 || y > 1.08) return NaN;
    var xF = fF(y), xB = fB(y), w = fW(y), cx = (xF + xB) / 2, rx = (xF - xB) / 2;
    var u = Math.abs((x - cx) / rx);
    if (u >= 0.985) return NaN;
    var c = Math.pow(u, 1 / 0.82), s = Math.sqrt(1 - c * c);
    return w * Math.pow(s, 0.82);
  }
  function normalAt(x, y, z, neck) {
    var nx, nz, ny = 0;
    if (neck) { nx = (x + 0.30) / 0.2; nz = z / 0.16; }
    else {
      var xF = fF(y), xB = fB(y), w = fW(y), cx = (xF + xB) / 2, rx = (xF - xB) / 2;
      nx = (x - cx) / (rx * rx); nz = z / (w * w);
      if (y > 0.8) ny = clamp((y - 0.8) / 0.3, 0, 1) * 1.3;
      else if (y < -0.95) ny = -clamp((-0.95 - y) / 0.2, 0, 1) * 1.3;
    }
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  // KIND: 0 обычный, 1 акцентный (фиолетовый), 2 глаз, 3 ядро, 4 «полое» окончание линии, 5 частица
  // GRP:  0 лицо (бледный), 1 мозг/шея (синий), 2 схемы (циан)
  function buildHead() {
    var rng = mulberry32(90517);
    var P = [], NR = [], GRP = [], KIND = [], SIZE = [], RAD = [];
    var grid = {}, CS = 0.1, i, j, tries;

    function gk(ix, iy, iz) { return (ix + 40) * 10000 + (iy + 40) * 100 + (iz + 40); }
    function addNode(p, nrm, grp, kind, size, rad) {
      var id = P.length;
      P.push(p); NR.push(nrm || [0, 0, 0]); GRP.push(grp); KIND.push(kind); SIZE.push(size); RAD.push(rad || 0);
      var key = gk(Math.floor(p[0] / CS), Math.floor(p[1] / CS), Math.floor(p[2] / CS));
      (grid[key] || (grid[key] = [])).push(id);
      return id;
    }
    function farEnough(p, r) {
      var cx = Math.floor(p[0] / CS), cy = Math.floor(p[1] / CS), cz = Math.floor(p[2] / CS);
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var c = -1; c <= 1; c++) {
        var cell = grid[gk(cx + a, cy + b, cz + c)];
        if (!cell) continue;
        for (var k = 0; k < cell.length; k++) {
          var q = P[cell[k]], dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
          var m = (r + RAD[cell[k]]) / 2;
          if (dx * dx + dy * dy + dz * dz < m * m) return false;
        }
      }
      return true;
    }

    // --- череп и лицо: неравномерная плотность (лицо мельче) ---
    for (tries = 0; tries < 36000; tries++) {
      var y = -1.15 + rng() * 2.25, p = headPoint(y, rng() * Math.PI * 2);
      if (Math.sqrt((p[0] + 0.30) * (p[0] + 0.30) + (p[1] - 0.30) * (p[1] - 0.30)) < 0.47 && Math.abs(p[2]) > 0.28) continue; // зона «схем»
      var r = 0.078 - 0.026 * smooth01(p[0] / 0.4);
      if (farEnough(p, r)) addNode(p, normalAt(p[0], p[1], p[2], false), p[0] < 0.12 ? 1 : 0, 0, 0.8 + rng() * 0.9 + (rng() > 0.93 ? 0.9 : 0), r);
    }
    // --- шея ---
    for (tries = 0; tries < 5500; tries++) {
      var q = neckPoint(-1.75 + rng() * 1.25, rng() * Math.PI * 2);
      if (insideHead(q, 1.02)) continue;
      if (farEnough(q, 0.095)) addNode(q, normalAt(q[0], q[1], q[2], true), 1, 0, 0.8 + rng() * 0.8, 0.095);
    }
    var meshCount = P.length;

    // --- связи сетки ---
    var edges = [], eg = [], seen = {};
    function addEdge(a, b, g) {
      if (a === b) return;
      var lo = Math.min(a, b), hi = Math.max(a, b), key = lo * 20000 + hi;
      if (seen[key]) return;
      seen[key] = 1; edges.push(lo, hi); eg.push(g);
    }
    for (i = 0; i < meshCount; i++) {
      var p0 = P[i], cx0 = Math.floor(p0[0] / CS), cy0 = Math.floor(p0[1] / CS), cz0 = Math.floor(p0[2] / CS), cand = [];
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var c = -1; c <= 1; c++) {
        var cell = grid[gk(cx0 + a, cy0 + b, cz0 + c)];
        if (!cell) continue;
        for (var k = 0; k < cell.length; k++) {
          j = cell[k];
          if (j === i || j >= meshCount) continue;
          var dx = p0[0] - P[j][0], dy = p0[1] - P[j][1], dz = p0[2] - P[j][2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < (RAD[i] + RAD[j]) * 1.02) cand.push([d, j]);
        }
      }
      cand.sort(function (u, v) { return u[0] - v[0]; });
      for (k = 0; k < Math.min(5, cand.length); k++) addEdge(i, cand[k][1], (GRP[i] === 0 && GRP[cand[k][1]] === 0) ? 0 : 1);
    }

    // --- глаза ---
    var eyes = [];
    for (var s = -1; s <= 1; s += 2) {
      var phi = 0.05, ep;
      do { ep = headPoint(0.27, phi); phi += 0.01; } while (Math.abs(ep[2]) < 0.30 && phi < 1.4);
      var ez = s * Math.abs(ep[2]);
      eyes.push(addNode([ep[0] + 0.012, 0.27, ez], normalAt(ep[0], 0.27, ez, false), 0, 2, 3.6, 0.04));
    }

    // --- «печатная плата» на висках: концентрические кольца, лучи, ядро ---
    var CX = -0.30, CY = 0.30, RINGS = [0.05, 0.10, 0.16, 0.23, 0.31, 0.40];
    var cores = [], brain = [], outerRingNodes = [];
    for (s = -1; s <= 1; s += 2) {
      var ringNodes = [];
      var zc = surfZ(CX, CY);
      var core = addNode([CX, CY, s * (zc * 1.02 + 0.01)], normalAt(CX, CY, s * zc, false), 2, 3, 4, 0.02);
      cores.push(core); brain.push(core);
      for (var rI = 0; rI < RINGS.length; rI++) {
        var rho = RINGS[rI], n = Math.max(10, Math.round(2 * Math.PI * rho / 0.042)), ids = [];
        for (j = 0; j < n; j++) {
          var th = j / n * 2 * Math.PI, px = CX + rho * Math.cos(th), py = CY + rho * Math.sin(th), zs = surfZ(px, py);
          if (isNaN(zs)) { ids.push(-1); continue; }
          var zz = s * (zs * 1.02 + 0.008);
          ids.push(addNode([px, py, zz], normalAt(px, py, zz, false), 2, 0, 0.7 + rng() * 0.5, 0.02));
        }
        for (j = 0; j < n; j++) {
          var a1 = ids[j], b1 = ids[(j + 1) % n];
          if (a1 >= 0 && b1 >= 0) addEdge(a1, b1, 2);
        }
        ringNodes.push({ ids: ids, n: n });
        if (rI === 0) for (j = 0; j < n; j += 2) if (ids[j] >= 0) addEdge(core, ids[j], 2);
        if (rI === RINGS.length - 1) for (j = 0; j < n; j++) if (ids[j] >= 0) outerRingNodes.push(ids[j]);
      }
      // радиальные лучи между кольцами
      for (var m = 0; m < 24; m++) {
        var ang = m / 24;
        for (rI = 0; rI < RINGS.length - 1; rI++) {
          var A = ringNodes[rI], B = ringNodes[rI + 1];
          var ia = A.ids[Math.round(ang * A.n) % A.n], ib = B.ids[Math.round(ang * B.n) % B.n];
          if (ia >= 0 && ib >= 0) addEdge(ia, ib, 2);
        }
      }
      for (rI = 0; rI < ringNodes.length; rI++) for (j = 0; j < ringNodes[rI].ids.length; j++) if (ringNodes[rI].ids[j] >= 0 && j % 3 === 0) brain.push(ringNodes[rI].ids[j]);

      // --- дорожки схемы: уходят от внешнего кольца назад и в стороны ---
      for (var tr = 0; tr < 15; tr++) {
        var th0 = (80 + rng() * 200) * Math.PI / 180;               // не вперёд, к лицу
        var x0 = CX + 0.40 * Math.cos(th0), y0 = CY + 0.40 * Math.sin(th0);
        var zs0 = surfZ(x0, y0);
        if (isNaN(zs0)) continue;
        var head = Math.round(th0 / (Math.PI / 4)) * (Math.PI / 4), baseHead = head;
        var cx1 = x0, cy1 = y0, cz1 = s * (zs0 * 1.02 + 0.008), prev = -1, steps = 4 + Math.floor(rng() * 5), out = 0;
        // начальная точка — ближайший узел внешнего кольца
        var best = -1, bd = 1e9;
        for (j = 0; j < outerRingNodes.length; j++) {
          var q0 = P[outerRingNodes[j]], dd = (q0[0] - x0) * (q0[0] - x0) + (q0[1] - y0) * (q0[1] - y0) + (q0[2] * s < 0 ? 9 : 0);
          if (dd < bd) { bd = dd; best = outerRingNodes[j]; }
        }
        prev = best;
        for (var st = 0; st < steps; st++) {
          if (rng() < 0.45) head = clamp(head + (rng() < 0.5 ? -1 : 1) * Math.PI / 4, baseHead - Math.PI / 2, baseHead + Math.PI / 2);
          var L = 0.06 + rng() * 0.12;
          var nx = cx1 + L * Math.cos(head), ny = cy1 + L * Math.sin(head);
          if (nx > 0.0) nx = cx1;                                     // не заходим на лицо
          var zsn = surfZ(nx, ny), nzv, nrm;
          if (!isNaN(zsn) && out === 0) { nzv = s * (zsn * 1.02 + 0.008); nrm = normalAt(nx, ny, nzv, false); }
          else { out++; nzv = cz1 + s * (0.035 + rng() * 0.05); nrm = null; }
          var isEnd = st === steps - 1;
          var id = addNode([nx, ny, nzv], nrm, 2, isEnd && rng() < 0.65 ? 4 : 0, isEnd ? 3.4 : 0.9, 0.02);
          addEdge(prev, id, 2); prev = id; cx1 = nx; cy1 = ny; cz1 = nzv;
          if (!isEnd && rng() < 0.3) {                                // короткое ответвление
            var bx = nx + 0.07 * Math.cos(head + Math.PI / 4), by = ny + 0.07 * Math.sin(head + Math.PI / 4);
            var bid = addNode([bx, by, nzv + s * 0.02], null, 2, 0, 1.5, 0.02);
            addEdge(id, bid, 2);
          }
        }
      }
    }
    // связь внешнего кольца с сеткой черепа (чтобы импульсы перетекали в «схему»)
    for (i = 0; i < outerRingNodes.length; i += 3) {
      var o = P[outerRingNodes[i]], nb = -1, nd = 0.13 * 0.13;
      for (j = 0; j < meshCount; j++) {
        var dx2 = o[0] - P[j][0], dy2 = o[1] - P[j][1], dz2 = o[2] - P[j][2], d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
        if (d2 < nd) { nd = d2; nb = j; }
      }
      if (nb >= 0) addEdge(outerRingNodes[i], nb, 1);
    }

    // --- частицы вокруг затылка + редкие связи ---
    var pStart = P.length;
    for (tries = 0; tries < 700 && P.length - pStart < 150; tries++) {
      var pp = [-0.7 - rng() * 1.3, -0.9 + rng() * 2.4, (rng() - 0.5) * 2.0];
      if (insideHead(pp, 1.12)) continue;
      addNode(pp, null, 2, 5, 0.6 + rng() * 1.1, 0.02);
    }
    for (i = pStart; i < P.length; i++) {
      var bj = -1, bdd = 0.34 * 0.34;
      for (j = pStart; j < P.length; j++) {
        if (j === i) continue;
        var ddx = P[i][0] - P[j][0], ddy = P[i][1] - P[j][1], ddz = P[i][2] - P[j][2], dd2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (dd2 < bdd && rng() < 0.5) { bdd = dd2; bj = j; }
      }
      if (bj >= 0) addEdge(i, bj, 3);
    }

    // --- упаковка ---
    var N = P.length, Pf = new Float32Array(N * 3), Nf = new Float32Array(N * 3), adj = [];
    for (i = 0; i < N; i++) {
      Pf[i * 3] = P[i][0]; Pf[i * 3 + 1] = P[i][1]; Pf[i * 3 + 2] = P[i][2];
      Nf[i * 3] = NR[i][0]; Nf[i * 3 + 1] = NR[i][1]; Nf[i * 3 + 2] = NR[i][2];
      adj.push([]);
    }
    var E = new Int32Array(edges), EG = new Uint8Array(eg);
    for (i = 0; i < E.length; i += 2) { adj[E[i]].push(E[i + 1]); adj[E[i + 1]].push(E[i]); }
    var phase = new Float32Array(N), size = new Float32Array(N), kind = new Uint8Array(N), grp = new Uint8Array(N);
    for (i = 0; i < N; i++) { phase[i] = rng() * 6.283; size[i] = SIZE[i]; kind[i] = KIND[i]; grp[i] = GRP[i]; }
    for (i = 0; i < meshCount; i++) if (P[i][1] > 0.15 && P[i][0] < 0.2 && i % 2 === 0) brain.push(i);
    return { N: N, meshCount: meshCount, P: Pf, NRM: Nf, E: E, EG: EG, adj: adj, brain: brain, cores: cores, eyes: eyes, kind: kind, grp: grp, size: size, phase: phase };
  }
  // ==== GEN END ====

  canvas.style.opacity = '0';
  canvas.style.transition = 'opacity .9s ease';

  function init() {
  var G = buildHead();
  var N = G.N, P = G.P, NRM = G.NRM, E = G.E, EG = G.EG, adj = G.adj, EC = E.length / 2;
  var KIND = G.kind, GRP = G.grp, SIZE = G.size, PHASE = G.phase;

  // ---------- состояние ----------
  var DPR = 1, W = 0, H = 0, scale = 1;
  var yaw = Math.PI + 0.55, pitch = 0.08, pitchBase = 0.08;
  var yawVel = reduceMotion ? 0 : 0.22, AUTO = reduceMotion ? 0 : 0.22;
  var dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0, lastMoveT = 0, lastInteract = -9999;
  var mouseIn = false, mx = 0, my = 0, hoverIdx = -1, hoverTilt = 0;
  var SX = new Float32Array(N), SY = new Float32Array(N), SZ = new Float32Array(N), SK = new Float32Array(N), FZ = new Float32Array(N);
  var act = new Float32Array(N), waves = [], rings = [], nextAuto = 0.6;
  var visible = true;

  function makeSprite(r, g, b) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0.95)');
    gr.addColorStop(0.25, 'rgba(' + r + ',' + g + ',' + b + ',0.35)');
    gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return c;
  }
  var SPR = [makeSprite(110, 185, 255), makeSprite(185, 140, 255), makeSprite(255, 150, 230), makeSprite(80, 190, 255)];

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) { W = H = 0; return; }
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    scale = Math.min(H / 3.05, W / 2.75);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  resize();
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; resize(); }).observe(canvas);
  }

  // ---------- импульсы по сети ----------
  function trigger(src, strength) {
    var hop = new Int16Array(N), q = [src], qi, k;
    for (k = 0; k < N; k++) hop[k] = -1;
    hop[src] = 0;
    for (qi = 0; qi < q.length; qi++) {
      var u = q[qi], a = adj[u];
      for (k = 0; k < a.length; k++) if (hop[a[k]] < 0) { hop[a[k]] = hop[u] + 1; q.push(a[k]); }
    }
    waves.push({ hop: hop, t: 0, prev: -1, max: hop[q[q.length - 1]], str: strength || 1 });
  }
  function nearestNode(px, py, maxD) {
    var best = -1, bd = maxD * maxD;
    for (var i = 0; i < N; i++) {
      if (KIND[i] === 5 || FZ[i] < -0.15) continue;
      var dx = SX[i] - px, dy = SY[i] - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---------- ввод ----------
  function localPos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    var p = localPos(e);
    lastX = downX = p[0]; lastY = downY = p[1];
    downT = lastMoveT = performance.now(); lastInteract = downT;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    canvas.classList.add('dragging');
    if (hint) hint.classList.add('hide');
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = localPos(e), now = performance.now();
    mx = p[0]; my = p[1];
    if (dragging) {
      var dx = p[0] - lastX, dy = p[1] - lastY, dt = Math.max(0.008, (now - lastMoveT) / 1000);
      var dYaw = dx * 0.011;
      yaw += dYaw;
      yawVel = clamp(0.6 * yawVel + 0.4 * (dYaw / dt), -6, 6);
      pitch = clamp(pitch + dy * 0.006, -0.55, 0.55);
      lastX = p[0]; lastY = p[1]; lastMoveT = now; lastInteract = now;
    } else if (e.pointerType === 'mouse') {
      mouseIn = true;
      hoverTilt = (p[1] / (H || 1) - 0.5) * 0.22;
    }
  });
  function endDrag(e, cancelled) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    var now = performance.now();
    lastInteract = now;
    if (now - lastMoveT > 90) yawVel = 0;
    if (!cancelled) {
      var p = localPos(e);
      if (Math.hypot(p[0] - downX, p[1] - downY) < 6 && now - downT < 450) {
        var idx = nearestNode(p[0], p[1], 34);
        if (idx < 0) idx = G.brain[(Math.random() * G.brain.length) | 0];
        trigger(idx, 1);
        rings.push({ i: idx, t: 0 });
      }
    }
  }
  canvas.addEventListener('pointerup', function (e) { endDrag(e, false); });
  canvas.addEventListener('pointercancel', function (e) { endDrag(e, true); });
  canvas.addEventListener('pointerleave', function () { mouseIn = false; hoverIdx = -1; hoverTilt = 0; });
  canvas.setAttribute('tabindex', '0');
  canvas.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { yaw -= 0.18; lastInteract = performance.now(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { yaw += 0.18; lastInteract = performance.now(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { trigger(G.brain[(Math.random() * G.brain.length) | 0], 1); e.preventDefault(); }
  });

  // ---------- рисование ----------
  // 3 группы линий × 4 уровня «лицевой» яркости
  var BK = [], bi;
  for (bi = 0; bi < 16; bi++) BK.push([]);
  var LINE_RGB = ['205,222,255', '90,150,255', '120,225,255', '150,170,255'];
  var LINE_A = [0.30, 0.30, 0.55, 0.16];
  var NODE_RGB = ['228,238,252', '125,185,255', '150,230,255', '185,175,255'];

  function project() {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cxs = W / 2, cys = H / 2, YC = -0.30, D = 6;
    for (var i = 0; i < N; i++) {
      var x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      var k = D / (D - z2);
      SX[i] = cxs + x1 * k * scale;
      SY[i] = cys - (y2 - YC) * k * scale;
      SZ[i] = z2; SK[i] = k;
      var nx = NRM[i * 3], ny = NRM[i * 3 + 1], nz = NRM[i * 3 + 2];
      if (nx === 0 && ny === 0 && nz === 0) FZ[i] = 1;
      else { var n1z = -nx * sy + nz * cy; FZ[i] = ny * sp + n1z * cp; }
    }
  }
  function neckFade(i) {
    var y = P[i * 3 + 1];
    return y < -1.0 ? clamp(1 - (-1.0 - y) / 0.75, 0, 1) : 1;
  }
  function vis(f) { return clamp((f + 0.2) / 0.85, 0, 1); }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.5, H * 0.40, 0, W * 0.5, H * 0.40, Math.max(W, H) * 0.6);
    g.addColorStop(0, 'rgba(70,110,255,0.20)');
    g.addColorStop(1, 'rgba(70,110,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    project();
    ctx.globalCompositeOperation = 'lighter';

    var b, e, i;
    for (b = 0; b < 16; b++) BK[b].length = 0;
    for (e = 0; e < EC; e++) {
      var a = E[e * 2], c = E[e * 2 + 1];
      var f = vis((FZ[a] + FZ[c]) / 2) * (0.35 + 0.65 * clamp(((SZ[a] + SZ[c]) / 2 + 1.3) / 2.6, 0, 1));
      BK[EG[e] * 4 + Math.min(3, (f * 4) | 0)].push(e);
    }
    ctx.lineWidth = 1;
    for (b = 0; b < 16; b++) {
      var arr = BK[b];
      if (!arr.length) continue;
      var grpI = b >> 2, lvl = b & 3;
      ctx.strokeStyle = 'rgba(' + LINE_RGB[grpI] + ',' + (LINE_A[grpI] * (0.10 + 0.90 * (lvl + 0.5) / 4)).toFixed(3) + ')';
      ctx.beginPath();
      for (e = 0; e < arr.length; e++) {
        var ia = E[arr[e] * 2], ib = E[arr[e] * 2 + 1];
        ctx.moveTo(SX[ia], SY[ia]); ctx.lineTo(SX[ib], SY[ib]);
      }
      ctx.stroke();
    }
    // подсвеченные линии
    ctx.lineWidth = 1.4;
    for (e = 0; e < EC; e++) {
      var ea = Math.max(act[E[e * 2]], act[E[e * 2 + 1]]);
      if (ea > 0.12) {
        var fa = vis((FZ[E[e * 2]] + FZ[E[e * 2 + 1]]) / 2);
        ctx.strokeStyle = 'rgba(255,170,240,' + (ea * (0.2 + 0.6 * fa)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(SX[E[e * 2]], SY[E[e * 2]]); ctx.lineTo(SX[E[e * 2 + 1]], SY[E[e * 2 + 1]]);
        ctx.stroke();
      }
    }

    // узлы
    for (i = 0; i < N; i++) {
      var kind = KIND[i], grp = GRP[i];
      var dz = clamp((SZ[i] + 1.3) / 2.6, 0, 1), fade = neckFade(i);
      var v = vis(FZ[i]);
      var rim = 1 - Math.abs(FZ[i]);
      var boost = (FZ[i] > -0.1 && kind === 0) ? 1 + 0.8 * rim * rim : 1;
      var al = (0.22 + 0.78 * dz) * (kind === 5 ? 0.8 : (0.10 + 0.90 * v)) * fade * boost;
      if (al < 0.02) continue;
      if (al > 1) al = 1;
      var tw = 0.75 + 0.25 * Math.sin(time * 0.0016 + PHASE[i]);
      var ac = act[i], isH = i === hoverIdx;
      var r = SIZE[i] * SK[i] * (0.8 + 0.25 * dz) * (1 + ac * 0.9) * (isH ? 1.9 : 1);
      var x = SX[i], y = SY[i];

      if (kind === 2) {                                   // глаза
        var gs = 15 * SK[i] * (0.9 + 0.25 * tw) * scale / 150;
        ctx.globalAlpha = al * 0.9; ctx.drawImage(SPR[3], x - gs * 2, y - gs * 2, gs * 4, gs * 4);
        ctx.globalAlpha = al; ctx.fillStyle = 'rgb(205,240,255)'; ctx.beginPath(); ctx.arc(x, y, 2.4 * SK[i], 0, 6.2832); ctx.fill();
        continue;
      }
      if (kind === 3) {                                   // ядро «мозга»
        var gc = (26 + 8 * tw) * SK[i] * scale / 150;
        ctx.globalAlpha = al * (0.75 + 0.25 * tw); ctx.drawImage(SPR[0], x - gc, y - gc, gc * 2, gc * 2);
        ctx.globalAlpha = al; ctx.fillStyle = '#e8f6ff'; ctx.beginPath(); ctx.arc(x, y, 3 * SK[i], 0, 6.2832); ctx.fill();
        continue;
      }
      if (kind === 4) {                                   // окончание дорожки: кольцо
        ctx.globalAlpha = al * 0.55; var gh = 12 * SK[i] * scale / 150; ctx.drawImage(SPR[0], x - gh, y - gh, gh * 2, gh * 2);
        ctx.globalAlpha = al; ctx.strokeStyle = 'rgb(160,225,255)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, 3.2 * SK[i], 0, 6.2832); ctx.stroke();
        ctx.fillStyle = 'rgb(220,245,255)'; ctx.beginPath(); ctx.arc(x, y, 1.1, 0, 6.2832); ctx.fill();
        continue;
      }
      if (ac > 0.3 || isH || (kind === 0 && SIZE[i] > 1.7 && v > 0.5)) {
        var gsp = (ac > 0.3 || isH) ? 2 : (grp === 1 ? 0 : 3);
        var grr = r * (ac > 0.3 ? 4.5 : 4) * (0.8 + 0.2 * tw);
        ctx.globalAlpha = clamp((ac > 0.3 || isH ? Math.max(ac, 0.6) * 0.6 : 0.4 * tw) * al, 0, 1);
        ctx.drawImage(SPR[gsp], x - grr, y - grr, grr * 2, grr * 2);
      }
      ctx.globalAlpha = 1;
      var col = (ac > 0.25) ? '255,215,248' : NODE_RGB[kind === 1 ? 3 : grp];
      ctx.fillStyle = 'rgba(' + col + ',' + (ac > 0.25 ? al : al * tw).toFixed(3) + ')';
      if (r < 1.25) ctx.fillRect(x - r, y - r, r * 2, r * 2);
      else { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
    }

    // кольца от нажатий
    ctx.globalAlpha = 1; ctx.lineWidth = 1.5;
    for (var k = rings.length - 1; k >= 0; k--) {
      var rg = rings[k], pr = rg.t / 0.9;
      if (pr >= 1) { rings.splice(k, 1); continue; }
      ctx.strokeStyle = 'rgba(255,190,245,' + ((1 - pr) * 0.8).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(SX[rg.i], SY[rg.i], 6 + pr * 46, 0, 6.2832); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function update(dt, now) {
    var idle = now - lastInteract > 1400;
    if (!dragging) {
      yaw += yawVel * dt;
      if (idle) yawVel += (AUTO - yawVel) * (1 - Math.exp(-dt * 1.2));
      else yawVel *= Math.exp(-dt * 2.5);
      var pt = pitchBase + (mouseIn ? hoverTilt : 0);
      pitch += (pt - pitch) * (1 - Math.exp(-dt * 2.2));
    }
    var i, w, wi;
    for (i = 0; i < N; i++) { var v = act[i] - dt * 2.6; act[i] = v > 0 ? v : 0; }
    for (wi = waves.length - 1; wi >= 0; wi--) {
      w = waves[wi]; w.t += dt;
      var front = Math.floor(w.t * 18);
      for (i = 0; i < N; i++) {
        var h = w.hop[i];
        if (h > w.prev && h <= front) act[i] = Math.max(act[i], w.str * (1 - h * 0.012));
      }
      w.prev = front;
      if (front > w.max + 2) waves.splice(wi, 1);
    }
    for (i = 0; i < rings.length; i++) rings[i].t += dt;
    if (!reduceMotion && !dragging) {
      nextAuto -= dt;
      if (nextAuto <= 0 && waves.length < 3) {
        var pool = G.brain;
        trigger(Math.random() < 0.8 ? pool[(Math.random() * pool.length) | 0] : (Math.random() * G.meshCount) | 0, 0.85);
        nextAuto = 1.2 + Math.random() * 1.3;
      }
    }
    hoverIdx = -1;
    if (mouseIn && !dragging) {
      hoverIdx = nearestNode(mx, my, 14);
      if (hoverIdx >= 0) {
        act[hoverIdx] = Math.max(act[hoverIdx], 0.95);
        var nb = adj[hoverIdx];
        for (i = 0; i < nb.length; i++) act[nb[i]] = Math.max(act[nb[i]], 0.5);
      }
    }
    canvas.style.cursor = dragging ? 'grabbing' : (hoverIdx >= 0 ? 'pointer' : 'grab');
  }

  var last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden || !W || !H) return;
    update(dt, now);
    draw(now);
  }
  requestAnimationFrame(frame);
  requestAnimationFrame(function () { canvas.style.opacity = '1'; });
  }

  // строим голову после загрузки страницы, чтобы не тормозить первый показ
  function start() { setTimeout(init, 40); }
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
