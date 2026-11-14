// Loads puzzle files built from the Lichess open puzzle database and hands out ones you haven't seen.
import { pref } from "./store.js";

const BASE = new URL("../data/puzzles/", import.meta.url);
const cache = new Map();
let indexP = null;

export function index() {
  if (!indexP) indexP = fetch(new URL("index.json", BASE)).then(r => { if (!r.ok) throw new Error("no puzzle data yet"); return r.json(); })
    .catch(e => { indexP = null; throw e; });
  return indexP;
}
function file(path) {
  if (!cache.has(path)) cache.set(path, fetch(new URL(path, BASE)).then(r => { if (!r.ok) throw new Error(path); return r.json(); })
    .catch(e => { cache.delete(path); throw e; }));
  return cache.get(path);
}

let seen = new Set(pref.get("seen", []));
export function markSeen(id) {
  seen.add(id);
  if (seen.size > 30000) seen = new Set([...seen].slice(-20000));
  pref.set("seen", [...seen]);
}
const toObj = p => ({ id: p[0], fen: p[1], moves: p[2].split(" "), rating: p[3], themes: p[4] ? p[4].split(" ") : [] });

function pick(list, lo, hi, avoid) {
  let pool = list.filter(p => p[3] >= lo && p[3] <= hi);
  if (!pool.length) pool = list;
  let fresh = pool.filter(p => !seen.has(p[0]) && p[0] !== avoid);
  if (!fresh.length) fresh = pool.filter(p => p[0] !== avoid); // you've done them all: start reusing
  return toObj(fresh[Math.floor(Math.random() * fresh.length)]);
}

/** A puzzle near `rating`, like chess.com's rated puzzles (within about ±150). */
export async function byRating(rating, avoid) {
  const idx = await index();
  const bands = Object.keys(idx.rating).map(Number);
  const target = rating + Math.round((Math.random() - 0.5) * 300);
  const band = bands.reduce((a, b) => Math.abs(b + 50 - target) < Math.abs(a + 50 - target) ? b : a);
  return pick(await file(`rating/${band}.json`), target - 150, target + 150, avoid);
}

/** A puzzle from a theme or opening file, within a rating range. */
export async function byGroup(kind, name, lo, hi, avoid) {
  return pick(await file(`${kind}/${name}.json`), lo, hi, avoid);
}

/** Your puzzle rating. Starts from the rating you set (e.g. your chess.com puzzle rating). */
export const rating = {
  get() { return pref.get("prating", { r: 1200, n: 0, hist: [] }); },
  update(puzzleRating, won) {
    const s = this.get();
    const k = s.n < 20 ? 40 : s.n < 60 ? 24 : 16;
    const exp = 1 / (1 + 10 ** ((puzzleRating - s.r) / 400));
    const delta = Math.round(k * ((won ? 1 : 0) - exp));
    s.r = Math.max(100, s.r + delta); s.n++;
    s.hist.push(s.r); if (s.hist.length > 300) s.hist.shift();
    pref.set("prating", s);
    return delta;
  },
  set(r) { const s = this.get(); s.r = r; s.n = Math.min(s.n, 10); pref.set("prating", s); },
};
