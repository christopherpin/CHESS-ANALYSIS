// A chess.com-style board: green squares, tap or drag to move, last-move highlights,
// legal-move dots, arrows and a promotion chooser. It draws a chess.js game and asks
// the owner (onMove) whether a move is accepted.
const FILES = "abcdefgh";

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.orientation = opts.orientation || "w";
    this.movable = null;          // "w" | "b" | "both" | null
    this.onMove = null;           // (move {from,to,promotion}) => void
    this.chess = null;
    this.selected = null;
    this.lastMove = null;
    this.pieces = new Map();      // element -> {sq, code}
    el.classList.add("board");
    el.innerHTML = `<div class="sqs"></div><div class="pcs"></div><svg class="arrows" viewBox="0 0 800 800"></svg>`;
    this.sqsEl = el.querySelector(".sqs");
    this.pcsEl = el.querySelector(".pcs");
    this.arrowsEl = el.querySelector(".arrows");
    this.drawSquares();
    this.bindPointer();
  }

  /* ---------- geometry ---------- */
  xy(sq) {
    const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
    return this.orientation === "w" ? [f, 7 - r] : [7 - f, r];
  }
  sqAt(x, y) {
    const f = this.orientation === "w" ? x : 7 - x, r = this.orientation === "w" ? 7 - y : y;
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return FILES[f] + (r + 1);
  }
  sqFromEvent(e) {
    const b = this.el.getBoundingClientRect();
    return this.sqAt(Math.floor((e.clientX - b.left) / b.width * 8), Math.floor((e.clientY - b.top) / b.height * 8));
  }

  drawSquares() {
    let h = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sq = this.sqAt(x, y), light = (x + y) % 2 === 0;
      let co = "";
      if (x === 0) co += `<span class="co r">${sq[1]}</span>`;
      if (y === 7) co += `<span class="co f">${sq[0]}</span>`;
      h += `<div class="sq ${light ? "l" : "d"}" data-sq="${sq}">${co}</div>`;
    }
    this.sqsEl.innerHTML = h;
    this.sqEls = {};
    this.sqsEl.querySelectorAll(".sq").forEach(d => this.sqEls[d.dataset.sq] = d);
  }

  flip(o) {
    this.orientation = o || (this.orientation === "w" ? "b" : "w");
    this.drawSquares();
    this.render(false);
  }

  /* ---------- drawing a position ---------- */
  set(chess, { lastMove = null, animate = true } = {}) {
    this.chess = chess;
    this.lastMove = lastMove;
    this.selected = null;
    this.render(animate);
  }

  render(animate = true) {
    const want = [];
    if (this.chess) for (const row of this.chess.board()) for (const p of row) if (p) want.push({ sq: p.square, code: p.color + p.type });
    const free = new Map(this.pieces);
    const placed = [];
    // 1) keep pieces that have not moved
    for (const w of want) {
      for (const [elm, info] of free) if (info.sq === w.sq && info.code === w.code) { placed.push([elm, w]); free.delete(elm); w.done = true; break; }
    }
    // 2) move a free piece of the same kind (nearest first), otherwise make one
    for (const w of want) {
      if (w.done) continue;
      let best = null, bd = 99;
      const [wx, wy] = this.xy(w.sq);
      for (const [elm, info] of free) if (info.code === w.code) {
        const [x, y] = this.xy(info.sq), d = Math.abs(x - wx) + Math.abs(y - wy);
        if (d < bd) { bd = d; best = elm; }
      }
      if (best) { free.delete(best); placed.push([best, w]); }
      else {
        const elm = document.createElement("div");
        elm.className = `pc ${w.code} still`;
        this.pcsEl.appendChild(elm);
        placed.push([elm, w]);
      }
    }
    for (const elm of free.keys()) { elm.remove(); this.pieces.delete(elm); }
    for (const [elm, w] of placed) {
      if (!animate) elm.classList.add("still");
      const [x, y] = this.xy(w.sq);
      elm.style.transform = `translate(${x * 100}%,${y * 100}%)`;
      this.pieces.set(elm, { sq: w.sq, code: w.code });
      if (elm.classList.contains("still")) { void elm.offsetWidth; requestAnimationFrame(() => elm.classList.remove("still")); }
    }
    this.paintSquares();
  }

  paintSquares() {
    for (const [sq, d] of Object.entries(this.sqEls)) d.classList.remove("last", "sel", "dot", "cap", "check");
    if (this.lastMove) for (const s of [this.lastMove.from, this.lastMove.to]) this.sqEls[s]?.classList.add("last");
    if (this.chess && this.chess.inCheck()) {
      const turn = this.chess.turn();
      for (const row of this.chess.board()) for (const p of row) if (p && p.type === "k" && p.color === turn) this.sqEls[p.square].classList.add("check");
    }
    if (this.selected) {
      this.sqEls[this.selected].classList.add("sel");
      for (const m of this.chess.moves({ square: this.selected, verbose: true }))
        this.sqEls[m.to].classList.add(this.chess.get(m.to) || m.flags.includes("e") ? "cap" : "dot");
    }
  }

  flash(sq, cls, ms = 700) {
    const d = this.sqEls[sq]; if (!d) return;
    d.classList.add(cls);
    setTimeout(() => d.classList.remove(cls), ms);
  }

  arrows(list = []) {
    const c = sq => { const [x, y] = this.xy(sq); return [x * 100 + 50, y * 100 + 50]; };
    this.arrowsEl.innerHTML = list.map(({ from, to, color = "rgba(255,170,0,.85)" }) => {
      const [x1, y1] = c(from), [x2, y2] = c(to);
      const a = Math.atan2(y2 - y1, x2 - x1), L = Math.hypot(x2 - x1, y2 - y1) - 30;
      const ex = x1 + Math.cos(a) * L, ey = y1 + Math.sin(a) * L;
      const p = (d, s) => [ex + Math.cos(a + s) * d, ey + Math.sin(a + s) * d].join(",");
      return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="18" stroke-linecap="round"/>
        <polygon points="${p(30, Math.PI / 2)} ${x1 + Math.cos(a) * (L + 30)},${y1 + Math.sin(a) * (L + 30)} ${p(30, -Math.PI / 2)}" fill="${color}"/>`;
    }).join("");
  }

  /* ---------- input ---------- */
  canMove(sq) {
    if (!this.chess || !this.movable) return false;
    const p = this.chess.get(sq);
    if (!p) return false;
    return p.color === this.chess.turn() && (this.movable === "both" || this.movable === p.color);
  }
  elAt(sq) { for (const [elm, info] of this.pieces) if (info.sq === sq) return elm; return null; }

  bindPointer() {
    let drag = null;
    this.el.addEventListener("pointerdown", e => {
      if (this.promoEl) return;
      const sq = this.sqFromEvent(e); if (!sq) return;
      if (this.selected && this.selected !== sq && this.isTarget(this.selected, sq)) { this.tryMove(this.selected, sq); return; }
      if (this.canMove(sq)) {
        this.selected = sq; this.paintSquares();
        const elm = this.elAt(sq);
        if (elm) {
          const b = this.el.getBoundingClientRect();
          drag = { sq, elm, b, moved: false, x0: e.clientX, y0: e.clientY };
          this.el.setPointerCapture(e.pointerId);
        }
      } else { this.selected = null; this.paintSquares(); }
    });
    this.el.addEventListener("pointermove", e => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
      drag.moved = true;
      drag.elm.classList.add("drag");
      const s = drag.b.width / 8;
      drag.elm.style.transform = `translate(${e.clientX - drag.b.left - s / 2}px,${e.clientY - drag.b.top - s / 2}px)`;
    });
    const end = e => {
      if (!drag) return;
      const d = drag; drag = null;
      d.elm.classList.remove("drag");
      if (!d.moved) return; // a tap: keep the selection
      const to = this.sqFromEvent(e);
      d.elm.classList.add("still");
      const [x, y] = this.xy(d.sq);
      d.elm.style.transform = `translate(${x * 100}%,${y * 100}%)`;
      requestAnimationFrame(() => d.elm.classList.remove("still"));
      if (to && to !== d.sq && this.isTarget(d.sq, to)) this.tryMove(d.sq, to, true);
      else if (to !== d.sq) { this.selected = null; this.paintSquares(); }
    };
    this.el.addEventListener("pointerup", end);
    this.el.addEventListener("pointercancel", end);
  }

  isTarget(from, to) { return this.chess.moves({ square: from, verbose: true }).some(m => m.to === to); }

  tryMove(from, to, dropped = false) {
    const opts = this.chess.moves({ square: from, verbose: true }).filter(m => m.to === to);
    if (!opts.length) return;
    this.selected = null;
    if (opts.length > 1 && opts[0].promotion) return this.choosePromotion(from, to, opts[0].color);
    if (dropped) { const elm = this.elAt(from); elm?.classList.add("still"); }
    this.onMove?.({ from, to, promotion: opts[0].promotion });
  }

  choosePromotion(from, to, color) {
    const [x, y] = this.xy(to);
    const box = document.createElement("div");
    box.className = "promo";
    const top = y === 0;
    box.style.left = x * 12.5 + "%";
    box.style[top ? "top" : "bottom"] = "0";
    box.innerHTML = ["q", "n", "r", "b"].map(p => `<div class="pc ${color}${p}" style="position:static;width:auto;height:auto" data-p="${p}"></div>`).join("");
    if (!top) box.style.flexDirection = "column-reverse";
    this.el.appendChild(box);
    this.promoEl = box;
    box.addEventListener("pointerdown", e => {
      e.stopPropagation();
      const p = e.target.dataset.p;
      box.remove(); this.promoEl = null;
      if (p) this.onMove?.({ from, to, promotion: p });
      else this.render(false);
    });
  }
}
