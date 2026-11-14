// Game parsing, move-by-move engine review, and the "biggest holes in your game" report.
import { Chess } from "../vendor/chess.js";
import { analyse, winPct } from "./engine.js";
import { idb } from "./store.js";

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/* ---------- PGN ---------- */
export function splitPgn(text) {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return [];
  const parts = t.split(/\n\s*\n(?=\s*\[Event\s)/)
    .flatMap(p => p.split(/(?<=(?:1-0|0-1|1\/2-1\/2|\*))\s*\n\s*\n(?=\s*(?:\[|1\.))/));
  return parts.map(s => s.trim()).filter(Boolean);
}

export function parseGame(pgn) {
  // headers by regex: fast enough for thousands of games; chess.js only checks the moves
  const h = {};
  for (const m of pgn.matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) h[m[1]] = m[2];
  const body = pgn.replace(/^\[.*\]\s*$/gm, "").replace(/\{[^}]*\}/g, "").replace(/\([^()]*\)/g, "");
  const nums = [...body.matchAll(/(\d+)\.(\.\.)?/g)];
  if (!Object.keys(h).length) { // plain moves: make sure they parse
    try { new Chess().loadPgn(pgn); } catch { return null; }
  }
  if (!nums.length && !/[a-h][1-8]/.test(body)) return null;
  const last = nums.length ? +nums[nums.length - 1][1] : 0;
  const blackLast = /\d+\.\s*\S+\s+[^\d\s][^\s]*\s*(1-0|0-1|1\/2-1\/2|\*)?\s*$/.test(body.trim());
  const id = h.Link || (h.Site && /chess\.com\/game/.test(h.Site) && h.Site) || null;
  return {
    pgn, white: h.White || "White", black: h.Black || "Black", result: h.Result || "*",
    date: (h.UTCDate || h.Date || "").replace(/\?/g, "").replace(/\.+$/, ""), event: h.Event || "",
    timeControl: h.TimeControl || "", opening: openingName(h), eco: h.ECO || "",
    whiteElo: h.WhiteElo || "", blackElo: h.BlackElo || "", url: h.Link || "",
    termination: h.Termination || "", plies: last * 2 - (blackLast ? 0 : 1), key: id || hash(pgn),
  };
}
function openingName(h) {
  if (h.ECOUrl) return decodeURIComponent(h.ECOUrl.split("/openings/")[1] || "").replace(/-/g, " ").replace(/\s+\d.*$/, "").replace(/\.\.\..*$/, "").trim();
  return h.Opening || h.ECO || "";
}
export function openingFamily(name) {
  const w = (name || "Unknown").split(/\s+/);
  const stop = w.findIndex((x, i) => i > 0 && /^(Defense|Defence|Opening|Game|Gambit|Attack|System|Variation)$/i.test(x));
  return stop > 0 ? w.slice(0, stop + 1).join(" ") : w.slice(0, 3).join(" ");
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return "g" + h.toString(36); }

export function timeControlName(tc) {
  if (!tc || tc === "-") return "";
  if (tc.includes("/")) return "Daily";
  const [base, inc] = tc.split("+").map(Number);
  const est = base + 40 * (inc || 0);
  const kind = est < 180 ? "Bullet" : est < 600 ? "Blitz" : est < 3600 ? "Rapid" : "Classical";
  return `${kind} ${Math.round(base / 60) || base + "s"}${inc ? "+" + inc : ""}`;
}

/** moves with the position before each, plus clocks if the PGN has them */
export function gameMoves(pgn) {
  const c = new Chess(); c.loadPgn(pgn);
  const clocks = {};
  for (const { fen, comment } of c.getComments()) { const m = /%clk\s+([\d:.]+)/.exec(comment || ""); if (m) clocks[fen] = toSec(m[1]); }
  const hist = c.history({ verbose: true });
  const start = c.getHeaders().FEN || new Chess().fen();
  const out = [];
  const g = new Chess(start);
  for (const m of hist) { const before = g.fen(); g.move(m.san); out.push({ ...m, before, after: g.fen(), clock: clocks[g.fen()] ?? null }); }
  return { start, moves: out, headers: c.getHeaders() };
}
const toSec = s => s.split(":").reduce((a, x) => a * 60 + parseFloat(x), 0);

/* ---------- engine review of one game ---------- */
function terminal(fen) {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { cp: null, mate: c.turn() === "w" ? -0.1 : 0.1, pv: [] };
  if (c.isDraw() || c.isStalemate()) return { cp: 0, mate: null, pv: [] };
  return null;
}
const cache = new Map();
async function evalFen(fen, depth) {
  const k = depth + "|" + fen;
  if (cache.has(k)) return cache.get(k);
  const t = terminal(fen);
  const r = t || await analyse(fen, { depth }).then(r => ({ cp: r.cp, mate: r.mate, pv: r.lines[0]?.pv || [], best: r.best }));
  cache.set(k, r);
  return r;
}

export function material(fen) {
  let t = 0; for (const ch of fen.split(" ")[0]) { const v = VAL[ch.toLowerCase()]; if (v && ch.toLowerCase() !== "p") t += v; } return t;
}
export function phaseOf(ply, fen) {
  const m = material(fen);
  if (m <= 26) return "endgame";
  if (ply < 24 && m > 50) return "opening";
  return "middlegame";
}

/** Review a game. Returns per-move results; cached by key. */
export async function reviewGame(game, { depth = 12, onProgress } = {}) {
  const ck = `${game.key}|d${depth}`;
  const saved = await idb.get("analysis", ck).catch(() => null);
  if (saved) return saved;
  const { moves, start } = gameMoves(game.pgn);
  const fens = [start, ...moves.map(m => m.after)];
  const evals = [];
  for (let i = 0; i < fens.length; i++) { evals.push(await evalFen(fens[i], depth)); onProgress?.(i + 1, fens.length); }
  const res = moves.map((m, i) => classify(m, i, evals[i], evals[i + 1]));
  const out = { key: game.key, depth, moves: res, evals: evals.map(e => ({ cp: e.cp, mate: e.mate })) };
  idb.set("analysis", ck, out).catch(() => {});
  return out;
}

function classify(m, i, before, after) {
  const white = m.color === "w";
  const wb = winPct(before), wa = winPct(after);
  const mine = x => white ? x : 100 - x;
  const loss = Math.max(0, mine(wb) - mine(wa));
  const best = before.pv?.[0] || before.best;
  const played = m.from + m.to + (m.promotion || "");
  let tag = played === best ? "best" : loss >= 30 ? "blunder" : loss >= 20 ? "mistake" : loss >= 10 ? "inaccuracy" : "";
  // a "miss": you had a winning shot (mate or a big jump) and didn't take it
  const hadMate = before.mate != null && (white ? before.mate > 0 : before.mate < 0);
  if (tag && tag !== "best" && hadMate && !(after.mate != null && (white ? after.mate > 0 : after.mate < 0))) tag = loss >= 20 ? "miss" : tag;
  const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
  return {
    ply: i, san: m.san, color: m.color, uci: played, best, loss: Math.round(loss * 10) / 10, acc: Math.round(acc),
    tag, phase: phaseOf(i, m.before), clock: m.clock, before: m.before, after: m.after,
    motif: tag && tag !== "best" && tag !== "inaccuracy" ? motif(m, before, after, white) : null,
  };
}

/* ---------- what kind of mistake was it? ---------- */
function motif(m, before, after, white) {
  const me = white ? "w" : "b";
  const oppMate = after.mate != null && (white ? after.mate < 0 : after.mate > 0);
  const hadMate = before.mate != null && (white ? before.mate > 0 : before.mate < 0);
  if (hadMate) return Math.abs(before.mate) <= 1 ? "missedMate1" : "missedMate";
  if (oppMate) {
    // allowed mate: was it on my back rank?
    const line = after.pv || [];
    const g = new Chess(m.after);
    try { for (const u of line) g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch {}
    if (g.isCheckmate()) {
      const k = findKing(g, me);
      if (k && k[1] === (me === "w" ? "1" : "8")) return "backRank";
    }
    return "allowedMate";
  }
  // did my move leave a piece hanging? (the reply wins material straight away)
  const reply = after.pv?.[0];
  if (reply) {
    const g = new Chess(m.after);
    const tgt = g.get(reply.slice(2, 4));
    if (tgt && tgt.color === me && VAL[tgt.type] >= 3) {
      const defended = g.attackers(reply.slice(2, 4), me).length > 0;
      if (!defended || VAL[tgt.type] > VAL[g.get(reply.slice(0, 2))?.type || "p"]) return "hung";
    }
    // the reply forks two of my pieces
    if (isFork(g, reply, me)) return "allowedFork";
  }
  // missed a tactic of my own
  const best = before.pv?.[0];
  if (best) {
    const g = new Chess(m.before);
    const tgt = g.get(best.slice(2, 4));
    if (tgt && tgt.color !== me && VAL[tgt.type] >= 3 && (g.attackers(best.slice(2, 4), tgt.color).length === 0 || VAL[tgt.type] > VAL[g.get(best.slice(0, 2)).type])) return "missedFree";
    if (isFork(g, best, g.turn() === "w" ? "b" : "w")) return "missedFork";
    const mv = (() => { try { return new Chess(m.before).move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] }); } catch { return null; } })();
    // a quiet best move usually means you had to deal with a threat
    if (mv && !mv.captured && !mv.san.includes("+")) return "missedThreat";
    return "missedTactic";
  }
  return "other";
}
function findKing(g, color) { for (const row of g.board()) for (const p of row) if (p && p.type === "k" && p.color === color) return p.square; return null; }
function isFork(g, u, victim) {
  try {
    const mv = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    if (!mv) return false;
    const sq = mv.to, attacker = mv.color;
    const val = VAL[mv.piece];
    let n = 0;
    const tmp = new Chess(g.fen());
    for (const row of tmp.board()) for (const p of row) {
      if (!p || p.color !== victim) continue;
      if ((p.type === "k" || VAL[p.type] > val || (VAL[p.type] >= 3 && tmp.attackers(p.square, victim).length === 0)) && tmp.attackers(p.square, attacker).includes(sq)) n++;
    }
    g.undo();
    return n >= 2;
  } catch { return false; }
}

