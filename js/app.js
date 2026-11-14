import { createNav, row, sec, esc, toast } from "./ui.js";
import { puzzleScreen } from "./trainer.js";
import { gameViewer } from "./viewer.js";
import * as P from "./puzzles.js";
import { DRILLS, LEVELS, PHASES, prettyOpening } from "./catalog.js";
import { splitPgn, parseGame, gameMoves, timeControlName, reviewGame, buildReport, openingFamily, MOTIFS } from "./analysis.js";
import { pref, idb } from "./store.js";

const DEFAULT_USER = "christopher_pin";
let nav;

/* ====================== Game history (chess.com) ====================== */
const me = () => pref.get("user", DEFAULT_USER);
async function loadHistory() { return (await idb.get("kv", "history:" + me().toLowerCase()).catch(() => null)) || []; }
async function saveHistory(list) { await idb.set("kv", "history:" + me().toLowerCase(), list); }

async function fetchChessCom(user, onProgress) {
  const u = user.toLowerCase();
  const arch = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`).then(r => { if (!r.ok) throw new Error(r.status === 404 ? "No chess.com player with that name." : "chess.com didn't answer (" + r.status + ")."); return r.json(); });
  const urls = arch.archives || [];
  const known = await loadHistory();
  const have = new Set(known.map(g => g.key));
  const doneMonths = new Set(pref.get("months:" + u, []));
  const out = [...known];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    onProgress?.(i, urls.length);
    if (doneMonths.has(url) && i < urls.length - 1) continue; // older months never change
    const data = await fetch(url).then(r => r.json()).catch(() => null);
    if (!data) continue;
    for (const g of data.games || []) {
      if (!g.pgn || (g.rules && g.rules !== "chess")) continue;
      const pg = parseGame(g.pgn); if (!pg) continue;
      pg.key = g.url || pg.key; pg.url = g.url || pg.url; pg.end = g.end_time || 0;
      if (have.has(pg.key)) continue;
      have.add(pg.key); out.push(pg);
    }
    doneMonths.add(url);
  }
  pref.set("months:" + u, [...doneMonths]);
  out.sort((a, b) => (b.end || 0) - (a.end || 0) || String(b.date).localeCompare(String(a.date)));
  await saveHistory(out);
  return out;
}
// games the GitHub workflow saved to the repo: used when chess.com can't be reached
async function fetchFromRepo(user) {
  const r = await fetch(`games/${user.toLowerCase()}.pgn`);
  if (!r.ok) throw new Error("no saved copy");
  const games = splitPgn(await r.text()).map(parseGame).filter(Boolean);
  games.forEach(g => g.end = Date.parse(g.date.replace(/\./g, "-")) / 1000 || 0);
  games.sort((a, b) => b.end - a.end);
  await saveHistory(games);
  return games;
}

function resultFor(g, user) {
  const lc = user.toLowerCase(), w = g.white.toLowerCase() === lc;
  if (g.result === "1/2-1/2") return "d";
  if (g.result === "1-0") return w ? "w" : "l";
  if (g.result === "0-1") return w ? "l" : "w";
  return "d";
}
function gameRow(g, user, i) {
  const lc = user.toLowerCase();
  const mine = g.white.toLowerCase() === lc || g.black.toLowerCase() === lc;
  const white = g.white.toLowerCase() === lc;
  const opp = mine ? (white ? g.black : g.white) : null;
  const oppElo = white ? g.blackElo : g.whiteElo;
  const r = mine ? resultFor(g, user) : "d";
  const title = mine ? `vs ${opp}${oppElo ? ` (${oppElo})` : ""}` : `${g.white} vs ${g.black}`;
  const sub = [timeControlName(g.timeControl), g.opening, g.date].filter(Boolean).join(" · ");
  return row({ title, sub, badge: `<span class="badge ${r}">${mine ? (r === "w" ? "W" : r === "l" ? "L" : "½") : g.result === "1-0" ? "1-0" : g.result === "0-1" ? "0-1" : "½"}</span>`, attrs: `data-g="${i}"` });
}

function historyRoot() {
  return {
    title: "Game History", short: "History",
    right: { label: "View Gameplay Analysis", cls: "hot", onClick: () => nav.push(analysisPage()) },
    render(el, page) {
      let games = [];
      const draw = () => {
        const user = me();
        let h = `<div class="group"><div class="field"><label>chess.com</label><input class="user" value="${esc(user)}" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="username"></div></div>
          <button class="btn sync">${games.length ? "Check for new games" : "Import my games"}</button>`;
        if (games.length) {
          const s = { w: 0, l: 0, d: 0 }; games.forEach(g => s[resultFor(g, user)]++);
          h += row({ title: "Custom report", sub: "Pick how many games to review", attrs: 'data-a="report"' }) +
            row({ title: "Openings I play", sub: "Your results by opening", attrs: 'data-a="openings"' });
          h += `<div class="note">${games.length} games · ${s.w} won, ${s.l} lost, ${s.d} drawn</div>`;
          let month = "";
          games.slice(0, 400).forEach((g, i) => {
            const m = (g.date || "").slice(0, 7);
            if (m !== month) { month = m; h += sec(monthName(m)); }
            h += gameRow(g, user, i);
          });
          if (games.length > 400) h += `<div class="note">Showing your latest 400 games.</div>`;
        } else h += `<div class="empty">No games yet<p>Enter your chess.com username and tap Import. Everything stays on this phone.</p></div>`;
        el.innerHTML = h;
      };
      el.addEventListener("click", async e => {
        const t = e.target;
        if (t.classList.contains("sync")) {
          const user = el.querySelector(".user").value.trim();
          if (!user) return;
          pref.set("user", user);
          t.disabled = true; t.innerHTML = `<span class="spin"></span> Contacting chess.com…`;
          try { games = await fetchChessCom(user, (i, n) => t.innerHTML = `<span class="spin"></span> Month ${i + 1} of ${n}…`); }
          catch (err) {
            try { games = await fetchFromRepo(user); toast("Loaded the saved copy of your games."); }
            catch { toast(err.message || "Couldn't reach chess.com."); }
          }
          draw(); return;
        }
        const r = t.closest(".row"); if (!r) return;
        if (r.dataset.a === "report") return nav.push(reportPage(games));
        if (r.dataset.a === "openings") return nav.push(openingsPage(games));
        if (r.dataset.g) { const g = games[+r.dataset.g]; nav.push(viewerPage(g)); }
      });
      loadHistory().then(g => { games = g; draw(); });
      draw();
    },
  };
}
function monthName(m) {
  if (!m) return "Undated";
  const [y, mo] = m.split(/[.-]/).map(Number);
  if (!mo) return String(y);
  return new Date(y, mo - 1, 1).toLocaleString([], { month: "long", year: "numeric" });
}

function viewerPage(g, opts = {}) {
  const lc = me().toLowerCase();
  const title = g.white.toLowerCase() === lc ? "vs " + g.black : g.black.toLowerCase() === lc ? "vs " + g.white : g.white + " v " + g.black;
  return { title, short: "Game", ...opts.page,
    render(el, page) {
      idb.get("analysis", g.key + "|d13").catch(() => null).then(cached => { gameViewer(el, g, { me: me(), autoReview: !!cached, startPly: opts.ply }); });
    } };
}

/* ---------- the weakness report ---------- */
function reportPage(allGames) {
  return { title: "My Biggest Holes", short: "Report",
    render(el) {
      const user = me();
      const isMine = g => [g.white, g.black].some(n => n.toLowerCase() === user.toLowerCase()) && g.plies >= 10;
      const pick = () => allGames.filter(g => isMine(g) && (pref.get("reportBullet", false) || !/^Bullet/.test(timeControlName(g.timeControl))));
      let mine = pick();
      const N = pref.get("reportN", 30);
      el.innerHTML = `<div class="prose"><p>The engine checks every move you made in your most recent games, then groups your mistakes by type so you know what to train. Reviews are saved, so the next report is faster.</p></div>
        <div class="seg n">${[20, 30, 50, 100].map(n => `<div data-n="${n}" class="${n === N ? "on" : ""}">${n} games</div>`).join("")}</div>
        <div class="group"><div class="field"><label>Include bullet games</label><input type="checkbox" class="bul" ${pref.get("reportBullet", false) ? "checked" : ""} style="flex:none;width:22px;height:22px"></div></div>
        <button class="btn go">Analyze my latest games</button>
        <div class="note">Your newest games count most, and older ones fade out (half weight every 3 months), so habits you've already fixed don't show up. Rapid counts more than blitz, blitz more than bullet. Games where you got checkmated count extra; games lost on time count less, and errors made with almost no clock left are listed separately as time trouble.</div>
        <div class="out"></div>`;
      el.querySelector(".bul").onchange = e => { pref.set("reportBullet", e.target.checked); mine = pick(); };
      const out = el.querySelector(".out");
      let running = false;
      el.querySelector(".seg").onclick = e => { const n = e.target.dataset.n; if (!n || running) return; pref.set("reportN", +n); el.querySelectorAll(".seg div").forEach(d => d.classList.toggle("on", d === e.target)); };
      const saved = pref.get("report:" + user.toLowerCase());
      if (saved) renderReport(out, saved, mine);
      el.querySelector(".go").onclick = async () => {
        if (running) return; running = true;
        const n = pref.get("reportN", 30), games = mine.slice(0, n);
        out.innerHTML = `<div class="progress"><div style="width:0"></div><span>Starting the engine…</span></div><div class="note">You can leave this screen open; it takes about 10–20 seconds per game on a phone.</div>`;
        const bar = out.querySelector(".progress div"), lab = out.querySelector(".progress span");
        const reviews = [];
        for (let i = 0; i < games.length; i++) {
          reviews.push(await reviewGame(games[i], { depth: 11, onProgress: (k, m) => {
            const f = (i + k / m) / games.length; bar.style.width = f * 100 + "%"; lab.textContent = `Game ${i + 1} of ${games.length} · ${Math.round(f * 100)}%`;
          } }).catch(() => null));
        }
        const rep = buildReport(games, reviews, user);
        rep.keys = games.map(g => g.key); rep.at = Date.now();
        pref.set("report:" + user.toLowerCase(), rep);
        running = false;
        renderReport(out, rep, mine);
      };
    } };
}

function renderReport(out, rep, games) {
  const byKey = new Map(games.map(g => [g.key, g]));
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const phaseName = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
  const worstPhase = [...rep.phases].filter(p => p.moves > 20).sort((a, b) => (a.acc ?? 100) - (b.acc ?? 100))[0];
  let h = `<div class="stat"><div><b>${rep.games}</b><i>games</i></div><div><b>${pct(rep.wins, rep.games)}%</b><i>won</i></div><div><b>${rep.accuracy ?? "–"}%</b><i>accuracy</i></div><div><b>${(rep.errors / Math.max(1, rep.games)).toFixed(1)}</b><i>errors/game</i></div></div>`;
  h += sec("Where you lose points");
  const top = rep.holes.slice(0, 6), maxN = Math.max(1e-9, ...top.map(x => x.score ?? x.n));
  for (const x of top) {
    const ex = (rep.examples[x.key] || []).slice(0, 3).map(({ gi, ply }) => ({ g: byKey.get(rep.keys[gi]), ply })).filter(e => e.g);
    h += `<div class="hole"><b>${esc(x.name)}</b> <span style="color:#7b7b7b;font-size:13px">${x.n}× · ${x.perGame.toFixed(1)} per game</span>
      <div class="bar"><div style="width:${(x.score ?? x.n) / maxN * 100}%"></div></div>
      <p>${esc(x.why)}</p>
      <span class="train" data-drill="${x.drill}">Train: ${esc(DRILLS[x.drill]?.name || x.drill)}</span>
      ${ex.map((e, k) => `<span class="train" style="background:#888" data-key="${esc(e.g.key)}" data-ply="${e.ply}">Example ${k + 1}</span>`).join(" ")}</div>`;
  }
  h += sec("By phase of the game");
  for (const p of rep.phases) h += `<div class="hole"><b>${phaseName[p.key]}</b> <span style="color:#7b7b7b;font-size:13px">accuracy ${p.acc ?? "–"}% · ${p.blunders} blunders, ${p.mistakes} mistakes</span>
      <div class="bar"><div style="width:${Math.min(100, p.errPerGame / 3 * 100)}%"></div></div></div>`;
  if (worstPhase) h += `<div class="note">Your weakest phase is the <b>${phaseName[worstPhase.key].toLowerCase()}</b>. <span class="train" data-drill="${worstPhase.key}">Train ${phaseName[worstPhase.key].toLowerCase()} tactics</span></div>`;
  h += sec("Other patterns");
  h += `<div class="hole"><b>Winning positions you didn't win</b><p>${rep.thrown} of ${rep.games} games: you were clearly winning (85%+) and drew or lost. ${rep.thrown >= rep.games * 0.15 ? "That's a lot: slow down once you're ahead, and practice finishing with the endgame drills." : ""}</p></div>`;
  h += `<div class="hole"><b>Time trouble</b><p>${rep.timeTrouble} of your ${rep.errors} big errors came with under 10% of your clock left${rep.timeLosses != null ? `, and ${rep.timeLosses} of your ${rep.losses} losses were on time (${rep.matedGames} by checkmate)` : ""}. ${rep.timeTrouble > rep.errors * 0.3 ? "Your clock is costing you games: play your opening and simple moves faster." : ""}</p></div>`;
  const op = rep.openings.filter(o => o.n >= 3).sort((a, b) => a.score - b.score).slice(0, 4);
  if (op.length) {
    h += sec("Openings that go badly");
    for (const o of op) h += `<div class="hole"><b>${esc(o.name)}</b> <span style="color:#7b7b7b;font-size:13px">${o.n} games · ${o.w}W ${o.l}L ${o.d}D · first-10-move accuracy ${o.acc ?? "–"}%</span></div>`;
  }
  h += `<div class="note">Report from ${new Date(rep.at).toLocaleDateString()} · engine: Stockfish 18 at depth 11</div>`;
  out.innerHTML = h;
  out.onclick = e => {
    const d = e.target.dataset;
    if (d.drill) { nav.setTab("drills"); nav.popToRoot(); setTimeout(() => nav.push(drillIntro("theme", d.drill, "mine")), 50); }
    if (d.key) { const g = byKey.get(d.key); if (g) nav.push(viewerPage(g, { ply: +d.ply + 1 })); }
  };
}

