/* head3d.js — интерактивная цифровая голова для AI Labor Lab.
   Подключается к существующему <canvas id="headCanvas">.
   Без импортов и библиотек: совместим с обычным <script src="head3d.js"></script>. */
(function () {
  'use strict';

  function initHead() {
    var canvas = document.getElementById('headCanvas');
    if (!canvas || canvas.dataset.head3dReady === '1') return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.dataset.head3dReady = '1';

    var W = 0, H = 0, dpr = 1;
    var yaw = -0.12, pitch = 0.02, autoSpin = 0.003;
    var dragging = false, moved = false, lastX = 0, lastY = 0;
    var glow = 0.25, glowTarget = 0.25, reveal = 0;
    var lastTime = 0;
    var reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var cyan = '#32f5ff', blue = '#168dff', violet = '#b14cff';
    var points = [], links = [], dust = [];

    function rand(a, b) { return a + Math.random() * (b - a); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // Объёмная сетка эллипсоидной головы с небольшим рельефом лица.
    function facePoint(u, v) {
      var theta = u * Math.PI * 2;
      var phi = v * Math.PI;
      var sn = Math.sin(phi), cs = Math.cos(phi);
      var y = 1.72 * cs;
      var taper = 0.84 + 0.16 * cs;
      var x = 1.13 * sn * taper * Math.cos(theta);
      var z = 0.78 * sn * Math.sin(theta);

      // Лицо направлено к наблюдателю (+Z).
      var front = Math.pow(Math.max(0, Math.sin(theta)), 5);
      if (front > 0) {
        var eyeL = Math.exp(-(((x + 0.40) / 0.28) ** 2 + ((y - 0.42) / 0.17) ** 2) * 1.5);
        var eyeR = Math.exp(-(((x - 0.40) / 0.28) ** 2 + ((y - 0.42) / 0.17) ** 2) * 1.5);
        var bridge = Math.exp(-((x / 0.17) ** 2 + ((y - 0.03) / 0.50) ** 2) * 1.25);
        var tip = Math.exp(-((x / 0.24) ** 2 + ((y + 0.30) / 0.18) ** 2) * 1.7);
        var cheekL = Math.exp(-(((x + 0.61) / 0.34) ** 2 + ((y + 0.03) / 0.27) ** 2) * 1.2);
        var cheekR = Math.exp(-(((x - 0.61) / 0.34) ** 2 + ((y + 0.03) / 0.27) ** 2) * 1.2);
        z += front * (-0.18 * (eyeL + eyeR) + 0.24 * bridge + 0.31 * tip + 0.08 * (cheekL + cheekR));
      }
      return { x: x, y: y, z: z };
    }

    function buildNetwork() {
      points = []; links = []; dust = [];
      var rows = 32, cols = 46, grid = [];
      for (var r = 0; r <= rows; r++) {
        grid[r] = [];
        for (var c = 0; c <= cols; c++) {
          var p = facePoint(c / cols, 0.025 + 0.95 * r / rows);
          p.x += rand(-0.012, 0.012);
          p.y += rand(-0.012, 0.012);
          p.z += rand(-0.012, 0.012);
          p.phase = rand(0, Math.PI * 2);
          p.size = rand(0.45, 1.3);
          p.col = Math.random() < 0.68 ? cyan : (Math.random() < 0.7 ? blue : violet);
          points.push(p);
          grid[r][c] = p;
        }
      }
      // Соединяем соседние вершины, чтобы сетка оставалась связной и лёгкой.
      for (var rr = 0; rr < rows; rr++) {
        for (var cc = 0; cc < cols; cc++) {
          var a = grid[rr][cc], b = grid[rr][cc + 1], d = grid[rr + 1][cc], e = grid[rr + 1][cc + 1];
          links.push([a, b], [a, d]);
          if (Math.random() > 0.48) links.push([a, e]);
        }
      }
      for (var i = 0; i < 180; i++) {
        dust.push({ x: rand(-1.65, 1.65), y: rand(-1.1, 1.1), z: rand(-0.6, 0.7),
          size: rand(0.5, 1.5), phase: rand(0, Math.PI * 2) });
      }
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      W = rect.width; H = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize);
    resize();
    buildNetwork();

    function project(p, time) {
      var ca = Math.cos(yaw), sa = Math.sin(yaw);
      var x = p.x * ca + p.z * sa;
      var z = -p.x * sa + p.z * ca;
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      var y = p.y * cp - z * sp;
      z = p.y * sp + z * cp;
      var perspective = 3.8 / (4.6 - z);
      var scale = Math.min(W * 0.37, H * 0.43);
      return {
        x: W * 0.5 + x * scale * perspective,
        y: H * 0.49 - y * scale * perspective,
        z: z,
        k: perspective,
        p: p,
        twinkle: 0.7 + 0.3 * Math.sin(time * 0.002 + (p.phase || 0))
      };
    }

    function strokePath(coords, color, width, alpha) {
      if (!coords.length) return;
      ctx.beginPath();
      coords.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function drawFaceLines(time, scale) {
      function line2d(arr, color, alpha, width) {
        var pts = arr.map(function (p) { return [W * 0.5 + p[0] * scale, H * 0.49 - p[1] * scale]; });
        ctx.save();
        ctx.shadowBlur = 8 + glow * 13;
        ctx.shadowColor = color;
        strokePath(pts, color, width || 1.1, alpha);
        ctx.restore();
      }
      // Брови и глазницы.
      line2d([[-0.70,0.43],[-0.57,0.54],[-0.39,0.57],[-0.23,0.49],[-0.18,0.39],[-0.34,0.32],[-0.54,0.34],[-0.70,0.43]], cyan, 0.48 + glow * 0.25);
      line2d([[0.70,0.43],[0.57,0.54],[0.39,0.57],[0.23,0.49],[0.18,0.39],[0.34,0.32],[0.54,0.34],[0.70,0.43]], cyan, 0.48 + glow * 0.25);
      // Нос.
      line2d([[0,0.46],[-0.08,0.17],[-0.16,-0.15],[-0.12,-0.29],[0,-0.36],[0.12,-0.29],[0.16,-0.15],[0.08,0.17],[0,0.46]], '#42ffff', 0.82 + glow * 0.15, 1.35);
      // Губы.
      line2d([[-0.32,-0.64],[-0.17,-0.60],[0,-0.63],[0.17,-0.60],[0.32,-0.64]], violet, 0.78, 1.1);
      line2d([[-0.27,-0.68],[0,-0.72],[0.27,-0.68]], blue, 0.42, 0.8);
    }

    function draw(time) {
      if (!W || !H) { requestAnimationFrame(draw); return; }
      var dt = lastTime ? Math.min(40, time - lastTime) : 16;
      lastTime = time;
      if (!dragging && !reduceMotion) yaw += autoSpin * (0.55 + glow * 0.6);
      glow += (glowTarget - glow) * 0.065;
      reveal = Math.min(1, reveal + dt / 1250);

      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      var cx = W / 2, cy = H * 0.49;
      var haloRadius = Math.min(W, H) * (0.32 + glow * 0.07);
      var halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloRadius);
      halo.addColorStop(0, 'rgba(0,125,255,' + (0.10 + glow * 0.10) + ')');
      halo.addColorStop(0.55, 'rgba(34,30,255,0.045)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);

      var scale = Math.min(W * 0.37, H * 0.43);
      var projected = points.map(function (p) { return project(p, time); });

      // Появление сетки: постепенно проявляются линии и точки.
      ctx.lineWidth = 0.65;
      links.forEach(function (edge, i) {
        if ((i / links.length) > reveal) return;
        var a = project(edge[0], time), b = project(edge[1], time);
        var alpha = (0.12 + 0.22 * Math.max(0, (a.z + 1) / 2)) * reveal * (0.8 + glow * 0.8);
        ctx.strokeStyle = edge[0].col === violet ? violet : blue;
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });

      // Светящиеся вершины.
      projected.forEach(function (p, i) {
        if ((i / projected.length) > reveal) return;
        var radius = (0.65 + p.p.size * 0.7) * p.k;
        var alpha = (0.42 + 0.38 * p.twinkle) * reveal * (0.7 + glow * 0.65);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.p.col;
        ctx.shadowBlur = 4 + glow * 10;
        ctx.shadowColor = p.p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
      });
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // Контур головы: мягкая световая обводка.
      ctx.beginPath();
      ctx.ellipse(cx, cy + scale * 0.025, scale * 0.69, scale * 0.99, 0, 0, Math.PI * 2);
      ctx.strokeStyle = cyan;
      ctx.globalAlpha = (0.24 + glow * 0.28) * reveal;
      ctx.lineWidth = 1.1;
      ctx.shadowBlur = 15 + glow * 18;
      ctx.shadowColor = blue;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // Лицевые акценты в центре композиции.
      drawFaceLines(time, scale * 0.9);

      // Плавающие частицы у висков.
      dust.forEach(function (p) {
        var drift = Math.sin(time * 0.0007 + p.phase) * 0.10;
        var q = project({ x: p.x + drift, y: p.y, z: p.z }, time);
        var a = (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(time * 0.002 + p.phase))) * reveal;
        ctx.globalAlpha = a;
        ctx.fillStyle = Math.random() > 0.75 ? violet : cyan;
        ctx.beginPath(); ctx.arc(q.x, q.y, p.size * q.k, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
      requestAnimationFrame(draw);
    }

    function activateGlow() {
      glowTarget = glowTarget > 0.8 ? 0.25 : 1.25;
      canvas.classList.toggle('head3d-glowing', glowTarget > 0.8);
      var hint = document.getElementById('headHint');
      if (hint) hint.textContent = glowTarget > 0.8 ? 'Свечение активно · потяните, чтобы повернуть' : 'Нажмите, чтобы усилить свечение · потяните, чтобы повернуть';
    }

    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      yaw += dx * 0.008;
      pitch = clamp(pitch + dy * 0.004, -0.45, 0.45);
      lastX = e.clientX; lastY = e.clientY;
    });
    function endPointer() { dragging = false; canvas.style.cursor = 'grab'; }
    canvas.addEventListener('pointerup', function () {
      if (!moved) activateGlow();
      endPointer();
    });
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function () { if (!dragging) canvas.style.cursor = 'grab'; });

    // Кнопка существующего помощника остаётся кнопкой открытия чата,
    // поэтому свечение включается только при нажатии на саму голову.
    requestAnimationFrame(draw);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHead);
  } else {
    initHead();
  }
})();