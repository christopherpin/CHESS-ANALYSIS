// The puzzle screen, used by both Puzzles (rated) and Drills (endless examples of one pattern).
import { Chess } from "../vendor/chess.js";
import { Board } from "./board.js";
import { markSeen, rating } from "./puzzles.js";
import { THEME_NAME } from "./catalog.js";
import { pref } from "./store.js";
import { esc } from "./ui.js";

const HIDE = new Set(["advantage", "crushing", "equality", "short", "long", "veryLong", "oneMove", "master", "masterVsMaster", "superGM", "mate"]);
const uci = m => m.from + m.to + (m.promotion || "");
const parseUci = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

/**
 * opts: { next(avoidId) => Promise<puzzle>, rated, statsKey, header() => html, lesson }
 */
export function puzzleScreen(page, opts) {
  page.innerHTML = `<div class="play">
    <div class="info"></div>
    <div class="board-wrap"><div class="bd"></div></div>
    <div class="msg info">Loading…</div>
    <div class="ctrls"><button data-a="hint">Hint</button><button data-a="sol">Solution</button><button data-a="next">Skip</button></div>
    <div class="tags"></div>
    ${opts.lesson ? `<div class="dark-prose">${opts.lesson}</div>` : ""}
  </div>`;
  const info = page.querySelector(".info"), msg = page.querySelector(".msg"), tags = page.querySelector(".tags");
  const btn = a => page.querySelector(`[data-a="${a}"]`);
  const board = new Board(page.querySelector(".bd"));
  let pz = null, chess = null, step = 0, failed = false, done = false, busy = false, hintLevel = 0, counted = false, lastDelta = null;
  const stats = pref.get("stats." + (opts.statsKey || "x"), { solved: 0, tried: 0, streak: 0 });

  function say(text, cls = "info") { msg.className = "msg " + cls; msg.innerHTML = text; }
  function head(delta = lastDelta) {
    const r = rating.get();
    const d = delta == null ? "" : `<span class="delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : ""}${delta}</span>`;
    info.innerHTML = opts.rated
      ? `<div class="main"><i>Your rating</i><span class="big">${r.r}</span> ${d}</div><div style="text-align:right"><i>Puzzle</i><b>${done || failed ? pz.rating : "?"}</b></div>`
      : `<div class="main">${opts.header ? opts.header() : ""}</div><div style="text-align:right"><i>Solved</i><b>${stats.solved}/${stats.tried} · streak ${stats.streak}</b></div>`;
  }
  function count(won) {
    if (counted) return null;
    counted = true;
    markSeen(pz.id);
    stats.tried++; if (won) { stats.solved++; stats.streak++; } else stats.streak = 0;
    pref.set("stats." + (opts.statsKey || "x"), stats);
    lastDelta = opts.rated ? rating.update(pz.rating, won) : null;
    return lastDelta;
  }
  const youColor = () => (pz.fen.split(" ")[1] === "w" ? "b" : "w");
  const turnMsg = () => say(`${youColor() === "w" ? "White" : "Black"} to move`, "turn-" + youColor());

  async function load() {
    busy = true; done = false; failed = false; step = 0; hintLevel = 0; counted = false; lastDelta = null;
    tags.innerHTML = ""; board.arrows([]);
    btn("next").textContent = "Skip"; btn("next").classList.remove("hot");
    btn("hint").disabled = btn("sol").disabled = false;
    say(`<span class="spin"></span> Finding a puzzle…`);
    try { pz = await opts.next(pz?.id); window.__pz = pz; }
    catch (e) { say("Puzzle data isn't available yet. It's built automatically on GitHub; check back in a few minutes.", "bad"); busy = false; return; }
    chess = new Chess(pz.fen);
    board.flip(youColor());
    board.movable = null;
    board.set(chess, { animate: false });
    head();
    turnMsg();
    setTimeout(() => {
      const m = chess.move(parseUci(pz.moves[0]));
      step = 1;
      board.set(chess, { lastMove: m });
      board.movable = youColor();
      busy = false;
    }, 600);
  }

  function finish(won) {
    done = true; board.movable = null;
    const delta = count(won);
    head(delta);
    btn("next").textContent = "Next"; btn("next").classList.add("hot");
    btn("hint").disabled = btn("sol").disabled = true;
    tags.innerHTML = pz.themes.filter(t => THEME_NAME[t] && !HIDE.has(t)).map(t => `<span>${esc(THEME_NAME[t])}</span>`).join("") +
      `<span>Lichess #${esc(pz.id)}</span>`;
  }

  function replyThen() {
    if (step >= pz.moves.length) { say(failed ? "Solved, with help." : "Correct! Puzzle solved.", failed ? "info" : "good"); finish(!failed); return; }
    busy = true; board.movable = null;
    setTimeout(() => {
      const m = chess.move(parseUci(pz.moves[step])); step++;
      board.set(chess, { lastMove: m });
      busy = false; board.movable = youColor();
      if (step >= pz.moves.length) replyThen();
    }, 450);
  }

  board.onMove = mv => {
    if (busy || done) return;
    const want = pz.moves[step];
    const m = chess.move(mv);
    if (!m) return;
    const ok = uci(m) === want || chess.isCheckmate();
    board.set(chess, { lastMove: m });
    board.arrows([]);
    if (ok) {
      board.flash(m.to, "right", 500);
      step++;
      if (step < pz.moves.length) say("Best move! Keep going…", "good");
      replyThen();
    } else {
      busy = true;
      board.flash(m.to, "wrong", 650);
      if (!failed) { failed = true; head(count(false)); }
      say("Not the move. Try again.", "bad");
      setTimeout(() => { chess.undo(); board.set(chess, { lastMove: lastOf() }); busy = false; }, 650);
    }
  };
  function lastOf() { const h = chess.history({ verbose: true }); return h[h.length - 1] || null; }

  btn("hint").onclick = () => {
    if (busy || done) return;
    if (!failed) { failed = true; head(count(false)); }
    const m = parseUci(pz.moves[step]);
    hintLevel++;
    if (hintLevel === 1) { board.flash(m.from, "right", 1500); say("Hint: move the highlighted piece.", "info"); }
    else board.arrows([{ from: m.from, to: m.to, color: "rgba(129,182,76,.85)" }]);
  };
  btn("sol").onclick = () => {
    if (busy || done) return;
    if (!failed) { failed = true; head(count(false)); }
    busy = true; board.movable = null;
    const play = () => {
      if (step >= pz.moves.length) { busy = false; say("Here's the solution.", "info"); finish(false); return; }
      const m = chess.move(parseUci(pz.moves[step])); step++;
      board.set(chess, { lastMove: m });
      setTimeout(play, 650);
    };
    play();
  };
  btn("next").onclick = () => { if (!busy) load(); };
  load();
}