function openingsPage(games) {
  return { title: "My Openings", short: "Openings",
    render(el) {
      const user = me().toLowerCase(), stats = {};
      for (const g of games) {
        const w = g.white.toLowerCase() === user, b = g.black.toLowerCase() === user; if (!w && !b) continue;
        const k = openingFamily(g.opening) + (w ? " · White" : " · Black");
        const s = stats[k] ||= { n: 0, w: 0, l: 0, d: 0 }; s.n++; s[resultFor(g, user)]++;
      }
      const list = Object.entries(stats).sort((a, b) => b[1].n - a[1].n);
      el.innerHTML = `<div class="note">Win rate by opening, all imported games</div>` + list.map(([k, s]) =>
        row({ title: k, sub: `${s.n} games · ${s.w}W ${s.l}L ${s.d}D`, val: Math.round((s.w + s.d / 2) / s.n * 100) + "%", go: false, cls: "static" })).join("");
    } };
}

/* ---------- gameplay analysis: the written report, refreshed with new games ---------- */
// The first report was made from 270 games and saved with the site (data/analysis/<user>.json).
// Each refresh reviews the rapid and blitz games played since the last report and compares.
const HOLE_NAME = k => MOTIFS[k]?.name || k;
const snapsKey = () => "snapshots:" + me().toLowerCase();
async function loadSnaps() { return (await idb.get("kv", snapsKey()).catch(() => null)) || []; }
async function loadBaseline() {
  const r = await fetch(`data/analysis/${me().toLowerCase()}.json`).catch(() => null);
  return r && r.ok ? r.json() : null;
}
function slimReport(rep) {
  return { games: rep.games, wins: rep.wins, losses: rep.losses, draws: rep.draws, accuracy: rep.accuracy,
    errorsPerGame: rep.errors / Math.max(1, rep.games), thrown: rep.thrown, timeTrouble: rep.timeTrouble, errors: rep.errors,
    matedGames: rep.matedGames, timeLosses: rep.timeLosses,
    holes: rep.holes.map(h => ({ key: h.key, n: h.n, perGame: h.perGame, score: h.score })),
    phases: rep.phases.map(p => ({ key: p.key, acc: p.acc, errPerGame: p.errPerGame })),
    examples: Object.fromEntries(Object.entries(rep.examples).map(([k, v]) => [k, v.slice(0, 3).map(e => ({ key: rep.keys[e.gi], ply: e.ply }))])) };
}
// a change of 20% or more either way counts; anything smaller is standing still
function trend(before, now, n) {
  if (n < 8) return { cls: "na", word: "Too few games" };
  if (before < 0.02 && now < 0.02) return { cls: "up", word: "Rare" };
  if (before < 0.02) return { cls: "down", word: "New problem" };
  const r = now / before;
  return r <= 0.8 ? { cls: "up", word: "Improving" } : r >= 1.2 ? { cls: "down", word: "Worse" } : { cls: "flat", word: "Stagnating" };
}
function verdictOf(prev, cur) {
  const top = prev.holes.slice(0, 3).map(h => h.key);
  const nowPer = Object.fromEntries(cur.holes.map(h => [h.key, h.perGame]));
  const t = top.map(k => trend(prev.holes.find(h => h.key === k).perGame, nowPer[k] || 0, cur.games).cls);
  const e = trend(prev.errorsPerGame, cur.errorsPerGame, cur.games).cls;
  const ups = t.filter(x => x === "up").length + (e === "up"), downs = t.filter(x => x === "down").length + (e === "down");
  if (cur.games < 8) return { cls: "na", word: "Not enough new games yet", sub: `Only ${cur.games} new rapid or blitz game${cur.games === 1 ? "" : "s"}. Play at least 8 for a fair comparison.` };
  if (ups >= 2 && downs === 0) return { cls: "up", word: "You're learning your lessons", sub: "Your biggest holes are showing up less often than in the last report." };
  if (downs >= 2) return { cls: "down", word: "Slipping", sub: "Your biggest holes are showing up more often than before. Go back to the drills for the ones marked Worse." };
  return { cls: "flat", word: "Stagnating", sub: "Your error rates are about the same as last time. Keep at the drills for the holes marked Stagnating." };
}

