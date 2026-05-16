# BattleTrace

A world atlas of battles. Explore 2,500 years of organized violence on an
interactive globe, then watch iconic engagements unfold phase by phase on a
tactical replay map.

## What's here

- **Globe view** — every battle with known coordinates rendered as a colored
  marker on a 3D globe, scaled by casualty magnitude when known. Click for
  details. Era colors, search, year-range timeline, war stories playback.
- **Phased replays** — hand-crafted tactical reenactments for landmark
  battles, with narrated phases, animated unit movements, and terrain.
- **Curated dataset** — battles with verified sides, commanders, casualties,
  and published-work references.
- **Bulk dataset** — thousands of additional battles imported from Wikidata
  and Wikipedia, gated behind a trust filter that hides records with broken
  metadata by default.

## Replays included

Marathon · Cannae · Gaugamela · Hastings · Agincourt · Trafalgar · Austerlitz ·
Waterloo · Gettysburg · Stalingrad · Midway

Each replay is broken into 5–9 narrated phases with movement arrows, faction
labels, terrain features, and time markers. Built from scholarly sources;
phase data lives in `data/phases.json` and is hand-editable.

## Running locally

Requirements: Go 1.26+, Node 20+.

```bash
# 1. Backend on :8080 — loads phases.json + seeds curated battles
go run ./cmd/battletrace

# 2. Frontend on :5173 — proxies /api to the Go server
cd web && npm install && npm run dev
```

Open <http://localhost:5173>.

The database (`data/battletrace.db`) is created on first run. To import the
larger Wikidata/Wikipedia dataset:

```bash
go run ./cmd/import -all
```

This will fetch ~12,000 additional battle records (mostly auto-enriched and
gated behind the "Trusted" filter by default).

## Data sources

| Source       | License             | Use                                                  |
|--------------|---------------------|------------------------------------------------------|
| Curated      | Project authors     | 29 landmark battles, full sides + references         |
| Phase data   | Project authors     | Hand-crafted phased replays for 11 battles           |
| Wikidata     | CC0                 | Battle list, coordinates, dates, parent conflicts    |
| Wikipedia    | CC BY-SA 3.0        | Summaries, infobox-derived sides and casualties      |
| world-atlas  | Public domain       | Country polygon overlays (110m TopoJSON)             |

See `DATA_SOURCES.md` for full attribution.

## Data quality caveats

Auto-imported battles are best-effort. Coordinate accuracy, war attribution,
and casualty figures from Wikipedia infoboxes are heuristic and may be wrong
in individual cases. The **Trusted** filter is the default and excludes
records with broken war metadata or missing coordinates. **Curated only** is
also available for the hand-verified subset.

The casualty parser picks a representative number from freeform strings
("50,000 killed/wounded" → 50000; "15,000–20,000" → 17500). It is conservative
about overflow and unit confusion, but it is not a substitute for primary
sources. Trust the number you can read in the battle's references.

## Layout

```
cmd/battletrace/   HTTP server
cmd/import/        Pipeline: JSON seed → Wikidata → Wikipedia summaries →
                   infobox parsing → coordinate enrichment
cmd/fixdates/      One-shot utility to backfill year/era from date strings
internal/battles/  Store, handler, replay registry, type definitions
internal/db/       SQLite migrations, pragmas
internal/importer/ Data pipeline pieces (each step independently runnable)
internal/server/   HTTP server wiring with CORS
data/battles.json  Curated battles
data/phases.json   Hand-crafted phase data for replays
data/references.json   Books, films, articles per battle
web/               React + Three.js + SVG frontend
```

## API

```
GET /api/battles                    list (filterable: era, war, battleType,
                                    yearMin, yearMax, quality, includeNoCoord)
GET /api/battles/{id}               single battle with sides + references
GET /api/battles/{id}/replay        phase data for a replay-eligible battle
GET /api/battles/search?q=...       full-text search across name/war/summary
GET /api/battles/stats              aggregate counts for filter UI
GET /api/battles/featured           daily-rotating featured battle
GET /api/battles/replays            list of battle IDs with replays
GET /api/health                     status check
```

## Shareable URLs

Battle pages and replays are addressable via URL hash:

```
.../#b=cannae                   open the battle panel
.../#b=cannae&replay=1          launch the replay
.../#b=cannae&replay=1&phase=3  jump straight to phase 4
```

The Share button in the battle panel copies a deep link to the clipboard.

## Keyboard

- `/` — focus the search box
- `Esc` — close panel / dismiss intro / exit replay
- `Space` — play/pause replay
- `← →` — previous/next replay phase

## Tests

```bash
go test ./...
```

Parser tests cover the dates, casualties, Wikipedia infobox cleanup, and
victor inference paths — the historically brittle parts of the import
pipeline. They are pure functions, no DB or network required.
