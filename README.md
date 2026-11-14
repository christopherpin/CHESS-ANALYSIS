# Chess Analysis

A free, phone-friendly chess trainer in the style of the old iPod app. Live at
https://christopherpin.github.io/CHESS-ANALYSIS/

- **History**: imports your chess.com games (public API), reviews them with Stockfish in the browser,
  and ranks the biggest holes in your game. Recent games, longer time controls and checkmate losses count most.
- **Saved**: paste or open PGNs of your own games or games from books, and play through them with the engine.
- **Drills**: tactical patterns by skill level, game phase, book opening, or mating pattern, each with
  endless real examples.
- **Puzzles**: endless rated puzzles that adapt to you, or practice at any rating.

Everything you do is saved on your device. Nothing to install, nothing to pay.

## Where things come from

- Engine: [Stockfish 18](https://github.com/nmrugg/stockfish.js) (GPLv3), lite single-threaded WASM, in `vendor/`.
- Rules and PGN: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2).
- Pieces: cburnett set (GPLv2+/CC BY-SA), via lichess chessground.
- Puzzles and drills: the [Lichess open puzzle database](https://database.lichess.org/#puzzles) (CC0),
  rebuilt monthly into `data/puzzles/` by the *Build puzzle data* workflow.
- A copy of christopher_pin's chess.com games is saved weekly to `games/` by the *Fetch chess.com games* workflow,
  and is used when chess.com can't be reached.