function analysisPage() {
  return { title: "Gameplay Analysis", short: "Analysis",
    render(el) {
      let base = null, snaps = [], busy = false;
      const draw = () => {
        if (!base) { el.innerHTML = `<div class="empty">No report yet<p>Tap Refresh to review your recent games.</p></div><button class="btn refresh">Refresh analysis</button>`; return; }
        const latest = snaps[snaps.length - 1];
        const prev = snaps.length > 1 ? snaps[snaps.length - 2].report : base.overall;
        const cur = latest ? latest.report : base.overall;
        const fmtD = t => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
        let h = "";
        if (latest) {
          const v = latest.verdict;
          h += `<div class="verdict"><div class="k">Since ${snaps.length > 1 ? "your last refresh" : "the first report"} · ${latest.report.games} new games</div>
            <div class="v ${v.cls}">${esc(v.word)}</div><p>${esc(v.sub)}</p></div>`;
        } else h += `<div class="prose"><p>${esc(base.bottomLine)}</p></div>`;
        h += `<button class="btn refresh">${busy ? "Working…" : "Refresh analysis"}</button>
          <div class="note">Pulls your newest games from chess.com, reviews the rapid and blitz games played since ${latest ? fmtD(latest.lastGameEnd * 1000) : fmtD(base.lastGameEnd * 1000)}, and compares them with the report before.</div><div class="work"></div>`;
        h += `<div class="stat"><div><b>${cur.games}</b><i>games</i></div><div><b>${Math.round(cur.wins / Math.max(1, cur.games) * 100)}%</b><i>won</i></div><div><b>${cur.accuracy ?? "–"}%</b><i>accuracy</i></div><div><b>${cur.errorsPerGame.toFixed(1)}</b><i>errors/game</i></div></div>`;
        // comparison table
        if (latest) {
          const keys = [...new Set([...prev.holes.slice(0, 5).map(x => x.key), ...cur.holes.slice(0, 3).map(x => x.key)])];
          const pg = (rep, k) => rep.holes.find(x => x.key === k)?.perGame || 0;
          h += sec("Are the holes closing?") + `<table class="cmp"><tr><th>Hole</th><th>Before</th><th>Now</th><th></th></tr>` +
            `<tr><td>All big errors</td><td>${prev.errorsPerGame.toFixed(2)}</td><td>${cur.errorsPerGame.toFixed(2)}</td><td><span class="pill ${trend(prev.errorsPerGame, cur.errorsPerGame, cur.games).cls}">${trend(prev.errorsPerGame, cur.errorsPerGame, cur.games).word}</span></td></tr>` +
            keys.map(k => { const b = pg(prev, k), n = pg(cur, k), t = trend(b, n, cur.games); return `<tr><td>${esc(HOLE_NAME(k))}</td><td>${b.toFixed(2)}</td><td>${n.toFixed(2)}</td><td><span class="pill ${t.cls}">${t.word}</span></td></tr>`; }).join("") +
            `</table><div class="note">Errors per game. Improving means at least 20% less often than in the report before; Worse means 20% more.</div>`;
        }
        // the holes
        h += sec(latest ? "Biggest holes now" : "Biggest holes");
        if (!latest) h += `<div class="prose"><p>${esc(base.habit)}</p></div>`;
        const maxS = Math.max(1e-9, ...cur.holes.slice(0, 6).map(x => x.score));
        for (const x of cur.holes.slice(0, 6)) {
          const m = MOTIFS[x.key] || {};
          const exBase = !latest ? (base.examples[x.key] || []) : [];
          const exNew = latest ? (latest.report.examples?.[x.key] || []) : [];
          h += `<div class="hole"><b>${esc(HOLE_NAME(x.key))}</b> <span style="color:var(--muted);font-size:12px">${x.n}× · ${x.perGame.toFixed(2)} per game</span>
            <div class="bar"><div style="width:${x.score / maxS * 100}%"></div></div><p>${esc(m.why || "")}</p>
            ${m.drill ? `<span class="train" data-drill="${m.drill}">Train: ${esc(DRILLS[m.drill]?.name || m.drill)}</span>` : ""}
            ${exNew.map((e, k) => `<span class="train" data-key="${esc(e.key)}" data-ply="${e.ply}">Example ${k + 1}</span>`).join("")}
            ${exBase.map(e => `<br><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.label)}</a>`).join("")}</div>`;
        }
        if (!latest) h += `<ul class="bullets">${base.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
        h += sec("By phase of the game");
        const pn = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
        h += `<table class="cmp"><tr><th>Phase</th><th>Accuracy</th><th>Errors/game</th></tr>` + cur.phases.map(p => `<tr><td>${pn[p.key]}</td><td>${p.acc ?? "–"}%</td><td>${p.errPerGame.toFixed(2)}</td></tr>`).join("") + `</table>`;
        h += sec("Openings, last 12 months (first report)") + `<table class="cmp"><tr><th>Opening</th><th>Side</th><th>Games</th><th>Score</th></tr>` +
          base.openings.map(o => `<tr><td>${esc(o[0])}</td><td>${o[1]}</td><td>${o[2]}</td><td>${o[4]}%</td></tr>`).join("") + `</table>` +
          `<ul class="bullets">${base.openingNotes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
        h += sec("Clock") + `<ul class="bullets">${base.clock.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
        if (latest) h += `<div class="note">This refresh: ${latest.report.timeTrouble} of ${latest.report.errors} big errors with under 10% of the clock; ${latest.report.timeLosses} of ${latest.report.losses} losses on time, ${latest.report.matedGames} by checkmate.</div>`;
        h += sec("Training plan") + `<ol class="plan">${base.plan.map(([a, b]) => `<li><b>${esc(a)}</b>${esc(b)}</li>`).join("")}</ol>`;
        h += sec("Report history") + row({ title: "First report", sub: `${base.overall.games} games · ${base.overall.errorsPerGame.toFixed(2)} errors/game · accuracy ${base.overall.accuracy}%`, val: base.made, go: false, cls: "static" }) +
          snaps.slice().reverse().map(sn => row({ title: sn.verdict.word, sub: `${sn.report.games} new games · ${sn.report.errorsPerGame.toFixed(2)} errors/game · accuracy ${sn.report.accuracy ?? "–"}%`, val: fmtD(sn.at), go: false, cls: "static" })).join("");
        h += `<div class="note">${esc(base.sample)} Weighting: recent games count most, rapid over blitz over bullet, checkmate losses extra, time losses less.</div>`;
        el.innerHTML = h;
      };

      async function refresh() {
        if (busy) return; busy = true; draw();
        const work = el.querySelector(".work");
        const say = t => work.innerHTML = `<div class="progress"><div style="width:${t.pct || 0}%"></div><span>${esc(t.text)}</span></div>`;
        try {
          say({ text: "Getting your newest games…" });
          let games;
          try { games = await fetchChessCom(me(), (i, n) => say({ text: `chess.com: month ${i + 1} of ${n}`, pct: (i + 1) / n * 100 })); }
          catch { try { games = await fetchFromRepo(me()); } catch { games = await loadHistory(); } }
          const lc = me().toLowerCase();
          const prevSnap = snaps[snaps.length - 1];
          const since = prevSnap ? prevSnap.lastGameEnd : (base?.lastGameEnd || 0);
          const pool = games.filter(g => [g.white, g.black].some(n => n.toLowerCase() === lc) && g.plies >= 10 && !/^Bullet/.test(timeControlName(g.timeControl)) && (g.end || 0) > since)
            .sort((a, b) => (b.end || 0) - (a.end || 0));
          if (!pool.length) { work.innerHTML = `<div class="note" style="color:var(--rank)">No new rapid or blitz games since the last report. Play a few and refresh again.</div>`; busy = false; el.querySelector(".refresh").textContent = "Refresh analysis"; return; }
          const pick = pool.slice(0, 50), reviews = [];
          for (let i = 0; i < pick.length; i++) {
            reviews.push(await reviewGame(pick[i], { depth: 11, onProgress: (k, m) => say({ text: `Reviewing game ${i + 1} of ${pick.length}`, pct: (i + k / m) / pick.length * 100 }) }).catch(() => null));
          }
          const rep = buildReport(pick, reviews, me()); rep.keys = pick.map(g => g.key);
          const report = slimReport(rep);
          const prev = prevSnap ? prevSnap.report : base?.overall;
          if (!prev) { // no saved first report for this player: this refresh becomes it
            base = { made: new Date().toISOString().slice(0, 10), lastGameEnd: Math.max(...pool.map(g => g.end || 0)), overall: report, sample: `${pick.length} most recent rapid and blitz games, Stockfish 18 at depth 11.`,
              bottomLine: "Your first report. Refresh after more games to see whether the holes are closing.", habit: "", examples: {}, notes: [], openings: [], openingNotes: [], clock: [], plan: [] };
            await idb.set("kv", snapsKey() + ":base", base);
            busy = false; draw(); return;
          }
          snaps.push({ at: Date.now(), lastGameEnd: Math.max(...pool.map(g => g.end || 0)), report, verdict: verdictOf(prev, report), reviewed: pick.length, newGames: pool.length });
          await idb.set("kv", snapsKey(), snaps);
        } catch (e) { toast("Refresh failed: " + (e.message || e)); }
        busy = false; draw();
      }

      el.addEventListener("click", async e => {
        if (e.target.classList.contains("refresh")) return refresh();
        const d = e.target.dataset;
        if (d.drill) { nav.setTab("drills"); nav.popToRoot(); setTimeout(() => nav.push(drillIntro("theme", d.drill, "mine")), 50); }
        if (d.key) { const g = (await loadHistory()).find(x => x.key === d.key); if (g) nav.push(viewerPage(g, { ply: +d.ply + 1 })); }
      });
      el.innerHTML = `<div class="empty"><span class="spin"></span></div>`;
      Promise.all([loadBaseline(), loadSnaps(), idb.get("kv", snapsKey() + ":base").catch(() => null)]).then(([b, s, local]) => { base = b || local; snaps = s; draw(); });
    } };
}

/* ====================== Saved games ====================== */
async function savedList() { return (await idb.get("kv", "saved").catch(() => null)) || []; }
function savedRoot() {
  return {
    title: "Saved Games", short: "Saved",
    render(el, page) {
      const draw = async () => {
        const list = await savedList();
        el.innerHTML = row({ title: "Add games", sub: "Paste PGN or open a .pgn file", attrs: 'data-a="add"' }) +
          (list.length ? sec(`${list.length} saved`) + list.map((g, i) => row({ title: `${g.white} vs ${g.black}`, sub: [g.result, g.event, g.date, g.note].filter(Boolean).join(" · "), attrs: `data-g="${i}"` })).join("")
            : `<div class="empty">Nothing saved yet<p>Add your own over-the-board games, or famous games from books and websites. Any PGN works.</p></div>`);
        page.list = list;
      };
      page.onShow = draw;
      el.addEventListener("click", e => {
        const r = e.target.closest(".row"); if (!r) return;
        if (r.dataset.a === "add") nav.push(addPage());
        if (r.dataset.g) {
          const i = +r.dataset.g, g = page.list[i];
          nav.push(viewerPage(g, { page: { right: { label: "Delete", onClick: async () => {
            if (!confirmDelete()) return;
            const l = await savedList(); l.splice(l.findIndex(x => x.key === g.key), 1); await idb.set("kv", "saved", l); nav.pop();
          } } } }));
        }
      });
      draw();
    },
  };
}
let delArmed = 0;
function confirmDelete() { if (Date.now() - delArmed < 3000) return true; delArmed = Date.now(); toast("Tap Delete again to remove this game"); return false; }

function addPage() {
  return { title: "Add Games", short: "Add",
    render(el) {
      el.innerHTML = `<textarea placeholder='[Event "My club game"]\n[White "Me"]\n[Black "Opponent"]\n\n1. e4 e5 2. Nf3 Nc6 ...\n\nPaste one game or many. Plain moves without headers also work.'></textarea>
        <div class="group"><div class="field"><label>Note</label><input class="note-in" placeholder="e.g. from My System, ch. 3"></div></div>
        <button class="btn save">Save</button>
        <label class="btn grey" style="text-align:center;line-height:42px">Open a .pgn file<input type="file" accept=".pgn,.txt,text/plain" multiple hidden></label>
        <div class="note">Games are saved on this phone. Tip: on chess.com, any game's Share → PGN button gives you text to paste here.</div>`;
      const ta = el.querySelector("textarea");
      el.querySelector("input[type=file]").onchange = async e => {
        let t = ""; for (const f of e.target.files) t += (await f.text()) + "\n\n";
        ta.value = (ta.value ? ta.value + "\n\n" : "") + t.trim();
        toast(`Loaded ${e.target.files.length} file(s). Tap Save.`);
      };
      el.querySelector(".save").onclick = async () => {
        const note = el.querySelector(".note-in").value.trim();
        const parts = splitPgn(ta.value);
        const valid = p => { try { gameMoves(p); return true; } catch { return false; } };
        const games = parts.filter(valid).map(p => parseGame(p)).filter(Boolean);
        const bad = parts.length - games.length;
        if (bad) toast(`${bad} game${bad > 1 ? "s" : ""} couldn't be read and were skipped.`);
        if (!games.length) { toast("Couldn't read that as a game. Check the PGN."); return; }
        games.forEach(g => { g.note = note; g.added = Date.now(); if (!/^g|http/.test(g.key)) g.key = "s" + g.key; });
        const list = await savedList();
        const have = new Set(list.map(g => g.key));
        const add = games.filter(g => !have.has(g.key));
        await idb.set("kv", "saved", [...add, ...list]);
        toast(`Saved ${add.length} game${add.length === 1 ? "" : "s"}${games.length > add.length ? ` (${games.length - add.length} already saved)` : ""}`);
        nav.pop();
      };
    } };
}