/* ---------- the report ---------- */
const MOTIFS = {
  hung: { name: "Leaving pieces hanging", drill: "hangingPiece", why: "You moved and left a piece where it could simply be taken." },
  missedFree: { name: "Missing free material", drill: "hangingPiece", why: "Your opponent left something en prise and you didn't take it." },
  allowedFork: { name: "Walking into forks", drill: "fork", why: "Your move let one enemy piece hit two of yours." },
  missedFork: { name: "Missing forks", drill: "fork", why: "You had a fork that won material and played something else." },
  missedMate1: { name: "Missing mate in one", drill: "mateIn1", why: "You had checkmate on the board and didn't see it." },
  missedMate: { name: "Missing forced mates", drill: "mateIn2", why: "You had a forced checkmate sequence and let it go." },
  backRank: { name: "Back-rank weakness", drill: "backRankMate", why: "Your king got mated (or could have been) on its own back rank." },
  allowedMate: { name: "King safety", drill: "exposedKing", why: "Your move allowed a forced checkmate." },
  missedThreat: { name: "Not seeing your opponent's threat", drill: "defensiveMove", why: "The position needed a quiet defensive move, and the move you chose let your opponent's idea work." },
  missedTactic: { name: "Missing tactics", drill: "middlegame", why: "There was a combination that won big and you played a quieter move." },
  other: { name: "Other big errors", drill: "middlegame", why: "Moves that dropped a lot of evaluation for other reasons." },
};

