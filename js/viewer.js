// Play through a game with engine review: eval bar, tagged moves, best-move arrows,
// and free exploration from any position.
import { Chess } from "../vendor/chess.js";
import { Board } from "./board.js";
import { analyse, fmtScore, winPct } from "./engine.js";
import { gameMoves, reviewGame } from "./analysis.js";
import { esc } from "./ui.js";

const LABEL = { blunder: "??", mistake: "?", inaccuracy: "?!", miss: "✕", best: "★" };
const WORD = { blunder: "Blunder", mistake: "Mistake", inaccuracy: "Inaccuracy", miss: "Missed win", best: "Best move" };

export function gameViewer(page, game, { me = "", startPly = null, autoReview = false } = {}) {
  const { moves, start } = gameMoves(game.pgn);
  const lc = me.toLowerCase();
  const myColor = game.black.toLowerCase() === lc ? "b" : "w";
  page.innerHTML = `<div class="play">
    <div class="info"><div class="main"><b>${esc(game.white)} ${game.whiteElo ? `(${esc(game.whiteElo)})` : ""} vs ${esc(game.black)} ${game.blackElo ? `(${esc(game.blackElo)})` : ""}</b>
      <i>${esc([game.result, game.opening, game.date].filter(Boolean).join(" · "))}</i></div></div>
    <div class="board-wrap"><div class="evalbar"><div style="height:50%"></div></div><div class="bd"></div></div>
    <div class="msg info">Tap Review to have the engine check every move.</div>
    <div class="ctrls"><button data-a="first">⏮</button><button data-a="prev">◀</button><button data-a="next">▶</button><button data-a="last">⏭</button><button data-a="flip">⇅</button></div>
    <div class="ctrls"><button data-a="review" class="hot">Review</button><button data-a="best">Show best</button></div>
    <div class="moves"></div>
    <div class="dark-prose summary"></div>
  </div>`;
  const $ = s => page.querySelector(s);
  const board = new Board($(".bd"), { orientation: myColor });
  const evalFill = $(".evalbar div"), msg = $(".msg"), movesEl = $(".moves"), summary = $(".summary");
  let ply = startPly ?? 0;            // number of moves played from the start
  let review = null, explore = null, showBest = false, evalToken = 0;

  function say(html, cls = "info") { msg.className = "msg " + cls; msg.innerHTML = html; }
  function setEval(e) {
    const w = winPct(e);
    evalFill.style.height = w + "%";
    evalFill.parentElement.title = fmtScore(e);
  }

  function drawMoves() {
    let h = "";
    moves.forEach((m, i) => {
      if (m.color === "w" || i === 0) h += `<span class="n">${Math.floor(i / 2) + 1}.</span>${m.color === "b" ? "<span></span>" : ""}`;
      const r = review?.moves[i];
      const g = r && r.tag && LABEL[r.tag] && r.tag !== "best" ? `<span class="g ${r.tag}">${LABEL[r.tag]}</span>` : "";
      h += `<span class="m ${i + 1 === ply && !explore ? "cur" : ""}" data-i="${i + 1}">${esc(m.san)}${g}</span>`;
    });
    movesEl.innerHTML = h || `<span style="color:#888">No moves</span>`;
    const cur = movesEl.querySelector(".cur");
    if (cur) { const top = cur.offsetTop - movesEl.offsetTop; if (top < movesEl.scrollTop || top > movesEl.scrollTop + movesEl.clientHeight - 24) movesEl.scrollTop = top - 40; }
  }
  movesEl.onclick = e => { const m = e.target.closest(".m"); if (m) go(+m.dataset.i); };

  function show() {
    let chess, last = null;
    if (explore) { chess = new Chess(explore.fen()); const h = explore.history({ verbose: true }); last = h[h.length - 1] || explore.last || null; }
    else { chess = new Chess(ply ? moves[ply - 1].after : start); last = ply ? moves[ply - 1] : null; }
    board.set(chess, { lastMove: last });
    board.movable = "both";
    board.arrows([]);
    drawMoves();
    const token = ++evalToken;
    if (explore) {
      say(`<span class="spin"></span> Exploring a side line…`);
      analyse(chess.fen(), { depth: 13 }).then(r => {
        if (token !== evalToken) return;
        setEval(r);
        const bm = r.best ? new Chess(chess.fen()).move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] })?.san : null;
        say(`Side line · ${fmtScore(r)}${bm ? ` · best ${esc(bm)}` : ""} <span style="flex:1"></span><u data-a="back">back to game</u>`);
        if (showBest && r.best) board.arrows([{ from: r.best.slice(0, 2), to: r.best.slice(2, 4) }]);
      });
      return;
    }
    if (review) {
      setEval(review.evals[ply]);
      const r = ply ? review.moves[ply - 1] : null;
      const before = review.moves[ply];
      if (r && r.tag && WORD[r.tag]) {
        const bestSan = r.best && r.best !== r.uci ? sanOf(r.before, r.best) : null;
        say(`${WORD[r.tag]}: ${moveNo(ply - 1)}${esc(r.san)}${bestSan ? ` · best was ${esc(bestSan)}` : ""} · ${fmtScore(review.evals[ply])}`,
          r.tag === "best" ? "good" : r.tag === "inaccuracy" ? "info" : "bad");
        if (bestSan) board.arrows([{ from: r.best.slice(0, 2), to: r.best.slice(2, 4), color: "rgba(129,182,76,.85)" }]);
      } else say(ply ? `${moveNo(ply - 1)}${esc(moves[ply - 1].san)} · ${fmtScore(review.evals[ply])}` : "Start of the game");
      if (showBest && before?.best) board.arrows([{ from: before.best.slice(0, 2), to: before.best.slice(2, 4) }]);
    } else {
      say(ply ? `${moveNo(ply - 1)}${esc(moves[ply - 1].san)}` : "Start of the game");
      if (showBest) analyse(chess.fen(), { depth: 13 }).then(r => {
        if (token !== evalToken) return;
        setEval(r);
        if (r.best) board.arrows([{ from: r.best.slice(0, 2), to: r.best.slice(2, 4) }]);
      });
    }
  }
  const moveNo = i => `${Math.floor(i / 2) + 1}.${i % 2 ? ".." : ""} `;
  function sanOf(fen, u) { try { return new Chess(fen).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san; } catch { return u; } }
  function go(n) { explore = null; ply = Math.max(0, Math.min(moves.length, n)); show(); }

  board.onMove = mv => {
    const base = explore || new Chess(ply ? moves[ply - 1].after : start);
    // playing the game's own next move just steps forward
    if (!explore && ply < moves.length && moves[ply].from === mv.from && moves[ply].to === mv.to) { go(ply + 1); return; }
    const m = base.move(mv);
    if (!m) return;
    explore = base; explore.last = m;
    show();
  };
  msg.onclick = e => { if (e.target.dataset.a === "back") go(ply); };

  page.querySelector(".play").addEventListener("click", async e => {
    const a = e.target.closest("button")?.dataset.a; if (!a) return;
    if (a === "first") go(0);
    if (a === "prev") explore ? go(ply) : go(ply - 1);
    if (a === "next") go(ply + 1);
    if (a === "last") go(moves.length);
    if (a === "flip") board.flip();
    if (a === "best") { showBest = !showBest; e.target.classList.toggle("hot", showBest); show(); }
    if (a === "review") runReview(e.target);
  });
  addEventListener("keydown", key);
  function key(e) {
    if (!page.isConnected) { removeEventListener("keydown", key); return; }
    if (e.key === "ArrowLeft") go(ply - 1); if (e.key === "ArrowRight") go(ply + 1);
  }

  async function runReview(button) {
    if (review) return;
    button.disabled = true;
    review = await reviewGame(game, { depth: 13, onProgress: (i, n) => { button.textContent = `Reviewing ${Math.round(i / n * 100)}%`; } });
    button.textContent = "Reviewed"; button.classList.remove("hot");
    summarise();
    show();
  }
  function summarise() {
    const side = c => review.moves.filter(m => m.color === c);
    const line = c => {
      const ms = side(c), acc = ms.length ? Math.round(ms.reduce((a, m) => a + m.acc, 0) / ms.length) : 0;
      const n = t => ms.filter(m => m.tag === t).length;
      return `<b>${esc(c === "w" ? game.white : game.black)}</b>: accuracy ${acc}% · ${n("blunder") + n("miss")} blunders, ${n("mistake")} mistakes, ${n("inaccuracy")} inaccuracies`;
    };
    const worst = review.moves.filter(m => m.color === myColor && (m.tag === "blunder" || m.tag === "miss" || m.tag === "mistake"))
      .sort((a, b) => b.loss - a.loss).slice(0, 3);
    summary.innerHTML = `${line("w")}<br>${line("b")}` + (worst.length ? `<br><br>Your costliest moves: ` +
      worst.map(m => `<u data-ply="${m.ply + 1}" style="cursor:pointer">${moveNo(m.ply)}${esc(m.san)}</u>`).join(", ") : "");
  }
  summary.onclick = e => { const p = e.target.dataset.ply; if (p) go(+p); };

  show();
  if (autoReview) runReview(page.querySelector('[data-a="review"]'));
  return { go };
}
