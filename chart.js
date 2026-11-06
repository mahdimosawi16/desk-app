/* Desk charts: plain canvas, devicePixelRatio aware. No library. */
(function () {
  "use strict";
  var C = { green: "#00d35a", red: "#ff453a", blue: "#0a84ff", orange: "#ff9f0a", ter: "rgba(235,235,245,0.3)",
            sec: "rgba(235,235,245,0.6)", card2: "#2c2c2e", bg: "#000" };
  var FONT = '600 12px "SF Pro Text",-apple-system,BlinkMacSystemFont,"Helvetica Neue",system-ui,sans-serif';
  function reduced() { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; }

  function setup(canvas) {
    var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function t(s) { return Date.parse(s); }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hit(a, b) { return a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4 && a.y < b.y + b.h + 3 && b.y < a.y + a.h + 3; }

  /* range = {start, points:[[iso,v]], marks:[{ts,kind,text,value}]} */
  function line(canvas, range, key) {
    var pts = ((range && range.points) || []).slice(), marks = (range && range.marks) || [];
    if (pts.length === 1) pts.push([new Date().toISOString(), pts[0][1]]);  // flat line up to now
    var prev = canvas._prev || {}, sameKey = prev.key === key;
    var grow = sameKey && prev.n && pts.length > prev.n && !reduced();
    var oldMarks = sameKey ? (prev.marks || {}) : null;
    var markKeys = {}; marks.forEach(function (m) { markKeys[m.ts + m.text] = 1; });
    canvas._prev = { key: key, n: pts.length, marks: markKeys };
    var start = performance.now(), slide = 250, fade = 200;
    function frame(now) {
      var p = grow ? Math.min(1, (now - start) / slide) : 1;
      var fm = reduced() ? 1 : Math.min(1, (now - start) / fade);
      draw(p, fm);
      if ((grow && p < 1) || (oldMarks && fm < 1)) requestAnimationFrame(frame);
    }
    function draw(p, fm) {
      var s = setup(canvas), ctx = s.ctx, W = s.w, H = s.h, top = 30, bot = 18;
      var sv = range && range.start;
      if (!pts.length) {
        ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, H / 2 + 0.5); ctx.lineTo(W, H / 2 + 0.5); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      var x0 = t(pts[0][0]), x1 = t(pts[pts.length - 1][0]); if (x1 <= x0) x1 = x0 + 60000;
      var vals = pts.map(function (q) { return q[1]; }); if (sv != null) vals.push(sv);
      marks.forEach(function (m) { if (m.value != null) vals.push(m.value); });
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
      function X(ts) { return 4 + (t(ts) - x0) / (x1 - x0) * (W - 12); }
      function Y(v) { return top + (1 - (v - lo) / (hi - lo)) * (H - top - bot); }
      // dashed start line
      if (sv != null) {
        ctx.setLineDash([3, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Math.round(Y(sv)) + 0.5); ctx.lineTo(W, Math.round(Y(sv)) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      }
      var xy = pts.map(function (q) { return [X(q[0]), Y(q[1])]; });
      if (p < 1 && xy.length > 1) { // last point slides in
        var a = xy[xy.length - 2], b = xy[xy.length - 1];
        xy[xy.length - 1] = [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
      }
      // fill
      var g = ctx.createLinearGradient(0, top, 0, H);
      g.addColorStop(0, "rgba(0,211,90,0.22)"); g.addColorStop(1, "rgba(0,211,90,0)");
      ctx.beginPath(); ctx.moveTo(xy[0][0], H);
      xy.forEach(function (q) { ctx.lineTo(q[0], q[1]); });
      ctx.lineTo(xy[xy.length - 1][0], H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); xy.forEach(function (q, i) { i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.strokeStyle = C.green; ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.shadowColor = "rgba(0,211,90,0.55)"; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
      // live dot
      var e = xy[xy.length - 1];
      ctx.beginPath(); ctx.arc(e[0], e[1], 9, 0, 7); ctx.fillStyle = "rgba(0,211,90,0.22)"; ctx.fill();
      ctx.beginPath(); ctx.arc(e[0], e[1], 4.5, 0, 7); ctx.fillStyle = C.green; ctx.fill();
      // marks, labels never overlap
      ctx.font = FONT; var placed = [];
      marks.forEach(function (m) {
        if (t(m.ts) < x0 || t(m.ts) > x1 + 1) return;
        var col = m.kind === "buy" ? C.blue : m.kind === "win" ? C.green : C.red;
        var mx = X(m.ts), my = Y(m.value != null ? m.value : sv);
        var alpha = oldMarks && !oldMarks[m.ts + m.text] ? fm : 1;
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(mx, my, 4, 0, 7); ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke();
        var tw = ctx.measureText(m.text).width + 12, th = 20;
        var bx = Math.max(2, Math.min(W - tw - 2, mx - tw / 2)), cands = [];
        for (var k = 0; k < 6; k++) { cands.push(my - 12 - th - k * (th + 3)); cands.push(my + 12 + k * (th + 3)); }
        var box = null;
        for (var i = 0; i < cands.length; i++) {
          var c = { x: bx, y: cands[i], w: tw, h: th };
          if (c.y < 0 || c.y + c.h > H) continue;
          if (!placed.some(function (q) { return hit(q, c); })) { box = c; break; }
        }
        if (!box) { ctx.globalAlpha = 1; return; } // no free room: dot only, never overlap
        placed.push(box);
        rr(ctx, box.x, box.y, box.w, box.h, 10); ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = m.kind === "buy" ? "#fff" : "#000"; ctx.textBaseline = "middle";
        ctx.fillText(m.text, box.x + 6, box.y + th / 2 + 0.5);
        ctx.globalAlpha = 1;
      });
    }
    requestAnimationFrame(frame); draw(grow ? 0 : 1, oldMarks && !reduced() ? 0 : 1);
  }

  /* 1-minute OHLC candles + volume; exitLine = orange dashed "Risk trailing stop" */
  function candles(canvas, ks, exitLine) {
    var s = setup(canvas), ctx = s.ctx, W = s.w, H = s.h;
    if (!ks || !ks.length) {
      ctx.fillStyle = C.sec; ctx.font = FONT; ctx.textAlign = "center"; ctx.fillText("No price history yet", W / 2, H / 2);
      ctx.textAlign = "start"; return;
    }
    var volH = H * 0.2, ph = H - volH - 14, top = 8;
    var hs = [], ls = [];
    ks.forEach(function (k) { hs.push(k.h); ls.push(k.l); });
    if (exitLine) { hs.push(exitLine); ls.push(exitLine); }
    var hi = Math.max.apply(null, hs), lo = Math.min.apply(null, ls);
    if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
    var pad = (hi - lo) * 0.08; hi += pad; lo -= pad;
    function Y(v) { return top + (1 - (v - lo) / (hi - lo)) * (ph - top); }
    var n = Math.max(ks.length, 30), slot = (W - 8) / n, bw = Math.max(2, slot * 0.62);
    var vmax = Math.max.apply(null, ks.map(function (k) { return k.v || 0; })) || 1;
    ks.forEach(function (k, i) {
      var x = 4 + (n - ks.length + i) * slot + slot / 2, up = k.c >= k.o, col = up ? C.green : C.red;
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(k.h)); ctx.lineTo(Math.round(x) + 0.5, Y(k.l)); ctx.stroke();
      var y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c));
      ctx.fillStyle = col; ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      var vh = (k.v || 0) / vmax * (volH - 4);
      ctx.globalAlpha = 0.45; ctx.fillRect(x - bw / 2, H - vh, bw, vh); ctx.globalAlpha = 1;
    });
    if (exitLine) {
      var y = Math.round(Y(exitLine)) + 0.5;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = FONT; ctx.fillStyle = C.orange; ctx.textBaseline = "bottom";
      ctx.fillText("Risk trailing stop", 6, y - 3);
    }
  }
  window.DeskChart = { line: line, candles: candles };
})();