/* How much a game counts when ranking your holes:
   - recent games count most (half weight every 90 days back), so old habits you've fixed fade out
   - longer time controls count more: rapid/daily 1, blitz 0.6, bullet 0.25
   - games where you got checkmated count extra; games you lost on time count less
   - an error made with almost no time on the clock counts less (it's tracked separately as crunch time) */
export function gameWeight(g, color, now = Date.now()) {
  const t = g.end ? g.end * 1000 : Date.parse((g.date || "").replace(/\./g, "-")) || now;
  const days = Math.max(0, (now - t) / 864e5);
  const recency = Math.pow(0.5, days / 90);
  const kind = timeControlName(g.timeControl).split(" ")[0];
  const format = { Bullet: 0.25, Blitz: 0.6, Rapid: 1, Classical: 1, Daily: 1 }[kind] ?? 0.8;
  const lost = (g.result === "1-0" && color === "b") || (g.result === "0-1" && color === "w");
  const term = (g.termination || "").toLowerCase();
  const how = !lost ? 1 : /checkmate/.test(term) ? 1.4 : /time/.test(term) ? 0.6 : 1.1;
  return { w: recency * format * how, recency, format, how };
}

export function buildReport(games, reviews, me) {
  const lc = me.toLowerCase();
  const now = Math.max(Date.now(), ...games.map(g => (g.end || 0) * 1000));
  const R = { games: 0, wins: 0, losses: 0, draws: 0, moves: 0, accSum: 0, byPhase: {}, motifs: {}, timeTrouble: 0, errors: 0,
    thrown: 0, thrownGames: [], openings: {}, examples: {}, wsum: 0, wmotifs: {}, wtime: 0, matedGames: 0, timeLosses: 0 };
  for (const ph of ["opening", "middlegame", "endgame"]) R.byPhase[ph] = { moves: 0, acc: 0, blunders: 0, mistakes: 0 };
  games.forEach((g, gi) => {
    const rv = reviews[gi]; if (!rv) return;
    const color = g.white.toLowerCase() === lc ? "w" : g.black.toLowerCase() === lc ? "b" : null;
    if (!color) return;
    R.games++;
    const { w: gw } = gameWeight(g, color, now);
    R.wsum += gw;
    const won = (g.result === "1-0" && color === "w") || (g.result === "0-1" && color === "b");
    const lost = (g.result === "1-0" && color === "b") || (g.result === "0-1" && color === "w");
    won ? R.wins++ : lost ? R.losses++ : R.draws++;
    if (lost && /checkmate/i.test(g.termination)) R.matedGames++;
    if (lost && /time/i.test(g.termination)) R.timeLosses++;
    // opening record
    const fam = openingFamily(g.opening) + (color === "w" ? " (White)" : " (Black)");
    const o = R.openings[fam] ||= { n: 0, w: 0, l: 0, d: 0, acc: 0, am: 0 };
    o.n++; won ? o.w++ : lost ? o.l++ : o.d++;
    // thrown wins: you were clearly winning and didn't win
    const best = Math.max(...rv.evals.map(e => color === "w" ? winPct(e) : 100 - winPct(e)));
    if (best >= 85 && !won) { R.thrown++; R.thrownGames.push(gi); }
    const base = +(g.timeControl.split("+")[0]) || 0;
    for (const mv of rv.moves) {
      if (mv.color !== color) continue;
      R.moves++; R.accSum += mv.acc;
      const ph = R.byPhase[mv.phase]; ph.moves++; ph.acc += mv.acc;
      if (mv.ply < 20) { o.acc += mv.acc; o.am++; }
      const bad = mv.tag === "blunder" || mv.tag === "miss" || mv.tag === "mistake";
      if (mv.tag === "blunder" || mv.tag === "miss") ph.blunders++;
      if (mv.tag === "mistake") ph.mistakes++;
      if (bad) {
        R.errors++;
        const crunch = mv.clock != null && base && (mv.clock < 20 || mv.clock < base * 0.1);
        if (crunch) { R.timeTrouble++; R.wtime += gw; }
        const k = mv.motif || "other";
        R.motifs[k] = (R.motifs[k] || 0) + 1;
        R.wmotifs[k] = (R.wmotifs[k] || 0) + gw * (crunch ? 0.5 : 1);
        (R.examples[k] ||= []).push({ gi, ply: mv.ply, w: gw });
      }
    }
  });
  for (const k in R.examples) R.examples[k].sort((a, b) => b.w - a.w);
  // rank the holes by weighted frequency (see gameWeight)
  const holes = Object.entries(R.motifs).map(([k, n]) => ({ key: k, n, perGame: n / Math.max(1, R.games), score: (R.wmotifs[k] || 0) / Math.max(1e-9, R.wsum), ...MOTIFS[k] }))
    .sort((a, b) => b.score - a.score);
  const phases = Object.entries(R.byPhase).map(([k, p]) => ({ key: k, acc: p.moves ? Math.round(p.acc / p.moves) : null, errPerGame: (p.blunders + p.mistakes) / Math.max(1, R.games), blunders: p.blunders, mistakes: p.mistakes, moves: p.moves }));
  const openings = Object.entries(R.openings).map(([name, o]) => ({ name, ...o, score: (o.w + o.d / 2) / o.n, acc: o.am ? Math.round(o.acc / o.am) : null }))
    .sort((a, b) => b.n - a.n);
  return { ...R, accuracy: R.moves ? Math.round(R.accSum / R.moves) : null, holes, phases, openings };
}
export { MOTIFS };
