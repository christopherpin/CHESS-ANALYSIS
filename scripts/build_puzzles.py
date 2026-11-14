#!/usr/bin/env python3
"""Build the app's puzzle files from the Lichess open puzzle database (CC0).

Usage:  zstd -dc lichess_db_puzzle.csv.zst | python3 scripts/build_puzzles.py data

Writes, under the output folder:
  rating/<bucket>.json   puzzles in a 100-point band (e.g. rating/1200.json = 1200-1299)
  theme/<theme>.json     puzzles with that theme, spread across every rating band
  opening/<family>.json  puzzles from games that opened with that family
  index.json             what exists and how many puzzles each file holds

Each puzzle is [id, fen, moves, rating, themes]. As in the Lichess database, the FEN is the
position before the opponent's last move; the first move in `moves` is that move, and the
solver plays the second, fourth, ... moves.
"""
import csv, json, os, random, sys

random.seed(20261114)
OUT = sys.argv[1] if len(sys.argv) > 1 else "data"
PER_RATING = int(os.environ.get("PER_RATING", 2500))   # per 100-point band
PER_THEME_BAND = int(os.environ.get("PER_THEME_BAND", 250))  # per theme per 200-point band
PER_OPENING_BAND = int(os.environ.get("PER_OPENING_BAND", 200))
MIN_FILE = 30
SKIP_THEMES = {"oneMove", "short", "long", "veryLong", "master", "masterVsMaster", "superGM",
               "equality", "advantage", "crushing", "mix", "playerGames"}

class Reservoir:
    def __init__(self, cap): self.cap, self.seen, self.items = cap, 0, []
    def add(self, x):
        self.seen += 1
        if len(self.items) < self.cap: self.items.append(x)
        else:
            j = random.randrange(self.seen)
            if j < self.cap: self.items[j] = x

by_rating, by_theme, by_open = {}, {}, {}
total = kept = 0
reader = csv.reader(sys.stdin)
header = next(reader)
col = {name: i for i, name in enumerate(header)}
for row in reader:
    total += 1
    try:
        rating = int(row[col["Rating"]]); rd = int(row[col["RatingDeviation"]])
        pop = int(row[col["Popularity"]]); plays = int(row[col["NbPlays"]])
    except (ValueError, IndexError):
        continue
    if rd > 110 or pop < 80 or plays < 200:
        continue
    kept += 1
    themes = row[col["Themes"]].split()
    p = [row[col["PuzzleId"]], row[col["FEN"]], row[col["Moves"]], rating, " ".join(themes)]
    band = max(400, min(3000, rating // 100 * 100))
    by_rating.setdefault(band, Reservoir(PER_RATING)).add(p)
    tb = rating // 200
    for t in themes:
        if t in SKIP_THEMES: continue
        by_theme.setdefault(t, {}).setdefault(tb, Reservoir(PER_THEME_BAND)).add(p)
    tags = row[col["OpeningTags"]].split() if "OpeningTags" in col else []
    if tags:
        by_open.setdefault(tags[0], {}).setdefault(tb, Reservoir(PER_OPENING_BAND)).add(p)

def dump(path, items):
    items.sort(key=lambda p: p[3])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(items, f, separators=(",", ":"))

index = {"source": "Lichess open puzzle database (CC0), database.lichess.org",
         "scanned": total, "eligible": kept, "rating": {}, "theme": {}, "opening": {}}
for band, r in sorted(by_rating.items()):
    dump(f"{OUT}/rating/{band}.json", r.items); index["rating"][band] = len(r.items)
for kind, groups in (("theme", by_theme), ("opening", by_open)):
    for name, bands in groups.items():
        items = [p for r in bands.values() for p in r.items]
        if len(items) < MIN_FILE: continue
        dump(f"{OUT}/{kind}/{name}.json", items)
        index[kind][name] = {"n": len(items), "min": items[0][3], "max": items[-1][3],
                             "available": sum(r.seen for r in bands.values())}
# keep only the 60 most common opening families
top = sorted(index["opening"], key=lambda k: -index["opening"][k]["available"])[:60]
for name in list(index["opening"]):
    if name not in top:
        os.remove(f"{OUT}/opening/{name}.json"); del index["opening"][name]
with open(f"{OUT}/index.json", "w") as f:
    json.dump(index, f, indent=1)
print(f"scanned {total}, eligible {kept}; {len(index['rating'])} rating bands, "
      f"{len(index['theme'])} themes, {len(index['opening'])} openings")
