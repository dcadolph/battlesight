# Territory snapshots

How the per-war country-level shading works. and how to curate new wars.

## Index

- [The model](#the-model)
- [Snapshot file location](#snapshot-file-location)
- [Owner palette](#owner-palette)
- [Authoring a new war](#authoring-a-new-war)
- [Limitations](#limitations)

## The model

A territory snapshot is a frozen picture of who held what at a specific
calendar moment. Each war has a sorted list of snapshots. The frontend
picks the most recent snapshot whose year is ≤ the current battle's
year and uses its `control` map to shade the globe.

Between snapshots, the globe polygon engine tweens color smoothly. A
ring pulse fires at the centroid of every country that changed owners
across the boundary, giving the eye a clear "Poland flipped to Nazi
black" beat.

After the cinematic ends, the final snapshot stays painted ("aftermath
mode") so the post-war ownership remains visible.

## Snapshot file location

`web/src/data/territory-snapshots.ts`. One `TERRITORY` array of
`WarTerritory` entries.

```ts
{
  war: 'World War II',           // canonical war name, matches battles.war
  snapshots: [
    {
      year: 1939.75,             // decimal year, September 1939
      label: 'September 1939: Invasion of Poland',
      control: {
        'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia'],
        'ussr':         ['Russia', 'Belarus', 'Ukraine', 'Estonia', /* ... */],
        'uk':           ['United Kingdom', 'India', 'Egypt', /* ... */],
        // owner → list of countries
      },
    },
    // more snapshots, ascending by year
  ],
}
```

## Owner palette

Owner keys map to colors via `OWNER_COLORS` and labels via
`OWNER_LABELS`. Both live in `territory-snapshots.ts`.

| Key&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Color | Used by |
| --- | --- | --- |
| `nazi-germany`&nbsp;&nbsp; | feldgrau `#6b5d2e` | WW2 |
| `ussr`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | bright red `#dc2626` | WW2 |
| `imperial-japan`&nbsp;&nbsp; | blood crimson `#9b1c1c` | WW2, Russo-Japanese, Second Sino-Japanese |
| `italy`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | fascist green `#16732b` | WW2 |
| `vichy`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | mustard `#a16207` | WW2 (occupied France) |
| `us`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | US blue `#1d4ed8` | WW2, Korean, Vietnam, Iraq, Afghanistan |
| `uk`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | navy `#1e3a8a` | WW1, WW2, Crimean, Falklands, War of 1812 |
| `france`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | cobalt `#3b82f6` | French Rev Wars, Napoleonic, WW1 |
| `mongol`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | amber `#b45309` | Mongol invasions |
| `crusader`&nbsp;&nbsp;&nbsp;&nbsp; | gold `#eab308` | Crusades |
| `saracen`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | dark green `#15803d` | Crusades |
| ...&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | ... | (See `OWNER_COLORS` for the full list.) |

Picking a color: avoid neighbors. Nazi feldgrau is olive, Soviet bright
red, Vichy mustard. three distinct hues so the European map at peak
1942 occupation reads as three competing forces, not one mottled blob.

## Authoring a new war

1. Decide which calendar moments deserve a snapshot. Usually 4-8 per
   war. Watershed events: invasion, peak control, turning point, end
   state. WWII has 8: Poland 1939, France 1940, Barbarossa 1941, Axis
   high water 1942, Stalingrad/Italy 1943, D-Day/Bagration 1944, VE
   Day 1945, VJ Day 1945.

2. For each snapshot, list every country that mattered and who held
   it. Cross-reference Wikipedia's "Belligerents" tables.

3. Pick owner keys for each side. Reuse existing keys when possible.
   Add new ones to `OWNER_COLORS` and `OWNER_LABELS` if needed.

4. Country names must match `world-atlas` TopoJSON
   `properties.name`. Common pitfalls:

   - "United States" vs "United States of America". aliased.
   - "Korea". TopoJSON has separate "South Korea" and "North Korea".
   - "Czech Republic". TopoJSON uses "Czechia".

   Aliases live in `COUNTRY_NAME_ALIASES`; add new ones there.

5. Add the new `WarTerritory` entry to the `TERRITORY` array. The
   `war` string must match the canonical war name in the catalog
   (`battles.war` column).

6. Save. Vite hot-reloads the bundle. Pick the war in the cinematic
   and watch the shading sweep.

## Limitations

- **Country-polygon resolution only.** No sub-national borders (US
  states, German Länder, French departments). So the American Civil
  War can't shade Union vs Confederate territory. the US is one
  polygon. Same problem for the Spanish Civil War, Russian Civil War,
  Chinese Civil War.

- **Modern borders only.** The world-atlas polygons are present-day.
  Roman Empire snapshots use modern Italy/France/Spain/UK polygons,
  which is anachronistic but readable. Same for Mongol invasions,
  Crusades, Caliphate expansion.

- **Hard cuts between snapshots.** No shape interpolation. The polygon
  transition tweens color over ~1.2s but borders don't morph. For wars
  where the front line moved within one calendar year, you need
  multiple snapshots in that year (1940.4, 1940.6, etc.) to capture
  the motion.

- **Curator-driven.** Snapshots aren't derived from data. Every snapshot
  is hand-authored. A war with no curated snapshots has no shading,
  even if it has hand-crafted phase replays.