/* ====================== Drills ====================== */
function drillsRoot() {
  return {
    title: "Drills",
    render(el) {
      let mode = pref.get("drillMode", "level");
      const draw = async () => {
        let idx = null;
        try { idx = await P.index(); } catch {}
        const has = k => !idx || idx.theme[k];
        const item = k => has(k) ? row({ title: DRILLS[k].name, sub: DRILLS[k].blurb, val: solvedOf("theme:" + k), attrs: `data-k="${k}"` }) : "";
        let h = `<div class="seg">${[["level", "Skill level"], ["phase", "Game phase"], ["opening", "Openings"], ["mates", "Mates"]].map(([k, n]) => `<div data-m="${k}" class="${k === mode ? "on" : ""}">${n}</div>`).join("")}</div>`;
        if (!idx) h += `<div class="note">The puzzle library is still being built. Drills will fill in automatically.</div>`;
        if (mode === "level") for (const L of LEVELS) {
          h += sec(L.name) + `<div class="note" style="text-align:left;margin:6px 10px">${L.sub}</div>`;
          h += Object.keys(DRILLS).filter(k => DRILLS[k].lvl === L.n && !DRILLS[k].mate).map(item).join("");
        }
        if (mode === "phase") for (const ph of PHASES) h += sec(ph.name) + ph.themes.map(item).join("");
        if (mode === "mates") {
          h += sec("Checkmates") + ["mateIn1", "mateIn2", "mateIn3", "backRankMate", "smotheredMate"].map(item).join("");
          h += sec("Named mating patterns") + Object.keys(DRILLS).filter(k => DRILLS[k].mate).map(item).join("");
        }
        if (mode === "opening") {
          if (!idx) h += "";
          else {
            const list = Object.entries(idx.opening).sort((a, b) => b[1].available - a[1].available);
            h += `<div class="note">Tactics that come straight out of each book opening, taken from real games.</div>`;
            h += sec("Book openings") + list.map(([k, v]) => row({ title: prettyOpening(k), sub: `${v.available.toLocaleString()} puzzles in the database`, val: solvedOf("opening:" + k), attrs: `data-o="${k}"` })).join("");
          }
        }
        el.innerHTML = h;
      };
      el.addEventListener("click", e => {
        const m = e.target.dataset.m;
        if (m) { mode = m; pref.set("drillMode", m); draw(); return; }
        const r = e.target.closest(".row"); if (!r) return;
        if (r.dataset.k) nav.push(drillIntro("theme", r.dataset.k));
        if (r.dataset.o) nav.push(drillIntro("opening", r.dataset.o));
      });
      draw();
    },
  };
}
function solvedOf(key) { const s = pref.get("stats." + key); return s && s.tried ? `${s.solved}/${s.tried}` : null; }

