/* Desk iPhone web app. Plain JS, no build step. Read-only: every action goes through Telegram @mahdi_grokbot.
   Data: JSON from the desk data host under /d/{data path}/ (path kept in localStorage, never in this file).
   Every FOMO URL shown here comes from the JSON (built by links.py on the desk). */
(function () {
  "use strict";
  var API = "https://utlybsuqokbgjlzgtlmo.supabase.co/functions/v1/desk/d/";
  var POLL_MS = 15000, PAGE = 30, AGENT_ORDER = ["scanner", "auditor", "analyst", "executor", "risk"];
  var COLORS = { scanner: "var(--cyan)", auditor: "var(--blue)", analyst: "var(--yellow)", executor: "var(--purple)", risk: "var(--pink)" };
  var ICON_BG = { scanner: "#64d2ff", auditor: "#0a84ff", analyst: "#ff453a", executor: "#bf5af2", risk: "#ff6b9a" };
  var EYES = '<circle cx="15" cy="19" r="2.3" fill="#000"/><circle cx="25" cy="19" r="2.3" fill="#000"/>';
  var MASCOT = {  // simple drawn characters, no external images
    scanner: '<path d="M20 3l4.6 9.6 10.4 1.4-7.6 7.2 1.9 10.4L20 26.6l-9.3 5 1.9-10.4L5 14l10.4-1.4z" fill="#fff"/>' + EYES,
    auditor: '<circle cx="18" cy="18" r="11" fill="#fff"/><path d="M26 26l8 8" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' + '<circle cx="14" cy="17" r="2.2" fill="#000"/><circle cx="22" cy="17" r="2.2" fill="#000"/>',
    analyst: '<path d="M8 22c-2-9 4-16 12-16s15 5 13 14c-1 6 2 9-3 12s-9-1-13 0-9 2-9-10z" fill="#fff"/>' + EYES + '<path d="M16 25q4 3 8 0" stroke="#000" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    executor: '<rect x="8" y="10" width="24" height="21" rx="7" fill="#fff"/><path d="M20 10V5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="4.5" r="2.4" fill="#fff"/>' + EYES + '<rect x="15" y="24" width="10" height="2.4" rx="1.2" fill="#000"/>',
    risk: '<path d="M20 4l13 5v9c0 9-6 15-13 18C13 33 7 27 7 18V9z" fill="#fff"/>' + EYES
  };
  var GROK = '<svg viewBox="0 0 24 24"><path d="M4 19 19 4M9 4h11v11" stroke="#000" stroke-width="2.6" fill="none" stroke-linecap="round"/></svg>';
  var FOMO_MARK = '<svg viewBox="0 0 10 10"><path d="M2 1h6v2H4v1.6h3.4v2H4V9H2z" fill="#000"/></svg>';
  var PLAY = '<svg viewBox="0 0 10 12"><path d="M0 0l10 6-10 6z"/></svg>';

  var m = location.hash.match(/^#d=([A-Za-z0-9]{32,128})$/);
  if (m) { localStorage.setItem("deskPath", m[1]); history.replaceState(null, "", location.pathname + location.search + "#home"); }
  var PATH = localStorage.getItem("deskPath");

  var cache = {}, missing = {}, offline = false, retryAt = 0, lastOkTs = null, timer = null, inflight = null;
  var ui = { range: "LIVE", actPage: 1, search: false, q: "" };
  var animated = {}, seenExec = sessionStorage.getItem("seenExec");
  var view = document.getElementById("view"), offEl = document.getElementById("offline");
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(v, d) { if (v == null || isNaN(v)) return "n/a"; d = d == null ? 2 : d; return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function compact(v) { if (v == null) return "n/a"; var a = Math.abs(v); return a >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : a >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : a >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : money(v); }
  function price(v) { if (v == null) return "n/a"; if (v >= 1) return money(v); var s = v.toPrecision(4); if (s.indexOf("e") > -1) s = Number(s).toFixed(10).replace(/0+$/, ""); return "$" + s; }
  function signedPct(v) { if (v == null) return ""; var x = Math.round(v * 100) / 100 + 0; return (x >= 0 ? "+" : "") + x.toFixed(2) + "%"; }
  function hm(iso) { if (!iso) return "–"; return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }); }
  function age(h) { if (h == null) return ""; return h < 1 ? Math.max(1, Math.round(h * 60)) + "m old" : (h < 48 ? Math.round(h) + "h old" : Math.round(h / 24) + "d old"); }
  function cls(v) { return /^\+/.test(v) ? "up" : /^-/.test(v) ? "down" : ""; }
  function ext(url, inner, klass) { return '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' + (klass ? ' class="' + klass + '"' : "") + ">" + inner + "</a>"; }
  var CHEV = '<svg viewBox="0 0 13 21"><path d="M11 2 2.5 10.5 11 19"/></svg>';
  var SHIELD = '<svg viewBox="0 0 13 14"><path d="M6.5 0 13 2.4v4.2C13 10.4 10.3 13 6.5 14 2.7 13 0 10.4 0 6.6V2.4z"/></svg>';
  function back(href, label) { return '<div class="nav"><a class="back" href="' + href + '">' + CHEV + "<span>" + esc(label) + "</span></a></div>"; }

  /* ---------- routing / data ---------- */
  function route() {
    var h = location.hash.replace(/^#/, "") || "home", p = h.split("/");
    return { name: p[0], arg: p[1] || null };
  }
  function needs(r) {
    switch (r.name) {
      case "agents": return ["state.json", "agents.json"];
      case "activity": return ["state.json", "activity.json"];
      case "account": return ["state.json", "account.json"];
      case "coin": return ["state.json", "coin/" + r.arg + ".json"];
      case "audit": return ["state.json", "audit/" + r.arg + ".json"];
      default: return ["state.json", "chart.json", "activity.json", "agents.json"];
    }
  }
  function get(name) {
    return fetch(API + encodeURIComponent(PATH) + "/" + name, { cache: "no-store" }).then(function (r) {
      if (r.status === 404 && name.indexOf("/") > -1) { missing[name] = true; return null; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json().then(function (j) { cache[name] = j; delete missing[name]; return j; });
    });
  }
  function poll() {
    clearTimeout(timer);
    if (!PATH) { render(); return Promise.resolve(); }
    var files = needs(route());
    inflight = Promise.all(files.map(get)).then(function () {
      offline = false; lastOkTs = cache["state.json"] && cache["state.json"].ts;
    }).catch(function () {
      offline = true; retryAt = Date.now() + POLL_MS;
    }).then(function () { render(); timer = setTimeout(poll, POLL_MS); });
    return inflight;
  }
  window.__desk = { poll: poll, cache: cache, render: function () { render(); } };

  function offlineRow() {
    if (!offline) { offEl.hidden = true; return; }
    var n = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    offEl.hidden = false;
    offEl.textContent = "Desk offline · retrying in " + n + "s · last update " + (lastOkTs ? hm(lastOkTs) : "never");
  }
  setInterval(offlineRow, 1000);

  /* ---------- skeleton ---------- */
  function sk(h, w, mt) { return '<div class="sk" style="height:' + h + "px;" + (w ? "width:" + w + ";" : "") + "margin:" + (mt || 0) + 'px 16px 0"></div>'; }
  function skeleton(kind) {
    var s = '<div class="nav"></div>';
    if (kind === "home") return s + sk(66, "62%", 6) + sk(18, "40%", 12) + sk(240, null, 18) + sk(28, null, 12) + sk(30, "45%", 26) +
      '<div class="sk" style="height:calc((100vw - 32px) * 470 / 504);margin:12px 16px 0;border-radius:calc((100vw - 32px) * 42 / 504)"></div>';
    if (kind === "coin") return s + sk(34, "55%") + sk(18, "40%", 10) + sk(66, "70%", 14) + sk(220, null, 18) + sk(140, null, 18);
    if (kind === "audit") return s + sk(34, "55%") + sk(280, null, 14) + sk(60, null, 18) + sk(54, null, 16);
    return s + sk(40, "45%") + sk(200, null, 16) + sk(200, null, 14);
  }

  /* ---------- odometer ---------- */
  var odoPrev = "";
  function odoHtml(text, prev) {
    // align from the right; digit columns roll, other chars are static
    var out = "", pa = prev.split("").reverse(), ta = text.split("").reverse(), cols = [];
    ta.forEach(function (ch, i) {
      if (/\d/.test(ch)) {
        var from = /\d/.test(pa[i] || "") ? +pa[i] : 0, strip = "";
        for (var d = 0; d <= 9; d++) strip += "<span>" + d + "</span>";
        cols.unshift('<span class="col"><span class="odos" data-to="' + ch + '" data-i="' + i + '" style="transform:translateY(-' + (prev ? from : +ch) + 'em)">' + strip + "</span></span>");
      } else cols.unshift('<span class="ch">' + esc(ch) + "</span>");
    });
    return '<span class="odo">' + cols.join("") + "</span>";
  }
  function odoRun() {
    var strips = view.querySelectorAll(".odo .odos");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        strips.forEach(function (s) {
          s.style.transitionDelay = reduced ? "0ms" : (+s.dataset.i * 30) + "ms";
          if (reduced) s.style.transition = "none";
          s.style.transform = "translateY(-" + s.dataset.to + "em)";
        });
      });
    });
  }

  /* ---------- pieces ---------- */
  function actRow(it) {
    var raw = String(it.value || ""), v = raw.indexOf(" / ") > -1 ? raw.split(" / ") : raw.split(" · "), icon, bg;
    if (it.kind === "buy") { icon = "↗"; bg = "rgba(10,132,255,.2);color:var(--blue)"; }
    else if (it.kind === "sell") { var win = /^\+/.test(v[0]); icon = win ? "$" : "↘"; bg = win ? "rgba(0,211,90,.18);color:var(--green)" : "rgba(255,69,58,.2);color:var(--red)"; }
    else { icon = "×"; bg = "var(--card2);color:var(--sec)"; }
    var href = it.target === "coin" ? "#coin/" + it.mint : it.target === "audit" ? "#audit/" + it.mint : null;
    var inner = '<span class="ic" style="background:' + bg + '">' + icon + '</span><span class="mid"><div class="t1">' + esc(it.title) +
      '</div><div class="t2">' + esc(it.subtitle) + '</div></span><span class="val"><div class="' + (it.kind === "reject" ? "muted" : cls(v[0])) + '">' +
      esc(v[0]) + "</div>" + (v[1] ? '<div class="t2 ' + cls(v[1]) + '">' + esc(v[1]) + "</div>" : "") + "</span>";
    return href ? '<a class="li tap" href="' + href + '">' + inner + "</a>" : '<div class="li">' + inner + "</div>";
  }
  function head(a, right) {
    return '<div class="ahead"><span class="sw" style="background:' + COLORS[a.name] + '"></span>' + esc(a.title) +
      '<span class="right">' + (right || "") + "</span></div>";
  }
  function strips(layers, running) {
    var s = "";
    for (var i = 1; i <= 8; i++) {
      var l = (layers || []).filter(function (x) { return x.n === i; })[0], c = "";
      if (l && l.pass !== null) c = l.pass ? "ok" : "red"; else if (running && (layers || []).length === i - 1) c = "scan";
      s += '<div class="strip ' + c + '">' + i + "</div>";
    }
    return '<div class="strips">' + s + "</div>";
  }
  function ring(score) {
    var v = score == null ? 0 : Math.max(0, Math.min(100, score)), r = 50, c = 2 * Math.PI * r;
    var col = v >= 70 ? "var(--green)" : "var(--yellow)";
    return '<div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="#2c2c2e" stroke-width="11"/>' +
      '<circle cx="60" cy="60" r="50" fill="none" stroke="' + col + '" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + (c * v / 100) + " " + c + '"/></svg>' +
      '<div class="v">' + (score == null ? "–" : Math.round(v)) + "</div></div>";
  }
  function cardBody(a) {
    var c = a.card || {};
    if (a.name === "scanner") {
      var feed = (c.feed || []).map(function (d) {
        var killed = d.verdict !== "pass";
        return '<div class="row ' + (killed ? "killed" : "passed") + '"><span class="nm">' + esc(d.label) + '</span><span class="why">' + esc(killed ? d.reason : "→ auditor") + "</span></div>";
      }).join("");
      return '<div class="astat">' + a.today + "<small>pools</small></div>" + '<div class="abody">' +
        (feed ? '<div class="feed">' + feed + "</div>" : '<div class="muted">Listening for graduations</div>') + "</div>";
    }
    if (a.name === "auditor") {
      var L = c.latest;
      var line = !L ? '<div class="muted">No coin taken apart yet</div>' :
        '<div class="afoot"><span>' + esc(L.label) + "</span><span>" + (!L.done ? "taking apart..." : L.passed ? '<span class="up">8/8 → Executor</span>' : '<span class="down">' + esc(L.reason) + "</span>") + "</span></div>";
      return '<div class="astat">' + c.takenApart + "<small>taken apart</small></div>" + '<div class="abody">' + strips(L && L.layers, L && !L.done) + line +
        '<div class="afoot"><span>' + c.rejected + " rejected</span></div></div>";
    }
    if (a.name === "analyst") {
      var v = c.latest;
      return '<div class="astat">Scoring</div><div class="abody">' + ring(v && v.score) +
        '<div class="afoot"><span>' + (v ? esc(v.label) : "Waiting for a cleared coin") + "</span><span>" + (v ? (v.pass ? '<span class="up">pass</span>' : esc(v.reason || "reject")) : "") + "</span></div></div>";
    }
    if (a.name === "executor") {
      var e = c.latest, anim = e && e.status === "bought" && String(e.id) !== seenExec && e.mode === "PAPER" && !reduced;
      var done = e && e.status === "bought";
      return '<div class="astat">' + c.trades + "<small>trades</small></div>" + '<div class="abody">' +
        (e ? '<div class="afoot"><span>' + esc(e.label) + "</span><span>" + money(e.sizeUsd) + " · " + (+e.stackPct).toFixed(1) + "% of stack</span></div>" +
          '<div class="bar"><i data-exec="' + (anim ? e.id : "") + '" style="width:' + (done && !anim ? 100 : 0) + '%"></i></div>' +
          '<div class="afoot"><span class="exlbl ' + (done && !anim ? "up" : "") + '">' + (done ? (anim ? "Executing... 0%" : "✓ Filled") : esc(e.status)) + "</span></div>"
          : '<div class="muted">No trade yet tonight</div>') + "</div>";
    }
    if (a.name === "risk") {
      var word = c.guarding ? "Guarding" : c.lastExit ? c.lastExit.kind : "Guarding";
      return '<div class="astat">' + esc(word) + (c.guarding ? "<small>" + c.open + " open</small>" : "") + "</div>" +
        '<div class="abody">' + (c.lastExit && !c.guarding ? '<div class="afoot"><span>' + esc(c.lastExit.label) + "</span></div>" : "") +
        '<div class="pills"><span class="pill red">' + esc(c.stopPill) + '</span><span class="pill green">' + esc(c.trailPill) + "</span></div></div>";
    }
    return "";
  }
  function walletMeta(w) {
    return "on-chain Solana · " + (w.updated_ts ? "updated " + hm(w.updated_ts) : "not read yet") +
      (w.stale || (w.updated_ts && Date.now() - Date.parse(w.updated_ts) > 180000) ? ' · <span class="stale">stale</span>' : "") + (w.unpriced ? " · " + w.unpriced + " unpriced" : "");
  }
  function walletGroup(w) {
    if (!w) return '<div class="group"><div class="gh"><span>On-chain Solana wallet</span></div><div class="list"><div class="kv"><div class="k">Not set<div class="t2">wallet &lt;address&gt; in Telegram</div></div></div></div></div>';
    var amt = function (x) { return (+x).toLocaleString("en-US", { maximumFractionDigits: x >= 1 ? 2 : 6 }); };
    var rows = '<div class="kv"><div class="k">Total<div class="t2">' + walletMeta(w) + '</div></div><div class="v">' + (w.usd == null ? "n/a" : money(w.usd)) + "</div></div>" +
      '<div class="kv"><div class="k">SOL<div class="t2">' + (w.sol == null ? "n/a" : amt(w.sol)) + ' SOL</div></div><div class="v">' + (w.solUsd == null ? "unpriced" : money(w.solUsd)) + "</div></div>" +
      (w.tokens && w.tokens.length ? w.tokens.map(function (t) {
        return ext(t.link, '<div class="k">' + esc(t.symbol) + '<div class="t2">' + amt(t.amount) + '</div></div><div class="v">' + (t.usd == null ? '<span class="ter">unpriced</span>' : money(t.usd)) + "</div>", "kv link");
      }).join("") : '<div class="kv"><div class="k muted">No SPL tokens</div></div>');
    return '<div class="group" id="set-wallet"><div class="gh"><span>On-chain Solana wallet</span><span>read-only · not your FOMO in-app balance</span></div><div class="list">' + rows + "</div></div>";
  }

  function miniLive(a) {
    var c = a.card || {};
    if (a.name === "scanner") {
      var f = (c.feed || [])[0];
      return "<b>" + a.today + "</b><span class=\"one\">pools · " + (f ? esc(f.label) + " " + esc(f.verdict === "pass" ? "→ auditor" : f.reason) : "Listening for graduations") + "</span>";
    }
    if (a.name === "auditor") {
      var L = c.latest;
      return strips(L && L.layers, L && !L.done) + '<span class="one">' + c.takenApart + " taken apart · " + c.rejected + " rejected</span>";
    }
    if (a.name === "analyst") {
      var v = c.latest;
      return "<b>" + (v && v.score != null ? Math.round(v.score) : "–") + '</b><span class="one">' + (v ? esc(v.label) + " · " + (v.pass ? "pass" : esc(v.reason || "reject")) : "Scoring") + "</span>";
    }
    if (a.name === "executor") {
      var e = c.latest, done = e && e.status === "bought";
      return "<b>" + c.trades + '</b><span class="one">' + (e ? money(e.sizeUsd) + " · " + (+e.stackPct).toFixed(1) + "% of stack" : "trades") + "</span>" +
        '<div class="bar"><i style="width:' + (done ? 100 : 0) + '%"></i></div>';
    }
    if (a.name === "risk") {
      return "<b>" + (c.guarding && c.open ? "Guarding" : c.lastExit ? esc(c.lastExit.kind) : "Guarding") + '</b><div class="pills"><span class="pill red">' + esc(c.stopPill) + '</span><span class="pill green">' + esc(c.trailPill) + "</span></div>";
    }
    return "";
  }
  function miniCard(a, s) {
    var running = s.deskRunning && !a.paused;
    var stTxt = a.paused ? "Paused" : running ? "Running" : "Ready";
    var col = a.paused ? "var(--orange)" : COLORS[a.name];
    return '<a class="mcard" href="#agents/' + a.name + '"><span class="mascot" style="background:' + ICON_BG[a.name] + '"><svg viewBox="0 0 40 40">' + MASCOT[a.name] + "</svg></span>" +
      '<div class="nm">' + esc(a.title) + '</div><div class="st" style="color:' + col + '"><i></i>' + stTxt + "</div>" +
      (running ? '<div class="live">' + miniLive(a) + "</div>" : '<div class="wt">' + (a.paused ? "pause via Telegram" : "waiting for Run") + "</div>") + "</a>";
  }

  function execAnim() {
    var bar = view.querySelector("i[data-exec]:not([data-exec=''])");
    if (!bar) return;
    var id = bar.dataset.exec, lbl = view.querySelector(".exlbl"), t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / 1200);
      bar.style.width = (p * 100) + "%";
      if (lbl) lbl.textContent = p < 1 ? "Executing... " + Math.round(p * 100) + "%" : "✓ Filled";
      if (p < 1) requestAnimationFrame(step); else { if (lbl) lbl.classList.add("up"); seenExec = id; sessionStorage.setItem("seenExec", id); }
    })(t0);
  }

  /* ---------- screens ---------- */
  function fixtureTag(s) { return s && s.fixture ? '<div class="fixture">Fixture data · not live</div>' : ""; }
  function paperPill(s) { return s && s.paper ? '<span class="pill orange">PAPER</span>' : ""; }
  function unread(s) { var seen = +localStorage.getItem("seenAct") || 0; return s && s.lastActivityId && s.lastActivityId > seen; }

  function home() {
    var s = cache["state.json"], ch = cache["chart.json"], act = cache["activity.json"], ag = cache["agents.json"];
    if (!s || !ch || !act || !ag) return null;
    var balTxt = money(s.balance), mult = (s.multiplier || 1).toFixed(2) + "×";
    var allMarks = ch.ranges.ALL.marks.length, r = ch.ranges[ui.range];
    var agents = AGENT_ORDER.map(function (n) { return ag.agents.filter(function (a) { return a.name === n; })[0]; }).filter(Boolean);
    var up = (s.todayUsd || 0) >= 0, online = s.online && !offline;
    var run = s.deskRunning ? ext(s.pauseUrl, "Running " + PLAY, "runbtn running") : ext(s.runUrl, "Run " + PLAY, "runbtn");
    var html = '<div class="nav"><a class="logo" href="#account" aria-label="Account">' + GROK + "</a>" +
      '<a class="navtitle" href="#agents">Grok Bot <span class="chev">›</span></a>' +
      '<button class="iconbtn" id="searchBtn" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg></button>' +
      '<a class="iconbtn" href="#activity" aria-label="Activity"><svg viewBox="0 0 24 24"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4"/></svg>' + (unread(s) ? '<span class="dot"></span>' : "") + "</a>" +
      run + "</div>" +
      '<div class="fomoline"><span class="fm">' + FOMO_MARK + "</span>" + ext(s.profileUrl, "fomo") + " · " + esc(s.fomoHandle) + " · " +
      (s.wallet ? "wallet " + (s.wallet.usd == null ? "n/a" : money(s.wallet.usd)) : "stack " + money(s.stack)) +
      ' · <span class="on' + (online ? "" : " off") + '" role="img" aria-label="' + (online ? "desk online" : "desk offline") + '"></span></div>' +
      (s.wallet ? '<div class="walletline">' + walletMeta(s.wallet) + "</div>" : "") +
      fixtureTag(s) +
      '<div class="bal"><div class="balrow"><div class="big" id="bal">' + odoHtml(balTxt, odoPrev) + "</div>" + paperPill(s) + "</div>" +
      '<div class="sub"><span class="chg ' + (up ? "up" : "down") + '">' + (up ? "▲ " : "▼ ") + money(Math.abs(s.todayUsd || 0)) + " (" + Math.abs(s.todayPct || 0).toFixed(2) + "%)</span>" +
      '<span class="pill ' + (s.multiplier >= 1 ? "green" : "red") + '">' + mult + "</span></div></div>" +
      '<div class="chartbox"><canvas id="lc"></canvas>' + (allMarks ? "" : '<div class="chartempty">Waiting for the first trade</div>') + "</div>" +
      '<div class="ranges2">' + ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(function (k) { return '<button data-range="' + k + '" class="' + (k === ui.range ? "on" : "") + '">' + (k === ui.range ? "• " : "") + k + "</button>"; }).join("") + "</div>" +
      '<div class="sechead"><h2>Agents</h2><span class="ready">' + (s.deskRunning ? ag.running + " running" : (s.readyCount != null ? s.readyCount : ag.running) + " ready") + "</span></div>" +
      '<div class="carousel2" id="car">' + agents.map(function (a) { return miniCard(a, s); }).join("") + "</div>" +
      '<div class="pdots" id="pdots">' + agents.map(function (_, i) { return "<i" + (i === 0 ? ' class="on"' : "") + "></i>"; }).join("") + "</div>" +
      '<div class="sechead"><h2>Activity</h2><a class="seeall" href="#activity">See all</a></div>' +
      (act.items.length ? '<div class="list">' + act.items.slice(0, 5).map(actRow).join("") + "</div>" : '<div class="list"><div class="empty">No trades yet</div></div>');
    var after = function () {
      DeskChart.line(document.getElementById("lc"), r, ui.range);
      odoRun(); odoPrev = balTxt;
      view.querySelectorAll("[data-range]").forEach(function (b) { b.onclick = function () { ui.range = b.dataset.range; render(); }; });
      document.getElementById("searchBtn").onclick = function () { ui.search = true; render(); };
      var car = document.getElementById("car"), dots = document.querySelectorAll("#pdots i");
      function sync() {
        var first = car.firstElementChild; if (!first) return;
        var step = first.offsetWidth + 12, max = car.scrollWidth - car.clientWidth;
        var i = car.scrollLeft >= max - 2 ? dots.length - 1 : Math.round(car.scrollLeft / step);
        dots.forEach(function (d, k) { d.classList.toggle("on", k === i); });
      }
      car.addEventListener("scroll", sync, { passive: true }); sync();
    };
    return { html: html, after: after };
  }

  function agentsTab(r) {
    var ag = cache["agents.json"], s = cache["state.json"];
    if (!ag) return null;
    var now = Date.now();
    var html = '<div class="nav"></div>' + fixtureTag(s) + '<div class="title">Agents</div>' +
      AGENT_ORDER.map(function (n) {
        var a = ag.agents.filter(function (x) { return x.name === n; })[0]; if (!a) return "";
        var stale = !a.lastBeat || now - Date.parse(a.lastBeat) > 120000;
        var st = a.paused ? "paused" : stale ? "stale" : "";
        var decs = a.decisions.length ? a.decisions.map(function (d) {
          var good = d.verdict === "pass" || d.verdict === "bought" || d.verdict === "trail" || d.verdict === "guarding";
          return '<div class="dec"><span class="l"><span class="tm">' + hm(d.ts) + "</span>" + ext(d.link, esc(d.label)) + '</span><span class="r ' + (good ? "up" : d.verdict === "running" ? "" : "") + '">' + esc(d.reason) + "</span></div>";
        }).join("") : '<div class="dec"><span class="l muted">' + ({ scanner: "Listening for graduations", auditor: "No coin taken apart yet" }[n] || "Nothing yet tonight") + "</span></div>";
        return '<section class="fcard" id="ag-' + n + '"><div class="ahead"><span class="status ' + st + '"></span>' + esc(a.title) +
          '<span class="right">' + a.today + " today</span></div>" +
          '<div class="rich">' + cardBody(a) + "</div>" +
          '<div class="toggle"><div><div>Paused</div><div class="hint">' + esc("pause via Telegram") + " · <code>pause " + n + "</code></div></div>" +
          '<span class="sw-ui ' + (a.paused ? "on" : "") + '" role="switch" aria-checked="' + a.paused + '" aria-disabled="true"></span></div>' +
          '<div class="hint" style="padding:10px 0 6px">Last 20 decisions</div>' + decs +
          '<a class="linkrow" href="#account/' + n + '"><span>Settings</span><span>›</span></a></section>';
      }).join("");
    return { html: html, after: function () { execAnim(); if (r.arg) { var el = document.getElementById("ag-" + r.arg); if (el) el.scrollIntoView(); } } };
  }

  function activityTab() {
    var act = cache["activity.json"], s = cache["state.json"];
    if (!act) return null;
    if (s && s.lastActivityId) localStorage.setItem("seenAct", s.lastActivityId);
    var items = act.items.slice(0, ui.actPage * PAGE);
    var html = '<div class="nav"></div>' + fixtureTag(s) + '<div class="title">Activity</div>' +
      (items.length ? '<div class="list">' + items.map(actRow).join("") + "</div>" +
        (act.items.length > items.length ? '<button class="more" id="more">Show more</button>' : "")
        : '<div class="list"><div class="empty">Nothing yet tonight</div></div>');
    return { html: html, after: function () { var b = document.getElementById("more"); if (b) b.onclick = function () { ui.actPage++; render(); }; } };
  }

  function accountTab(r) {
    var a = cache["account.json"], s = cache["state.json"];
    if (!a) return null;
    var html = '<div class="nav"></div>' + fixtureTag(s) + '<div class="title">Account</div>' +
      '<div class="group"><div class="list">' +
      '<div class="kv"><div class="k">Mode<div class="t2">switch with `paper` / `live` in Telegram</div></div><div class="v"><span class="pill ' + (a.mode === "PAPER" ? "orange" : "green") + '">' + esc(a.mode) + "</span></div></div>" +
      '<div class="kv"><div class="k">Stack' + (a.mode === "LIVE" ? "" : '<div class="t2">paper balance</div>') + '</div><div class="v">' + money(a.balance) + "</div></div>" +
      '<div class="kv"><div class="k">Telegram<div class="t2">pushes and commands go through ' + esc(a.telegram.bot) + '</div></div><div class="v ' + (a.telegram.connected ? "up" : "down") + '">' + (a.telegram.connected ? "Connected" : "Not connected") + "</div></div>" +
      "</div></div>" +
      '<div class="group"><div class="list">' +
      ext(a.profileUrl, '<div class="k">Your FOMO profile<div class="t2">@' + esc(a.fomoHandle) + '</div></div><div class="v">Open ›</div>', "kv link") +
      '<button class="kv link" id="invite" style="width:100%;text-align:left"><div class="k">Invite a friend<div class="t2">FOMO sign-up link</div></div><div class="v">Share ›</div></button>' +
      "</div></div>" + walletGroup(s && s.wallet) +
      a.groups.map(function (g) {
        return '<div class="group" id="set-' + esc(g.anchor) + '"><div class="gh"><span>' + esc(g.title) + '</span><span>read-only · change with <code>set</code> in Telegram</span></div><div class="list">' +
          g.items.map(function (it) { return '<div class="kv"><div class="k">' + esc(it.key) + '<div class="t2">' + esc(it.telegram) + '</div></div><div class="v">' + esc(it.value) + "</div></div>"; }).join("") + "</div></div>";
      }).join("");
    return { html: html, after: function () {
      document.getElementById("invite").onclick = function () {
        if (navigator.share) { navigator.share({ title: "FOMO", url: a.signupUrl }).catch(function () {}); return; }
        (navigator.clipboard ? navigator.clipboard.writeText(a.signupUrl) : Promise.reject()).then(function () { toast("Link copied"); }, function () { toast("Link copied"); });
      };
      if (r.arg) { var el = document.getElementById("set-" + r.arg); if (el) el.scrollIntoView(); }
    } };
  }

  function coinScreen(r) {
    var name = "coin/" + r.arg + ".json", c = cache[name], s = cache["state.json"];
    if (missing[name]) return { html: back("#home", "Back") + '<div class="empty">No data for this coin tonight</div>' };
    if (!c) return null;
    var pos = c.position, ex = c.exit, pTxt = price(c.price);
    var shield = c.audit && c.audit.done ? '<a class="chip ' + (c.audit.passed ? "" : "red") + '" href="#audit/' + c.mint + '">' + SHIELD + (c.audit.passed ? "8/8" : esc(c.audit.count + "/8")) + "</a>" : "";
    var html = '<div class="nav" style="justify-content:space-between"><a class="back" href="#home">' + CHEV + "<span>Back</span></a>" + shield + "</div>" + fixtureTag(s) +
      '<div class="coinname">' + esc(c.name || c.label) + " " + paperPill({ paper: c.mode === "PAPER" }) + "</div>" +
      '<div class="pad muted">' + esc(c.symbol || c.label) + " · " + esc(c.chain) + (c.ageH != null ? " · " + age(c.ageH) : "") + "</div>" +
      '<div class="price ' + (pTxt.length > 8 ? "smallp" : "") + '">' + esc(pTxt) + "</div>" +
      (pos && pos.sincePct != null ? '<div class="pad sub"><span class="' + (pos.sincePct >= 0 ? "up" : "down") + '">' + (pos.sincePct >= 0 ? "▲ " : "▼ ") + Math.abs(pos.sincePct).toFixed(2) + "%</span><span class=\"muted\">since entry</span></div>" : "") +
      '<div class="chartbox" style="height:230px;margin:18px 16px 0"><canvas id="cc"></canvas></div>' +
      (c.exitLine ? '<div class="legend"><span><i></i>Risk trailing stop</span><span>1-min candles · volume</span></div>' : '<div class="legend"><span>1-min candles · volume</span></div>') +
      '<div class="stats"><div class="stat"><div class="k">Market cap</div><div class="v">' + compact(c.marketCap) + '</div></div><div class="stat"><div class="k">Liquidity</div><div class="v">' + compact(c.liquidity) +
      '</div></div><div class="stat"><div class="k">24h volume</div><div class="v">' + compact(c.volume24h) + '</div></div><div class="stat"><div class="k">Holders</div><div class="v">' + (c.holders == null ? "n/a" : (+c.holders).toLocaleString("en-US")) + "</div></div></div>" +
      (pos ? '<div class="card"><div class="row2"><span>Your position</span><span class="v">' + money(pos.sizeUsd) + ' in · <span class="muted">Executor</span></span></div></div>' : "") +
      (ex ? '<div class="card"><div class="h">Exit</div>' +
        '<div class="row2"><span class="k">Stop line</span><span class="v down">' + price(ex.stopLine) + " · -" + ex.stopPct + "%</span></div>" +
        '<div class="row2"><span class="k">Trail line</span><span class="v ' + (ex.trailActive ? "up" : "") + '">' + (ex.trailActive ? price(ex.trailLine) + " · " + ex.trailPct + "% under peak" : "starts at " + price(ex.trailStartsAt)) + "</span></div>" +
        '<div class="row2"><span class="k">Time left to timeout</span><span class="v">' + Math.floor(ex.timeoutLeftMin / 60) + "h " + (ex.timeoutLeftMin % 60) + "m</span></div></div>" : "") +
      ext(c.link, "Buy on FOMO", "btn green") + ext(c.link, "Sell on FOMO", "btn dark");
    return { html: html, after: function () { DeskChart.candles(document.getElementById("cc"), c.candles, c.exitLine); } };
  }

  function auditScreen(r) {
    var name = "audit/" + r.arg + ".json", a = cache[name], s = cache["state.json"];
    if (missing[name]) return { html: back("#activity", "Back") + '<div class="empty">No coin taken apart yet</div>' };
    if (!a) return null;
    a = Object.assign({}, a, { all: a.layers, layers: a.layers.filter(function (l) { return l.pass !== null; }) });
    var key = a.mint + ":" + a.layers.map(function (l) { return l.n + (l.pass ? "y" : "n"); }).join("");
    var animate = !animated[key] && !reduced;
    var discs = "";
    for (var i = 1; i <= 8; i++) {
      var l = a.layers.filter(function (x) { return x.n === i; })[0];
      var al = a.all.filter(function (x) { return x.n === i; })[0];
      var c = animate ? "" : l ? (l.pass ? "ok" : "red") : (a.done ? "skip" : "");
      discs += '<div class="disc ' + c + '" data-n="' + i + '">' + esc(al ? al.name : "") + "</div>";
    }
    var verdict = !a.done ? '<div class="h">Taking apart...</div><div class="s">' + a.layers.length + " of 8 parts checked</div>"
      : a.passed ? '<div class="h up">Cleared · 8/8 parts</div><div class="s">' + (a.sentUsd != null ? "Sent to Executor · " + money(a.sentUsd) : "Sent to Analyst") + "</div>"
      : '<div class="h down">Rejected · ' + esc(a.reason) + '</div><div class="s">Grok Bot won\'t buy ' + esc(a.label) + "</div>";
    var html = back("#activity", "Back") + fixtureTag(s) + '<div class="coinname">' + esc(a.name || a.label) + '</div><div class="pad muted">Auditor · ' + esc(a.symbol || a.label) + "</div>" +
      '<div class="discs" id="discs">' + discs + '<div class="beamline" id="beam" style="' + (animate || !a.done ? "" : "display:none") + '"></div></div>' +
      '<div class="verdict" id="verdict" style="' + (animate ? "visibility:hidden" : "") + '">' + verdict + "</div>" +
      '<div class="card">' + a.all.map(function (l) { return '<div class="row2"><span class="k">' + l.n + " · " + esc(l.name) + '</span><span class="v ' + (l.pass === null ? "ter" : l.pass ? "up" : "down") + '">' + esc(l.value) + "</span></div>"; }).join("") +
      (a.layers.length ? "" : '<div class="row2"><span class="k">No coin taken apart yet</span></div>') + "</div>" +
      '<div class="card"><div class="row2"><div><div>Take apart before buying</div><div class="hint">read-only · <code>set auditor.enabled</code> in Telegram</div></div><span class="sw-ui ' + (a.auditorEnabled ? "on" : "") + '" role="switch" aria-disabled="true"></span></div></div>' +
      ext(a.link, "Open on FOMO", "btn dark");
    return { html: html, after: function () { beam(a, key, animate); } };
  }
  function beam(a, key, animate) {
    var discs = view.querySelectorAll(".disc"), b = document.getElementById("beam"), box = document.getElementById("discs");
    function at(i) { var d = discs[i]; if (d && b) b.style.top = (d.offsetTop + d.offsetHeight / 2 - 1) + "px"; }
    if (!animate) { if (!a.done) { at(a.layers.length); if (discs[a.layers.length]) discs[a.layers.length].classList.add("beam"); } return; }
    animated[key] = true;
    var i = 0;
    at(0);
    (function next() {
      if (i >= a.layers.length) { // only what the server sent; if not done, the beam waits on the next disc
        if (!a.done) { at(i); if (discs[i]) discs[i].classList.add("beam"); }
        else { if (b) b.style.display = "none"; discs.forEach(function (d, k) { if (k >= a.layers.length) d.classList.add("skip"); }); }
        document.getElementById("verdict").style.visibility = ""; return;
      }
      at(i); discs[i].classList.add("beam");
      setTimeout(function () {
        discs[i].classList.remove("beam"); discs[i].classList.add(a.layers[i].pass ? "ok" : "red");
        setTimeout(function () { i++; next(); }, 150);
      }, 350);
    })();
  }

  function searchOverlay() {
    var s = cache["state.json"] || { coins: [] }, q = ui.q.trim().toLowerCase();
    var res = q ? s.coins.filter(function (c) { return [c.label, c.name, c.symbol, c.mint].some(function (x) { return x && String(x).toLowerCase().indexOf(q) > -1; }); }) : s.coins;
    return '<div class="search" id="search"><div class="bar2"><input id="q" placeholder="Name, symbol or mint" value="' + esc(ui.q) + '" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<button class="cancel" id="cancel">Cancel</button></div><div class="list">' +
      (res.length ? res.slice(0, 40).map(function (c) {
        return '<a class="li tap" href="#' + (c.coin ? "coin/" : "audit/") + c.mint + '"><span class="mid"><div class="t1">' + esc(c.label) + '</div><div class="t2">' + esc(c.mint) + "</div></span></a>";
      }).join("") : '<div class="empty">No coin found</div>') + "</div></div>";
  }

  var toastT;
  function toast(t) {
    var el = document.querySelector(".toast") || document.body.appendChild(Object.assign(document.createElement("div"), { className: "toast" }));
    el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 1600);
  }

  /* ---------- render ---------- */
  var lastRoute = "";
  function render() {
    offlineRow();
    var r = route(), rk = r.name + "/" + (r.arg || "");
    document.querySelectorAll(".tabbar a").forEach(function (a) {
      var t = a.dataset.tab; a.classList.toggle("on", t === r.name || (t === "home" && (r.name === "coin" || r.name === "audit")));
    });
    if (!PATH) {
      view.innerHTML = '<div class="nav"></div><div class="title">Desk</div><div class="list"><div class="empty">No data path on this device yet. Open the desk link from Telegram @mahdi_grokbot once.</div></div>';
      return;
    }
    var fn = { home: home, agents: agentsTab, activity: activityTab, account: accountTab, coin: coinScreen, audit: auditScreen }[r.name] || home;
    var out = fn(r);
    var car = document.getElementById("car"), sl = car ? car.scrollLeft : 0;
    if (!out) { view.innerHTML = skeleton(r.name); }
    else {
      view.innerHTML = out.html + (ui.search ? searchOverlay() : "");
      if (rk === lastRoute && car) { var c2 = document.getElementById("car"); if (c2) c2.scrollLeft = sl; }
      if (out.after) out.after();
      if (ui.search) {
        var q = document.getElementById("q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
        q.oninput = function () { ui.q = q.value; render(); };
        document.getElementById("cancel").onclick = function () { ui.search = false; ui.q = ""; render(); };
      }
    }
    if (rk !== lastRoute && !/^(agents|account)\/./.test(rk)) window.scrollTo(0, 0);
    lastRoute = rk;
  }
  window.addEventListener("hashchange", function () { ui.search = false; ui.actPage = 1; render(); poll(); });
  window.addEventListener("resize", function () { render(); });
  render(); poll();
})();
