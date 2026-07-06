<p align="center">
  <img src="internal/logo/battlesight.png" alt="BattleSight" width="280" />
</p>

<h1 align="center">BattleSight</h1>

<p align="center">
  <img src="https://img.shields.io/badge/status-pre--release-f59e0b" alt="Status: pre-release" />
  <img src="https://img.shields.io/badge/license-all%20rights%20reserved-8b5cf6" alt="License: all rights reserved" />
  <img src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white" alt="Go 1.26" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MapLibre%20GL-5-396CB2" alt="MapLibre GL 5" />
  <img src="https://img.shields.io/badge/deck.gl-9-29323C" alt="deck.gl 9" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/battles-13%2C220-dc2626" alt="13,220 battles" />
  <img src="https://img.shields.io/badge/replays-152-2563eb" alt="152 replays" />
  <img src="https://img.shields.io/badge/wars-713-475569" alt="713 wars" />
</p>

<p align="center">
  <em>Status: pre-release. Data quality is uneven and the catalog is being curated.
  Visuals and replays are iterating fast. expect breaking changes on every commit.</em>
</p>

---

## What It Does

BattleSight is an interactive visual encyclopedia of human conflict from
3000 BC to today, rendered as a 3D globe with hand-crafted phase replays
of the iconic battles and an auto-stepping war cinematic that walks you
through any conflict end to end. The catalog covers about 12,000 battles
imported from Wikipedia and Wikidata. a curated layer on top adds
narrative, phase replays, territory snapshots, and war casualty totals
that include civilians, famine, and genocide.

| Capability&nbsp;&nbsp;&nbsp;&nbsp; | Description |
| --- | --- |
| **Cinematic war playback**&nbsp;&nbsp; | Auto-steps through every hand-crafted battle in a war in chronological order with intercut chapter cards. Plays only the curated tier so the experience never breaks on a stub. |
| **Phase replays**&nbsp;&nbsp; | Hand-authored 4-7 scene tactical reconstructions for the iconic battles, with unit positions, movement arrows, terrain, and timed narration. |
| **Territory tides**&nbsp;&nbsp; | Per-war country-level control snapshots that paint the globe as the playhead crosses each calendar boundary. Watch Axis territory expand across Europe in 1940-42 and recede in 1943-45. |
| **Faction palette**&nbsp;&nbsp; | Iconic color identities for major factions: Wehrmacht in feldgrau, Soviets in red, Imperial Japan in blood crimson, Confederates in gray vs Union navy, ISIS in black, etc. Auto-detected from side names with explicit overrides where it matters. |
| **War aggregation**&nbsp;&nbsp; | Wars roll up curated human-deaths totals (civilians + military + famine + genocide) into a single number you can sort by. Theaters and campaigns nest under their parent war. |
| **Globe view + tactical view**&nbsp;&nbsp; | Same replay rendered two ways: cinematic globe with real geography for the campaign sweep, schematic SVG for the surveyed tactical layout. |
| **Hot-reload curation**&nbsp;&nbsp; | Edit `data/phases.json` or `data/wars.json` and the running server picks the change up without a restart. |

## The Gap We're Closing

Wikipedia has a flat list of every battle ever fought. Most entries are
text with a coordinate, a date range, and a casualty estimate. There is
no structured chronology, no campaign hierarchy, no visual replay, and
no way to ask "show me the Eastern Front of World War II from Barbarossa
to Berlin in two minutes."

Documentaries do the opposite. They build a 90-minute story arc for
*one* war with great visual choreography but cover nothing else, and you
can't compare wars or drill into a specific battle.

BattleSight sits between the two. The catalog has the *breadth* of
Wikipedia. the curated layer on top has the *fidelity* of a Ken Burns
script. for every war, eventually. We are not there yet. We are
building toward it.

## Index

