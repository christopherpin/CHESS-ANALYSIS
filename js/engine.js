// Stockfish 18 (lite, single-threaded WASM) in a web worker. Requests are queued, one at a time.
// Scores are returned from White's point of view.
let worker = null, ready = null, queue = Promise.resolve();
let listener = null;

function boot() {
  if (ready) return ready;
  worker = new Worker(new URL("../vendor/stockfish-18-lite-single.js", import.meta.url));
  worker.onmessage = e => listener && listener(String(e.data));
  ready = new Promise(res => {
    listener = line => { if (line === "uciok") { send("setoption name Hash value 32"); send("isready"); } else if (line === "readyok") res(); };
    send("uci");
  });
  return ready;
}
const send = s => worker.postMessage(s);

/** Analyse a FEN. opts: { depth, movetime, multipv }. Resolves to
 *  { lines: [{ cp, mate, pv: [uci...] }], best, cp, mate } with scores from White's side. */
export function analyse(fen, opts = {}) {
  const run = async () => {
    await boot();
    const { depth = 14, movetime = null, multipv = 1 } = opts;
    const white = fen.split(" ")[1] === "w";
    return new Promise(res => {
      const lines = [];
      listener = line => {
        if (line.startsWith("info") && line.includes(" pv ") && line.includes("score")) {
          const k = +(/ multipv (\d+)/.exec(line)?.[1] || 1) - 1;
          const cp = /score cp (-?\d+)/.exec(line), mate = /score mate (-?\d+)/.exec(line);
          const pv = line.split(" pv ")[1].trim().split(" ");
          const sgn = white ? 1 : -1;
          lines[k] = { cp: cp ? sgn * +cp[1] : null, mate: mate ? sgn * +mate[1] : null, pv, depth: +(/ depth (\d+)/.exec(line)?.[1] || 0) };
        } else if (line.startsWith("bestmove")) {
          const best = line.split(" ")[1];
          if (!lines[0]) {
            // no info line: the game is over (mate or stalemate)
            lines[0] = { cp: null, mate: 0, pv: [] };
          }
          const top = lines[0];
          res({ lines: lines.filter(Boolean), best: best === "(none)" ? null : best, cp: top.cp, mate: top.mate });
        }
      };
      send("ucinewgame");
      send(`setoption name MultiPV value ${multipv}`);
      send(`position fen ${fen}`);
      send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
    });
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

export function stop() { if (worker) send("stop"); }

/** White's winning chances 0..100 from a score (Lichess's formula). */
export function winPct({ cp, mate }) {
  if (mate != null) return mate > 0 ? 100 : mate < 0 ? 0 : 50;
  const c = Math.max(-1000, Math.min(1000, cp || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

export function fmtScore({ cp, mate }) {
  if (mate != null) return mate === 0 ? "#" : (mate > 0 ? "M" : "-M") + Math.abs(mate);
  const v = (cp || 0) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(1);
}
