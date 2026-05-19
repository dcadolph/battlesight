# HTTP API

The Go server binds `:8080` and serves JSON over HTTP. The Vite dev
server proxies `/api/*` to it, so the frontend speaks the same URLs in
dev and production.

```
GET /api/battles                    list (era, war, battleType, yearMin,
                                    yearMax, quality, includeNoCoord)
GET /api/battles/{id}               single battle with sides + references
GET /api/battles/{id}/replay        phase data for a replay-eligible battle
GET /api/battles/search?q=...       FTS over name, war, summary
GET /api/battles/stats              aggregate counts (eras, wars, types)
GET /api/battles/featured           daily rotating featured battle
GET /api/battles/replays            list of battle IDs with replays
GET /api/people/battles?name=...    battles attributed to a commander
GET /api/health                     status
```

## Filters

- `era`: ancient, classical, late-antique, medieval, early-modern,
  revolutions, industrial, ww1, ww2, cold-war, contemporary
- `war`: exact war name from `data/wars.json`
- `battleType`: land, naval, siege, air, urban
- `quality`: `reconstructed` (has a phase replay), `documented` (curated
  or Wikipedia-enriched), `indexed` (Wikidata pointer only)
- `yearMin` / `yearMax`: inclusive
- `includeNoCoord`: `true` to include records without lat/lng

## Trust tiers

Every battle returns a `tier` value matching the `quality` filter
domain. UI shows it as a badge. Treat **indexed** as a deep link to
Wikipedia and nothing more.

## Replay shape

```
GET /api/battles/{id}/replay
```

Returns the keyed entry from `data/phases.json`:

```json
{
  "title": "...",
  "intro": "...",
  "battlefieldDesc": "...",
  "aspectRatio": 1.7,
  "factionA": "...",
  "factionB": "...",
  "phases": [
    {
      "title": "...",
      "timeMarker": "...",
      "narration": "...",
      "durationMs": 6000,
      "terrain": [{ "kind": "river", "label": "...", "points": [x1,y1,x2,y2] }],
      "units": [{ "label": "...", "faction": "a", "unitType": "infantry",
                  "x": 30, "y": 50, "w": 12, "h": 4, "strength": 5,
                  "status": "pressing" }],
      "movements": [{ "faction": "a", "fromX": 30, "fromY": 50,
                      "toX": 60, "toY": 30, "kind": "charge" }]
    }
  ]
}
```

Terrain kinds: `river`, `coast`, `hill`, `ridge`, `wood`, `town`, `fort`,
`marsh`, `road`. Unit types: `infantry`, `cavalry`, `archers`, `siege`,
`fort`. Movement kinds: `advance`, `charge`, `flank`, `retreat`, `rout`.