- [Quickstart](#quickstart)
- [Requirements](#requirements)
- [Data quality tiers](#data-quality-tiers)
- [Architecture](#architecture)
- [Authoring a phase replay](#authoring-a-phase-replay)
- [Authoring a war narrative](#authoring-a-war-narrative)
- [HTTP API](#http-api)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Docs](#docs)
- [License](#license)

## Quickstart

```bash
make run            # API on :8080
make web            # UI on :5173 (run in a second terminal)
```

Open `http://localhost:5173`. The landing globe shows every catalog
battle as a point in its era color. Click a point for the dossier,
search for a war for the cinematic.

`make help` lists every target. Useful ones:

```bash
make build          # static binary
make test           # Go tests
make import         # full Wikidata pull into a fresh database
make quality        # produce data-quality report
```

## Requirements

- Go 1.26+
- Node 20+
- ~150 MB free disk for the SQLite database
- A modern browser. Hardware-accelerated WebGL is required for the globe.

## Data quality tiers

Every battle in the catalog falls into one of four tiers. The cinematic
plays only the curated tier so the experience is consistent.

| Tier&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Description | Surfaces in |
| --- | --- | --- |
| **S. Curated**&nbsp;&nbsp; | Hand-authored phase replay + verified facts + curated narrative. ~143 entries today. | Cinematic, dossier, search, war card |
| **A. Verified**&nbsp;&nbsp; | Hand-verified facts (sides, dates, coordinates, casualties) but auto-generated schematic replay. ~200 entries. | Dossier, search, war card |
| **B. Imported**&nbsp;&nbsp; | Wikidata/Wikipedia import with plausible metadata. Most of the catalog. | Search, war card |
| **C. Stub**&nbsp;&nbsp;&nbsp; | Imported with thin or partial metadata (year=0, no coordinates, broken sides parse). | Search only |

The cinematic filter is `tier === S`. The full catalog stays searchable.

## Architecture

The Go server reads battles from a SQLite database, layers curated
phase replays and war narratives from JSON files alongside, and serves
both via a small HTTP API. The React frontend renders the globe and
the cinematic from that API.

- **Backend**: Go 1.26, `database/sql` + `mattn/go-sqlite3`, file-watch
  hot-reload of curation JSON.
- **Frontend**: React 19, Vite 7, Tailwind 4, `react-globe.gl`,
  SVG-based tactical maps.
- **Data**: SQLite WAL mode at `data/battlesight.db`,
  `data/phases.json` (curated replays), `data/wars.json` (curated war
  narratives), `data/territory-snapshots.ts` (territory shading).

The data sources, importers, and trust filters are documented in
[DATA_SOURCES.md](DATA_SOURCES.md) and [docs/data-quality.md](docs/data-quality.md).

## Authoring a phase replay

A phase replay is a JSON entry in `data/phases.json` keyed by battle
slug. Each entry has 4-7 phases with unit positions, movements, and
narration.

```json
{
  "battle-of-france-1940": {
    "title": "Battle of France: The Sickle Cut",
    "intro": "Six weeks, three Army Groups, the fall of the Third Republic.",
    "factionA": "Allies (France, UK, Belgium, Netherlands)",
    "factionB": "Nazi Germany",
    "aggressor": "b",
    "phases": [
      {
        "index": 0,
        "title": "Dyle Plan deployment",
        "narration": "...",
        "units": [{"label": "BEF", "faction": "a", "x": 32, "y": 24}],
        "movements": [{"faction": "b", "fromX": 5, "fromY": 8, "toX": 30, "toY": 20, "kind": "advance"}]
      }
    ]
  }
}
```

Save the file and the running server picks the change up on the next
poll (1s). Reload the browser to see the new replay.

The full schema is in [docs/api.md](docs/api.md#replay-schema).

## Authoring a war narrative

A war narrative is a JSON entry in `data/wars.json` keyed by canonical
war name (matching the `battles.war` column).

```json
{
  "World War II": {
    "outcome": "Unconditional surrender of Germany at Reims and Karlshorst.",
    "aftermath": "...",
    "keyTerms": "Capitulation",
    "notable": ["Nuremberg trials", "United Nations founded"],
    "humanDeaths": 75000000,
    "startYear": 1931,
    "endYear": 1945,
    "parent": ""
  }
}
```

`humanDeaths` includes civilians, famine, and genocide. `parent` lets a
theater roll up under its umbrella war (e.g. `Second Sino-Japanese War`
has `"parent": "World War II"`). Hot-reload applies on the next poll.

## HTTP API

The full API is documented in [docs/api.md](docs/api.md). The endpoints
you need most:

| Method&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Path | Purpose |
| --- | --- | --- |
| `GET`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | `/api/battles/stats` | Era / war / battle-type aggregations. powers the war list. |
| `GET`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | `/api/battles?war=...` | Battles in a war, ordered by date. |
| `GET`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | `/api/battles/search?q=...` | Full-text search across names, sides, and commanders. |
| `GET`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | `/api/battles/{id}` | Single battle dossier. |
| `GET`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | `/api/battles/{id}/replay` | Phase replay for the battle. |
| `GET`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | `/api/wars/{name}/summary` | War summary card with curated narrative + computed stats. |

## Keyboard shortcuts

| Key&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Action |
| --- | --- |
| `Space`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Toggle replay playback |
| `Esc`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Close the current overlay |
| `→` / `←`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Step replay forward / back one phase |
| `/`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Focus the search bar |
| `?`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Toggle the help sheet |

Full list and URL-hash deep links: [docs/usage.md](docs/usage.md).

## Docs

- [docs/architecture.md](docs/architecture.md). how the stack fits together
- [docs/authoring.md](docs/authoring.md). phase replays, war narratives, territory snapshots
- [docs/cinematic.md](docs/cinematic.md). war cinematic engine, advance logic, controls
- [docs/territory-snapshots.md](docs/territory-snapshots.md). country-level shading model
- [docs/api.md](docs/api.md). HTTP API + JSON schemas
- [docs/usage.md](docs/usage.md). URL hash routing + keyboard shortcuts
- [docs/data-quality.md](docs/data-quality.md). trust filters and curation tiers
- [docs/faq.md](docs/faq.md). the questions that come up most often
- [cmd/battlesight/README.md](cmd/battlesight/README.md). server flags and operations
- [cmd/import/README.md](cmd/import/README.md). importer pipeline reference
- [DATA_SOURCES.md](DATA_SOURCES.md). upstream data sources and licenses

## License

Apache 2.0. See [LICENSE](LICENSE).
