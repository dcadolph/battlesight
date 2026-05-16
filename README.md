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
- **Three-tier trust contract** — every battle is classified as
  **Reconstructed** (hand-built phase replay), **Documented** (curated or
  Wikipedia-enriched with full sides and a clean war attribution), or
  **Indexed** (sparse Wikidata pointer — treat as a deep link to Wikipedia).
  The tier badge is visible in the panel, the globe tooltip, and the filter.
- **Bulk dataset** — ~12,000 battle records harvested from Wikidata and
  enriched from Wikipedia infoboxes. Filtered by tier so you always know
  what kind of record you are looking at.

## Replays included

41 hand-crafted phase replays spanning every era:

- **Ancient:** Marathon, Thermopylae, Salamis, Gaugamela, Cannae, Alesia
- **Medieval:** Hastings, Agincourt, Constantinople
- **Early modern:** Spanish Armada
- **Revolution / Napoleonic:** Bunker Hill, Trenton, Saratoga, Yorktown, Trafalgar, Austerlitz, Waterloo
- **19th c. industrial:** Balaclava, Antietam, Gettysburg, Vicksburg
- **World War I:** First Marne, Tannenberg, Verdun
- **World War II:** Battle of France, Battle of Britain, Pearl Harbor, Coral Sea, Midway, Stalingrad, Kursk, El Alamein, Normandy (D-Day), Battle of the Bulge, Iwo Jima, Okinawa, Berlin
- **Korean:** Inchon, Chosin Reservoir
- **Vietnam:** Khe Sanh
- **Modern:** Mogadishu

Each replay is broken into 4–6 narrated phases with movement arrows, faction
labels, terrain features, and time markers. Phase data lives in
`data/phases.json` and is hand-editable.

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

This will fetch ~12,000 additional battle records (mostly Wikipedia-enriched
and shown under the **Documented** and **Indexed** tiers in the filter UI).

## Data sources

BattleTrace stands on the shoulders of open knowledge and open mapping. Every
record in the system is traceable to one of these sources. We are grateful to
each project and its contributors.

| Source           | License        | Use                                                                       |
|------------------|----------------|---------------------------------------------------------------------------|
| **Curated set**  | Project authors | 95 hand-verified battles with sides, commanders, casualties, references |
| **Phase replays**| Project authors | 41 hand-crafted phase-by-phase tactical reconstructions                 |
| **Wikidata**     | CC0 1.0        | Battle list, coordinates, dates, parent-conflict graph (~12,000 records)  |
| **Wikipedia**    | CC BY-SA 4.0   | Article infoboxes (sides, commanders, strength, casualties), GeoData coords |
| **CDB90**        | U.S. gov't (PD) | Concepts Analysis Agency Database of Battles, 1600–1973                  |
| **world-atlas**  | ISC (M. Bostock) | Country polygon overlays (110m TopoJSON)                                |
| **NASA Blue Marble** | Public domain | Earth surface texture rendered on the globe                            |
| **three-globe** examples | MIT      | Night-sky background texture                                              |

For replay narration, the prose draws from standard scholarly accounts —
encyclopedia entries, military history surveys, and primary-source-based
campaign studies in the public record. Specific book and film references for
individual battles are cataloged in `data/references.json` and rendered on
each battle's panel.

See [DATA_SOURCES.md](DATA_SOURCES.md) for full attribution, license texts,
and the third-party libraries that make the front end possible (React,
react-globe.gl, three.js, Tailwind, Vite) and the back end fast (the
modernc.org pure-Go SQLite port and google/go-cmp).

## Data quality caveats

Auto-imported battles are best-effort. Coordinate accuracy, war attribution,
and casualty figures from Wikipedia infoboxes are heuristic and may be wrong
in individual cases. The **Documented** filter is the default and excludes
records with broken war metadata or missing coordinates; **Reconstructed**
restricts to the hand-curated subset that has a full phase replay; **Indexed**
exposes the sparser Wikidata pointers for completeness.

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