const RANGES = [
  { k: "mine", name: "My level", f: r => [r - 250, r + 250] },
  { k: "b", name: "Beginner", f: () => [400, 1100] },
  { k: "i", name: "Intermediate", f: () => [1100, 1600] },
  { k: "a", name: "Advanced", f: () => [1600, 2100] },
  { k: "e", name: "Expert", f: () => [2100, 3200] },
];
function drillIntro(kind, key, forceRange) {
  const d = kind === "theme" ? DRILLS[key] : { name: prettyOpening(key), blurb: "Tactics from this opening", lesson: `Every puzzle here comes from a real game that opened with the ${prettyOpening(key)}. You'll start to recognise the typical traps and tactical ideas of the structure.` };
  return { title: d.name, short: "Drill",
    render(el) {
      const defLvl = d.lvl ? ["b", "i", "a"][d.lvl - 1] : "mine";
      let rk = forceRange || pref.get(`range:${kind}:${key}`, defLvl);
      el.innerHTML = `<div class="prose"><h3>${esc(d.name)}</h3><p>${esc(d.blurb)}</p><p>${esc(d.lesson)}</p></div>
        ${sec("Difficulty")}<div class="seg">${RANGES.map(r => `<div data-r="${r.k}" class="${r.k === rk ? "on" : ""}">${r.name.replace("Intermediate", "Inter.")}</div>`).join("")}</div>
        <div class="note rng"></div><button class="btn green start">Start drill</button>
        <div class="note">Endless examples. Each one is a real position where this pattern wins.</div>`;
      const rng = () => RANGES.find(r => r.k === rk).f(P.rating.get().r).map(x => Math.max(300, Math.round(x)));
      const label = () => { const [a, b] = rng(); el.querySelector(".rng").textContent = `Puzzles rated ${a}–${b}`; };
      label();
      el.querySelector(".seg").onclick = e => { const r = e.target.dataset.r; if (!r) return; rk = r; pref.set(`range:${kind}:${key}`, r); el.querySelectorAll(".seg div").forEach(x => x.classList.toggle("on", x === e.target)); label(); };
      el.querySelector(".start").onclick = () => {
        const [lo, hi] = rng();
        nav.push({ title: d.name, short: "Drill", render(pg) {
          puzzleScreen(pg, { statsKey: `${kind}:${key}`, header: () => `<b>${esc(d.name)}</b><i>${lo}–${hi}</i>`,
            next: avoid => P.byGroup(kind, key, lo, hi, avoid), lesson: `<b>The idea:</b> ${esc(d.lesson)}` });
        } });
      };
    } };
}

