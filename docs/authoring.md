# Authoring guide

How to curate phase replays, war narratives, and territory snapshots.
This is the path from "catalog stub" to "cinematic-grade content."

## Index

- [Phase replays](#phase-replays)
- [War narratives](#war-narratives)
- [Territory snapshots](#territory-snapshots)
- [Faction colors](#faction-colors)
- [Quality tiers](#quality-tiers)
- [Workflow tips](#workflow-tips)

## Phase replays

A phase replay is a JSON entry in `data/phases.json` keyed by battle
slug. Each entry contains 4-10 phases. Each phase is one scene of the
battle with unit positions, movements, narration, and an optional
chapter card timestamp.

### Minimal example

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
        "timeMarker": "10 May 1940",
        "narration": "The BEF and the French First Army wheel north into Belgium...",
        "durationMs": 6500,
        "units": [
          { "label": "BEF", "faction": "a", "unitType": "infantry", "x": 32, "y": 24 },
          { "label": "1st Army", "faction": "a", "unitType": "infantry", "x": 28, "y": 36 }
        ],
        "movements": [
          { "faction": "b", "fromX": 5, "fromY": 8, "toX": 30, "toY": 20, "kind": "advance" }
        ]
      }
    ]
  }
}
```

### Replay fields

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `title` | string | yes | Headline shown in the top bar and chapter card. |
| `intro` | string | yes | One-line elevator pitch shown on hover. |
| `factionA` | string | yes | Display name of side A (e.g. "Allies"). |
| `factionB` | string | yes | Display name of side B. |
| `factionC` | string | no | Optional third belligerent. |
| `aggressor` | `'a' \| 'b' \| 'c'` | no | Which side opened hostilities. Used for legacy color swap. |
| `factionAColorKey` | ColorKey | no | Explicit palette override for side A. See [faction-palette.md](#faction-colors). |
| `factionBColorKey` | ColorKey | no | Explicit palette override for side B. |
| `aspectRatio` | number | no | Tactical map width:height. Default `1.6`. |
| `extentLngDeg` / `extentLatDeg` | number | no | Globe view geographic extent in degrees. Default 3°. |
| `phases` | Phase[] | yes | 4-10 phases. |
| `schematic` | boolean | no | Auto-generated flag. Set `true` only for importer-built replays. |

### Phase fields

| Field | Type | Meaning |
| --- | --- | --- |
| `index` | int | 0-based phase index. |
| `title` | string | Chapter card headline. |
| `narration` | string | Side-panel prose for this phase. 1-3 sentences. |
| `timeMarker` | string | Date or time period chip ("10 May 1940"). |
| `durationMs` | int | Phase dwell in ms. Default 5500. |
| `units` | Unit[] | Static unit positions at this phase. |
| `movements` | Movement[] | Animated arrows fired during this phase. |
| `terrain` | Terrain[] | Optional terrain shapes (rivers, hills, forts). |
| `annotations` | Annotation[] | Free-floating text labels. |
| `focus` | FocusRect | Optional camera zoom on tactical map. |
| `cameraLat` / `cameraLng` / `cameraAltitude` / `cameraTweenMs` | number | Optional camera choreography on globe. |
| `controlRegions` | ControlRegion[] | Per-phase territorial polygons (for territory flips inside one battle). |

### Movement kinds

| Kind | Visual treatment |
| --- | --- |
| `advance` | Default. Solid sweep with march flow. |
| `charge` | Thicker stroke, faster trace, brighter impact. |
| `flank` | Heavily curved arc. |
| `retreat` / `withdrawal` | Dashed stroke, slower somber march. |
| `rout` | Dashed broken stroke, fastest dimmer march. |

## War narratives

A war narrative is a JSON entry in `data/wars.json` keyed by the
canonical war name (matching `battles.war`).

```json
{
  "World War II": {
    "outcome": "Unconditional surrender of Germany at Reims and Karlshorst.",
    "aftermath": "...one paragraph...",
    "keyTerms": "Capitulation",
    "notable": ["Nuremberg trials", "United Nations founded"],
    "humanDeaths": 75000000,
    "startYear": 1931,
    "endYear": 1945,
    "parent": ""
  }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `outcome` | string | One-sentence "how it ended." |
| `aftermath` | string | One-paragraph consequences. |
| `keyTerms` | string | Treaty / surrender / armistice name. |
| `notable` | string[] | 1-3 notable outcomes. |
| `humanDeaths` | int | Curated total deaths (civilians + military + famine + genocide). Preferred over the battle-sum casualties. |
| `startYear` | int | Curated start year. Overrides the earliest battle year for display. |
| `endYear` | int | Curated end year. |
| `parent` | string | Parent war name (e.g. "World War II" for theater entries). Empty for top-level wars. |

`humanDeaths` is authoritative when present — the UI shows it directly
and the rolled-up war total uses it instead of summing children. This
is how WW2 reads 75M (including the Holocaust and famine) rather than
the catalog-derived ~20M battle-only sum.

## Territory snapshots

Territory snapshots live in TypeScript:
`web/src/data/territory-snapshots.ts`. Each war has a list of dated
snapshots; each snapshot is a map of owner key → list of country names.

```ts
{
  war: 'World War II',
  snapshots: [
    {
      year: 1940.5,                       // decimal year, June 1940
      label: 'June 1940: Fall of France',
      control: {
        'nazi-germany': ['Germany', 'France', 'Belgium', ...],
        'ussr': ['Russia', 'Ukraine', ...],
        'uk': ['United Kingdom', 'Canada', ...],
        // ...
      },
    },
    // more snapshots, sorted by year ascending
  ],
}
```

Country names must match world-atlas TopoJSON `properties.name`. Aliases
("United States" vs "United States of America") are handled by
`COUNTRY_NAME_ALIASES`.

Owner keys map to colors in `OWNER_COLORS` and labels in `OWNER_LABELS`.
Add new keys to both maps when introducing a new faction.

## Faction colors

The faction palette lives in `web/src/data/faction-palette.ts`. Iconic
faction colors are keyed by `ColorKey`:

| Key | Hex | Use for |
| --- | --- | --- |
| `nazi-black` | `#1f1f1f` | Nazi factions (in arrows; territory uses feldgrau) |
| `soviet-red` | `#dc2626` | USSR / Red Army |
| `imperial-japan` | `#9b1c1c` | Imperial Japanese forces |
| `fascist-italy` | `#16732b` | Mussolini's Italy |
| `us-blue` | `#1d4ed8` | US modern |
| `royal-navy` | `#1e3a8a` | UK / Commonwealth |
| `union-blue` | `#1e3a8a` | ACW Union |
| `confederate-gray` | `#6b7280` | ACW Confederate |
| `roman-crimson` | `#b91c1c` | Romans |
| `carthage-purple` | `#6b21a8` | Carthage |
| `mongol-amber` | `#b45309` | Mongols |
| ... | ... | (See faction-palette.ts for the full list.) |

Auto-detection runs against the side display string. To override,
set `factionAColorKey` or `factionBColorKey` on the replay entry.

## Quality tiers

| Tier | Source | What it looks like |
| --- | --- | --- |
| **S** | Hand-authored phase replay + verified facts | "Tactical reconstruction" badge, full cinematic |
| **A** | Hand-verified facts, schematic replay | "Schematic replay" amber badge |
| **B** | Imported, plausible metadata | Dossier-only, never auto-cinematic |
| **C** | Imported with thin / broken metadata | Search-only |

The cinematic plays only S. Promote a battle from A → S by writing a
phase replay for it.

## Workflow tips

- Edit `phases.json` in your editor. Save. Reload browser. The server
  picks up the change within 1s.
- Test phase timing by watching the replay end-to-end. The chapter card
  flash should land in the first ~1.5s, the bulk of the action in the
  middle, the punch in the last second.
- Avoid more than 7 movements per phase. The eye loses track.
- Match faction names to known patterns so auto-detection picks the
  right palette. "Wehrmacht" auto-detects to nazi-black; "German Army
  Group A" also does. Spelled wrong → fallback to positional red/blue.
- For multi-battle campaigns (Stalingrad, Normandy), prefer ~10 phases
  of 7-9 seconds each over 5 phases of 15 seconds. The chapter card
  cadence is the campaign's heartbeat.
