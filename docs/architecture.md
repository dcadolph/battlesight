# Architecture

How the BattleSight stack fits together end to end.

## Index

- [Overview](#overview)
- [Storage layer](#storage-layer)
- [Backend](#backend)
- [Frontend](#frontend)
- [Hot-reload](#hot-reload)
- [Data flow during a war cinematic](#data-flow-during-a-war-cinematic)

## Overview

```
                ┌──────────────────────────────┐
                │   data/battlesight.db        │   SQLite catalog
                │   data/phases.json           │   curated replays
                │   data/wars.json             │   curated narratives
                └──────────────┬───────────────┘
                               │
                               ▼
                ┌──────────────────────────────┐
                │   cmd/battlesight            │   Go HTTP server
                │   :8080 /api/*               │
                └──────────────┬───────────────┘
                               │
                               ▼
                ┌──────────────────────────────┐
                │   web/  (React + Vite)       │
                │   :5173 dev / static prod    │
                └──────────────────────────────┘
```

Three layers, each independently editable. Curators touch the storage
layer (JSON sidecars). Backend developers touch Go. Frontend developers
touch TypeScript.

## Storage layer

| Source | Lives in | Owned by | Schema |
| --- | --- | --- | --- |
| Battles | `data/battlesight.db` (SQLite) | The importer pipeline | `battles`, `battle_sides`, `battle_references` |
| Phase replays | `data/phases.json` | Curators | [Replay schema](api.md#replay-schema) |
| War narratives | `data/wars.json` | Curators | [WarNarrative schema](api.md#war-narrative-schema) |
| Territory snapshots | `web/src/data/territory-snapshots.ts` | Curators | [TerritorySnapshot type](../web/src/data/territory-snapshots.ts) |
| Faction palette | `web/src/data/faction-palette.ts` | Frontend devs | [ColorKey enum](../web/src/data/faction-palette.ts) |

The SQLite database is gitignored (~80 MB). The JSON sidecars are
checked in.

## Backend

The Go server is one binary: `cmd/battlesight`. It opens the SQLite
catalog, loads the curated JSON sidecars at boot, watches them for
changes, and serves the HTTP API.

| Package | Purpose |
| --- | --- |
| `internal/battles` | Battle / war query + aggregation. Roll-up logic for parent-child wars. |
| `internal/importer` | Wikidata SPARQL pull, Wikipedia enrichment, infobox parsing, cleansing, validation. |
| `internal/server` | HTTP routing, CORS, hot-reload wiring. |
| `internal/quality` | Standalone CLI for catalog quality reports (broken sides, year=0 stubs, missing coords). |

## Frontend

The React app is one Vite bundle. Tailwind for layout, custom CSS for
the cinematic keyframes, `react-globe.gl` for the 3D globe, custom SVG
for the tactical map.

| Path | Purpose |
| --- | --- |
| `web/src/App.tsx` | Top-level state + routing for the war list, dossier, replays, history sweep. |
| `web/src/components/BattleGlobe.tsx` | The 3D globe. Points, rings, polygon shading, focus rings. |
| `web/src/components/WarPlayback.tsx` | War list, cinematic auto-step, dwell timer, territory effect. |
| `web/src/components/replay/BattleReplay.tsx` | Per-battle replay overlay. Wraps the globe or tactical view. |
| `web/src/components/replay/GlobeReplay.tsx` | Globe view of one battle: arrows, units, impact flashes. |
| `web/src/components/replay/TacticalMap.tsx` | Schematic SVG view of one battle: terrain, unit blocks, movement curves. |
| `web/src/data/faction-palette.ts` | Iconic faction color keys + auto-detect from side names. |
| `web/src/data/territory-snapshots.ts` | Per-war country-level control snapshots over time. |

## Hot-reload

The server polls `phases.json` and `wars.json` once per second. When the
mtime advances, the registry reloads under a write lock. Parse errors
log and keep the previous version. Save the file, reload the browser,
see the change — no server restart.

Vite handles the frontend hot-reload separately.

## Data flow during a war cinematic

1. User picks "World War II" from the war list.
2. Frontend fetches `/api/battles?war=World+War+II&limit=2000`.
3. Backend returns ordered battles. Server-side filter: trust filter + war LIKE.
4. Frontend filters to `tier === S` (hand-crafted phase replays only) for the cinematic.
5. WarPlayback's auto-step focuses each battle in turn:
   - Calls `onWarTerritory` with the snapshot resolved by `findSnapshot(war, year)`.
   - BattleGlobe re-shades countries based on the snapshot.
   - WarPlayback emits `onPlayReplay(battle)` to App.
   - App mounts `<BattleReplay>` for that battle.
   - BattleReplay fetches `/api/battles/{id}/replay`, plays phases.
   - On `ended`, calls `onEnded` after the outro pause.
   - WarPlayback's tick-advance effect closes the replay and advances to the next battle.

Each step is independently observable; the cinematic stalls have been
debugged by inspecting which step in this chain didn't fire.
