/* head3d.js — интерактивная 3D-голова из нейросети.
   Чистый canvas 2D, без внешних библиотек: работает на GitHub Pages и офлайн.
   Управление: потяните мышью/пальцем — поворот; наведите курсор на узел — он
   подсветится; нажмите на узел — по сети пробежит импульс. */
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

  // Гладкая кривая через контрольные точки (Catmull-Rom / Hermite)
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

  // Профиль головы (лицо смотрит в +x). Высота y: от подбородка (-1.15) до макушки (1.1)
  var PY = [-1.15, -1.05, -0.95, -0.80, -0.66, -0.52, -0.40, -0.25, -0.05, 0.15, 0.30, 0.42, 0.55, 0.70, 0.85, 1.00, 1.10];
  var PF = [ 0.15,  0.30,  0.55,  0.68,  0.62,  0.66,  0.70,  0.68,  0.70, 0.70, 0.68, 0.74, 0.72, 0.68, 0.55, 0.30, 0.05];
  var PB = [ 0.10, -0.08, -0.18, -0.38, -0.52, -0.64, -0.73, -0.86, -0.95,-1.00,-1.02,-1.03,-1.01,-0.95,-0.78,-0.43,-0.05];
  var PW = [ 0.08,  0.16,  0.24,  0.36,  0.46,  0.54,  0.60,  0.66,  0.70, 0.72, 0.72, 0.72, 0.71, 0.66, 0.55, 0.36, 0.08];
  var fF = makeSpline(PY, PF), fB = makeSpline(PY, PB), fW = makeSpline(PY, PW);
  var fNose = makeSpline(
    [-0.42, -0.34, -0.27, -0.20, -0.10, 0.02, 0.16, 0.30, 0.45],
    [ 0.00,  0.10,  0.26,  0.31,  0.26, 0.17, 0.08, 0.02, 0.00]);

  function sgnPow(v, p) { return (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), p); }

  // Точка на поверхности головы по высоте y и углу phi
  function headPoint(y, phi) {
    var c = Math.cos(phi), s = Math.sin(phi);
    var xF = fF(y), xB = fB(y), w = fW(y);
    var cx = (xF + xB) / 2, rx = (xF - xB) / 2;
    var cc = sgnPow(c, 0.82), ss = sgnPow(s, 0.82);
    var x = cx + rx * cc, z = w * ss;
    var front = Math.max(0, c);
    // нос
    var nz = 0.07 + 0.09 * clamp((0.05 - y) / 0.35, 0, 1);
    x += fNose(y) * Math.exp(-(z * z) / (nz * nz)) * front;
    // надбровные дуги, глазницы, губы
    x += 0.06 * Math.exp(-Math.pow((y - 0.42) / 0.07, 2)) * front;
    x -= 0.07 * Math.exp(-Math.pow((y - 0.28) / 0.07, 2)) * Math.exp(-Math.pow((Math.abs(z) - 0.30) / 0.12, 2)) * front;
    x += 0.05 * Math.exp(-Math.pow((y + 0.45) / 0.06, 2)) * Math.exp(-Math.pow(z / 0.20, 2)) * front;
    // уши
    var ear = Math.exp(-Math.pow((y + 0.08) / 0.16, 2)) * Math.exp(-Math.pow((x + 0.12) / 0.14, 2));
    z += (z < 0 ? -1 : 1) * 0.10 * ear * clamp((Math.abs(ss) - 0.55) / 0.25, 0, 1);
    return [x, y, z];
  }

  // Шея (цилиндр, который не заходит внутрь головы)
  function neckPoint(y, phi) {
    var grow = 1 + 0.28 * clamp((-0.9 - y) / 0.8, 0, 1);
    return [-0.30 + 0.42 * grow * Math.cos(phi), y, 0.38 * grow * Math.sin(phi)];
  }
  function insideHead(p) {
    var y = p[1];
    if (y < -1.15 || y > 1.1) return false;
    var xF = fF(y), xB = fB(y), w = fW(y);
    var cx = (xF + xB) / 2, rx = (xF - xB) / 2;
    var a = (p[0] - cx) / (rx * 0.97), b = p[2] / (w * 0.97);
    return a * a + b * b < 1;
  }

  // Строим сеть: равномерно разбросанные узлы (Poisson-disk) + связи с ближайшими соседями
  function buildHead() {
    var rng = mulberry32(20240607), R = 0.15, pts = [], i, j, tries;

    function farEnough(p) {
      for (var k = 0; k < pts.length; k++) {
        var q = pts[k], dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
        if (dx * dx + dy * dy + dz * dz < R * R) return false;
      }
      return true;
    }
    for (tries = 0; tries < 14000; tries++) {
      var p = headPoint(-1.15 + rng() * 2.25, rng() * Math.PI * 2);
      if (farEnough(p)) pts.push(p);
    }
    var headCount = pts.length;
    for (tries = 0; tries < 5000; tries++) {
      var q = neckPoint(-1.75 + rng() * 1.25, rng() * Math.PI * 2);
      if (!insideHead(q) && farEnough(q)) pts.push(q);
    }

    var N = pts.length, P = new Float32Array(N * 3), adj = [], edges = [], seen = {};
    for (i = 0; i < N; i++) { P[i * 3] = pts[i][0]; P[i * 3 + 1] = pts[i][1]; P[i * 3 + 2] = pts[i][2]; adj.push([]); }
    for (i = 0; i < N; i++) {
      var cand = [];
      for (j = 0; j < N; j++) {
        if (i === j) continue;
        var dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2];
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < R * 2.05) cand.push([d, j]);
      }
      cand.sort(function (a, b) { return a[0] - b[0]; });
      for (j = 0; j < Math.min(5, cand.length); j++) {
        var a = Math.min(i, cand[j][1]), b = Math.max(i, cand[j][1]), key = a * 10000 + b;
        if (!seen[key]) { seen[key] = 1; edges.push(a, b); adj[a].push(b); adj[b].push(a); }
      }
    }
    // «мозговая» зона и тип узла
    var brain = [], kind = new Uint8Array(N), size = new Float32Array(N), phase = new Float32Array(N);
    for (i = 0; i < N; i++) {
      var x = P[i * 3], y = P[i * 3 + 1];
      if (y > 0.2 && x < 0.35 && i < headCount) brain.push(i);
      var r = rng();
      kind[i] = r < 0.22 ? 1 : 0;                 // 1 — фиолетовые узлы
      size[i] = 1.1 + rng() * 1.3 + (r > 0.93 ? 1.0 : 0);
      phase[i] = rng() * 6.283;
    }
    return { N: N, P: P, edges: edges, adj: adj, brain: brain, kind: kind, size: size, phase: phase };
  }
  // ==== GEN END ====

  var G = buildHead();
  var N = G.N, P = G.P, E = G.edges, adj = G.adj, EC = E.length / 2;

  // ---------- состояние ----------
  var DPR = 1, W = 0, H = 0, scale = 1;
  var yaw = Math.PI + 0.55, pitch = 0.08, pitchBase = 0.08;
  var yawVel = reduceMotion ? 0 : 0.22, AUTO = reduceMotion ? 0 : 0.22;
  var dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0, lastMoveT = 0, lastInteract = -9999;
  var mouseIn = false, mx = 0, my = 0, hoverIdx = -1, hoverTilt = 0;
  var SX = new Float32Array(N), SY = new Float32Array(N), SZ = new Float32Array(N), SK = new Float32Array(N);
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
  var SPR = [makeSprite(120, 190, 255), makeSprite(185, 140, 255), makeSprite(255, 150, 230)];

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) { W = H = 0; return; }
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    scale = Math.min(H / 2.95, W / 2.35);
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
      var dx = SX[i] - px, dy = SY[i] - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---------- ввод ----------
  function localPos(e) {
    var r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
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
      var p = localPos(e), moved = Math.hypot(p[0] - downX, p[1] - downY);
      if (moved < 6 && now - downT < 450) {
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
  var buckets = [[], [], [], []];

  function project() {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cxs = W / 2, cys = H / 2, YC = -0.27, D = 6;
    for (var i = 0; i < N; i++) {
      var x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      var k = D / (D - z2);
      SX[i] = cxs + x1 * k * scale;
      SY[i] = cys - (y2 - YC) * k * scale;
      SZ[i] = z2; SK[i] = k;
    }
  }

  function neckFade(i) {
    var y = P[i * 3 + 1];
    return y < -1.0 ? clamp(1 - (-1.0 - y) / 0.75, 0, 1) : 1;
  }

  function draw(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);

    // мягкое свечение за головой
    var g = ctx.createRadialGradient(W * 0.5, H * 0.38, 0, W * 0.5, H * 0.38, Math.max(W, H) * 0.55);
    g.addColorStop(0, 'rgba(110,110,255,0.16)');
    g.addColorStop(1, 'rgba(110,110,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    project();
    ctx.globalCompositeOperation = 'lighter';

    // связи — по 4 «корзинам» глубины
    var b, e;
    for (b = 0; b < 4; b++) buckets[b].length = 0;
    for (e = 0; e < EC; e++) {
      var a = E[e * 2], c = E[e * 2 + 1];
      var t = clamp(((SZ[a] + SZ[c]) / 2 + 1.1) / 2.2, 0, 1);
      buckets[Math.min(3, (t * 4) | 0)].push(e);
    }
    ctx.lineWidth = 1;
    for (b = 0; b < 4; b++) {
      ctx.strokeStyle = 'rgba(110,150,255,' + (0.07 + 0.075 * b).toFixed(3) + ')';
      ctx.beginPath();
      var arr = buckets[b];
      for (e = 0; e < arr.length; e++) {
        var ia = E[arr[e] * 2], ib = E[arr[e] * 2 + 1];
        ctx.moveTo(SX[ia], SY[ia]); ctx.lineTo(SX[ib], SY[ib]);
      }
      ctx.stroke();
    }
    // подсвеченные связи
    ctx.lineWidth = 1.4;
    for (e = 0; e < EC; e++) {
      var ea = Math.max(act[E[e * 2]], act[E[e * 2 + 1]]);
      if (ea > 0.06) {
        ctx.strokeStyle = 'rgba(255,170,240,' + (ea * 0.85).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(SX[E[e * 2]], SY[E[e * 2]]); ctx.lineTo(SX[E[e * 2 + 1]], SY[E[e * 2 + 1]]);
        ctx.stroke();
      }
    }

    // узлы
    for (var i = 0; i < N; i++) {
      var dz = clamp((SZ[i] + 1.1) / 2.2, 0, 1), fade = neckFade(i);
      var al = (0.30 + 0.70 * dz) * fade;
      if (al < 0.02) continue;
      var tw = 0.75 + 0.25 * Math.sin(time * 0.0016 + G.phase[i]);
      var ac = act[i];
      var r = G.size[i] * SK[i] * (0.85 + 0.25 * dz) * (1 + ac * 1.2) * (i === hoverIdx ? 1.8 : 1);
      if (ac > 0.1 || i === hoverIdx || G.size[i] > 2.5) {
        var gs = (ac > 0.1 || i === hoverIdx) ? 2 : G.kind[i];
        var gr = r * (ac > 0.1 ? 9 : 6) * (0.8 + 0.2 * tw);
        ctx.globalAlpha = clamp((ac > 0.1 || i === hoverIdx ? Math.max(ac, 0.7) : 0.55 * tw) * al, 0, 1);
        ctx.drawImage(SPR[gs], SX[i] - gr, SY[i] - gr, gr * 2, gr * 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = ac > 0.1 ? 'rgba(255,225,250,' + al.toFixed(3) + ')'
        : (G.kind[i] ? 'rgba(200,165,255,' : 'rgba(165,210,255,') + (al * tw).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(SX[i], SY[i], r, 0, 6.2832); ctx.fill();
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
    // вращение
    var idle = now - lastInteract > 1400;
    if (!dragging) {
      yaw += yawVel * dt;
      if (idle) yawVel += (AUTO - yawVel) * (1 - Math.exp(-dt * 1.2));
      else yawVel *= Math.exp(-dt * 2.5);
      var pt = pitchBase + (mouseIn ? hoverTilt : 0);
      pitch += (pt - pitch) * (1 - Math.exp(-dt * 2.2));
    }
    // импульсы
    var i, w, wi;
    for (i = 0; i < N; i++) { var v = act[i] - dt * 1.1; act[i] = v > 0 ? v : 0; }
    for (wi = waves.length - 1; wi >= 0; wi--) {
      w = waves[wi]; w.t += dt;
      var front = Math.floor(w.t * 16);
      for (i = 0; i < N; i++) {
        var h = w.hop[i];
        if (h > w.prev && h <= front) act[i] = Math.max(act[i], w.str * (1 - h * 0.014));
      }
      w.prev = front;
      if (front > w.max + 2) waves.splice(wi, 1);
    }
    for (i = 0; i < rings.length; i++) rings[i].t += dt;
    if (!reduceMotion && !dragging) {
      nextAuto -= dt;
      if (nextAuto <= 0 && waves.length < 3) {
        var pool = Math.random() < 0.75 ? G.brain : null;
        trigger(pool ? pool[(Math.random() * pool.length) | 0] : (Math.random() * N) | 0, 0.85);
        nextAuto = 1.3 + Math.random() * 1.4;
      }
    }
    // наведение
    hoverIdx = -1;
    if (mouseIn && !dragging) {
      hoverIdx = nearestNode(mx, my, 16);
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
})();