/* ====================== Puzzles ====================== */
function puzzlesRoot() {
  return {
    title: "Puzzles",
    render(el, page) {
      const draw = () => {
        const r = P.rating.get(), s = pref.get("stats.rated", { solved: 0, tried: 0, streak: 0 });
        el.innerHTML = row({ title: "Rated puzzles", sub: `${s.tried} played · ${s.tried ? Math.round(s.solved / s.tried * 100) : 0}% solved · streak ${s.streak}`, val: r.r, attrs: 'data-a="rated"' }) +
          sec("Practice at a rating (unrated)") +
          [[400, 800], [800, 1200], [1200, 1600], [1600, 2000], [2000, 2400], [2400, 3200]].map(([a, b]) =>
            row({ title: `${a} – ${b}`, sub: a < 800 ? "Beginner" : a < 1200 ? "Novice" : a < 1600 ? "Intermediate" : a < 2000 ? "Advanced" : a < 2400 ? "Expert" : "Master", val: solvedOf(`band:${a}`), attrs: `data-lo="${a}" data-hi="${b}"` })).join("") +
          sec("Settings") +
          `<div class="group"><div class="field"><label>My puzzle rating</label><input class="pr" type="number" inputmode="numeric" value="${r.r}"></div></div>
           <div class="note">Set this to your chess.com puzzle rating and the rated puzzles start at the same level. Puzzles come from the Lichess open database (millions of real-game positions), rated on a scale close to chess.com's.</div>`;
        el.querySelector(".pr").onchange = e => { const v = parseInt(e.target.value); if (v >= 100 && v <= 3500) { P.rating.set(v); toast("Puzzle rating set to " + v); draw(); } };
      };
      page.onShow = draw;
      el.addEventListener("click", e => {
        const r = e.target.closest(".row"); if (!r) return;
        if (r.dataset.a === "rated") nav.push({ title: "Rated", short: "Puzzles", render(pg) {
          puzzleScreen(pg, { rated: true, statsKey: "rated", next: avoid => P.byRating(P.rating.get().r, avoid) });
        } });
        if (r.dataset.lo) {
          const lo = +r.dataset.lo, hi = +r.dataset.hi;
          nav.push({ title: `${lo}–${hi}`, short: "Puzzles", render(pg) {
            puzzleScreen(pg, { statsKey: `band:${lo}`, header: () => `<b>Puzzles ${lo}–${hi}</b><i>Unrated practice</i>`,
              next: async avoid => P.byRating(lo + Math.random() * (hi - lo), avoid) });
          } });
        }
      });
      draw();
    },
  };
}

/* ====================== start ====================== */
nav = createNav({
  root: document.getElementById("app"),
  tabs: [
    { key: "history", label: "History", root: historyRoot() },
    { key: "saved", label: "Saved", root: savedRoot() },
    { key: "drills", label: "Drills", root: drillsRoot(), sep: true },
    { key: "puzzles", label: "Puzzles", root: puzzlesRoot() },
  ],
  initial: pref.get("tab", "history"),
});
