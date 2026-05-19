# BattleSight handoff

You are picking up an in-progress polish push on BattleSight, an interactive
visual encyclopedia of battles and wars. The owner is dialing the product
toward "world renowned quality" — every surface needs to read tight, every
piece of data needs to be trustworthy, every animation needs intent. He has
been frustrated with the agent he handed off from, so do not over-promise,
do not hedge, and ship work that holds up to a glance from a stranger.

Repository: `/Users/douglasadolph/src/dcadolph/battlesight/`. Web app is in
`web/`. Backend Go server in `cmd/battlesight`. Importer / tooling in
`cmd/import` and `internal/importer`.

Style preferences live in `/Users/douglasadolph/Downloads/aboutme.md` (his
cross-project handoff). The cinematic style guide is in §5 of that doc.
Project-specific memory is at
`/Users/douglasadolph/.claude/projects/-Users-douglasadolph-src-dcadolph-battlesight/memory/`
— read `MEMORY.md` for the index.

---

## What's running

- Go API on `http://localhost:8080` (battletra process, listening on `*:8080`)
- Vite dev on `http://localhost:5173` (node process)
- SQLite database at `data/battlesight.db` (about 18 MB)
- Recent backups: `data/battlesight.db.bak.*`, `data/wars.json.bak.*`

Vite HMR is the iteration loop. The Go server only needs a restart when
backend code changes (war / phase JSON files hot-reload automatically).

---

## What is done

### Data quality
- Era taxonomy split: `modern` (1946-2025) → `cold-war` (1946-1991) +
  `contemporary` (1991+). DB migrated in place; legacy `modern` alias
  preserved in TS so any stray row still renders sanely.
- 1,971 + 1,889 + 14 side-name rows cleaned of wikitext residue
  (`{{plainlist`, `{{ubl`, `[[`, `]]`, `20px|`, `border|`, doubled words,
  "Supported by: , " trailers). 165 useless rows blanked to "Unknown".
- 1,277 + 280 + 246 + 2 significance fields cleaned of `thumb|`, `alt=`,
  `upright=`, image captions, `===` headings, and `[[...]]` wiki links.
- 32 + 0 date strings cleaned of `{{cite web}}` / `{{efn}}` residue.
- War-bucket normalization (every entry rolled to a canonical name):
  - WWII: 34 → 688
  - WWI: 18 → 471
  - Napoleonic Wars: 28 → 211
  - American Revolutionary War: → 191
  - American Civil War: → 490
  - French Revolutionary Wars: → 117
  - Vietnam War, Korean War, Iraq War, Gulf War, War in Afghanistan
    (2001-2021), Syrian Civil War, Russia-Ukraine War, Second Sino-Japanese
    War, Russian Civil War, Mexican-American War, Hundred Years' War.
- wars.json: 147 prose fields scrubbed of wikitext; duplicate "Syrian
  civil war" entry consolidated into the canonical "Syrian Civil War"
  with accurate 2024 fall-of-Damascus narrative.
- battles.json stubs dropped for IDs now curated (`zama-202bc`,
  `jutland-1916`, `tora-bora-2001`, `guadalcanal-1942`,
  `chosin-reservoir-1950`).

### Curated battles
- 130 curated battles (118 inherited + 12 added this session).
  Newly added: Teutoburg Forest 9, Manzikert 1071, Crécy 1346, Leipzig
  1813, Sedan 1870, Jutland 1916, Caporetto 1917, Guadalcanal 1942-43,
  Monte Cassino 1944, Chosin Reservoir 1950, Tora Bora 2001, Zama 202 BC.
- Validator (`internal/importer/validate.go`) gates: ocean coords,
  casualty bounds, date-era alignment. All current curated entries pass.

### Frontend
- React 19 + Vite 7 + Tailwind 4 + react-globe.gl 2.37.
- `cleanProseText` and `cleanCasualtyText` helpers in `web/src/lib/format.ts`
  scrub residue at render time (belt-and-suspenders for any rows the DB
  sweep missed).
- `canonBelligerentKey` and `canonBelligerentLabel` in
  `web/src/lib/country.ts`: rule-based alias table mapping freeform side
  names to publication-grade canonical labels. Rule order matters — USSR
  precedes us-union so "Soviet Union" doesn't get tagged as Civil War
  Union. KEEP THIS ORDER.
- `WarPlayback.tsx` cinematicSides: frequency-ranked, junk-filtered,
  sub-unit-rejected, sub-national-rejected. Picks top 5 by battle count
  across the war. Also emits `cinematicSidesTotal` for the actual count
  stat.
- `WarCinematicOverlay.tsx` overture + aftermath: single era pill
  eyebrow, large title, three-stat strip (Span / Battles / Belligerents
  on overture; Years / Battles / Lives lost on aftermath), belligerent
  chip strip, era-themed bloom and hairline. Buttons: "Play the war" /
  "Skip the overture" / "Back to the globe". Reveals staggered via
  `wc-rise` keyframes; all gated by `usePrefersReducedMotion`.
- `BattleReplay.tsx` outro: redesigned, era-themed, "Replay from start"
  + "Back to the story" buttons.
- `TransportScrubber` (inside BattleReplay): YouTube-style track with
  hover-grow, gradient fill, scene-boundary ticks, head dot with glow,
  tooltip following mouse x, drag bound to document. Intra-phase fill
  creeps via RAF. Disabled / static under reduced motion.
- `usePrefersReducedMotion` hook in `web/src/hooks/`. Global CSS
  `@media (prefers-reduced-motion: reduce)` block in `index.css` kills
  decorative animations.
- StrictMode is disabled in `web/src/main.tsx`. Re-enabling it crashes
  react-globe.gl 2.37 because the WebGL context-loss/restore handler
  inside three.js throws "undefined is not an object (evaluating
  'info.autoReset')". Leave StrictMode off until react-globe.gl ships a
  fix.

### In-flight: territory time-shift v2 (task #79)
Designed but NOT YET wired into the globe. The data file is at
`web/src/data/territory-snapshots.ts` with WW2 and Russia-Ukraine
snapshot timelines. The remaining work: extend `BattleGlobe` to accept
`warCountryColors?: Record<string, string>` (an override on the flat
`warAccent`), then in `WarPlayback` compute the snapshot for the current
playhead year and pass the country-color map down. The helper to
convert a snapshot to a color map is `buildCountryColorMap()` in the
same file.

---

## What's broken / pending (start here)

### CRITICAL — user-visible regressions to chase
1. **WW2 overture still cramped on small viewports.** Buttons can overlap
   the belligerent chip row when the viewport is narrow. Last screenshot
   showed "Play the war" sitting at the same y as the chip strip on a
   tall but narrow window. Probably needs explicit `min-height` on the
   overture body or stronger spacing rhythm.
2. **Belligerents stat now shows the real count** (e.g. WW2 should read
   in the tens). Verify on hard-refresh; if the cell still shows "5",
   `cinematicSidesTotal` plumbing in `WarPlayback.tsx` is broken — that
   was the most recent edit and could be the bug.
3. **WW2 belligerent line** must now read "Nazi Germany · Japan · United
   States · United Kingdom · Soviet Union" (or close). The rule-order
   fix in `web/src/lib/country.ts` made this work; verify it sticks
   across refresh.

### Pending tasks (task list IDs are tracked in the session, but the
plain English version):

- **#79 territory shading time-shift** — finish wiring. Steps:
  a. Add `warCountryColors?: Record<string, string>` prop to BattleGlobe.
  b. In the polygon styling memo, prefer that map over `warAccent` when
     present.
  c. In WarPlayback, compute the current playhead year from the active
     battle, call `findSnapshot(selectedWar, year)`, call
     `buildCountryColorMap(snap)`, pass to BattleGlobe.
  d. Show a small "as of <snapshot.label>" caption near the war HUD
     during playback.

- **#80 ship 15+ more curated battles** — start with Moscow 1941, Crete
  1941, Tarawa 1943, Saipan 1944, Philippine Sea 1944, Easter Offensive
  1972, Saigon 1975, Tobruk 1941-42, Anzio 1944, Pusan Perimeter 1950,
  Mukden 1905, Adwa 1896, Solferino 1859, Königgrätz 1866, Tenochtitlan
  1521, Mohács 1526, Bosworth Field 1485, Talas 751, Issus 333 BC,
  Sevastopol 1854-55. Template: `data/curated/cannae-216bc.json`. After
  each batch run `go run ./cmd/import -json data/battles.json -validate`
  to catch typos; then real import with the same command minus
  -validate.

- **Phase duration audit** done — 271 phases in 49 curated replays all
  within the 5-11s cinematic-guide window.

- **prefers-reduced-motion** done globally + in `BattleReplay`. The
  cinematic overlay also honours it.

- **YouTube scrubber** done in BattleReplay. May want to backport the
  same pattern to GlobeReplay / WarPlayback HUD if there's appetite.

- **Globe sharpness** — texture-tuning runtime hook caused a WebGL
  context-loss crash in three.js. Hook is removed. The path forward is
  to swap `public/textures/earth-blue-marble-5k.jpg` for an 8K or 10K
  NASA Blue Marble file (current is 5400x2700 at 2.2 MB; 10800x5400 is
  about 8 MB and noticeably sharper at Normandy-scale zoom). No
  runtime renderer poking.

- **Data quality remaining items** flagged by the audit subagent that
  ran in this session:
  - 2,047 battles with `lat=0, lng=0` sentinel (unknown coords). Need
    geocoding pass; not yet started.
  - 1,155 battles with empty / "0" date strings. Need date enrichment
    from Wikipedia infobox or curation.
  - 618 casualty fields with bare numbers and no unit. Either leave or
    auto-prefix with "~".
  - 11 doubled side-name patterns that the v2 sweep may have caught
    most of; re-audit.

---

## Conventions to honour

### Hard rules from the owner (from aboutme.md, paraphrased)
- **No em-dashes, no semicolons, no sentence-breaking hyphens** in
  user-facing prose. Memory entry `feedback_no_em_dashes.md` flagged
  this on a Berlin narration. The DB cleaner enforces it; if you write
  new curated prose, follow suit.
- **Cinematic style** (memory entry `feedback_cinematic_style.md`):
  5-11s scenes, one accent per cinematic, staggered reveals,
  YouTube-style scrubber, reduced-motion mandatory.
- **No emojis** in code, commits, PR/release notes, or prose. Sparingly
  in markdown if explicitly asked.
- **No British spellings** in code or docs.
- **No names** in commits, code, or comments.
- **No `--no-verify`** on git operations.
- **Prefer the stdlib** in Go; never write custom utilities when the
  stdlib has them.
- **No backwards-compat shims** — this is pre-launch software.
- **No directory listings** in markdown docs.
- **Confirm before any destructive op** (push, force push, reset
  --hard, rm -rf, dropping db tables, etc.).

### Cleanliness
- Run `cd web && npx tsc --noEmit` after any TS edit. Must exit 0.
- Run `go build ./...` and `go test ./internal/...` after any Go edit.
- Don't read DB rows with `tail` or `cat`; use `sqlite3 ... "<query>"`.

### Visual vocabulary
- Era accent is the single colour per surface. The map of era → accent
  is in `web/src/types/battle.ts` (`ERA_COLORS`). Cold War = jade,
  Contemporary = cyan, WW2 = rose, WW1 = pink, Industrial = indigo,
  Napoleonic = blue, Early-modern = purple, Medieval = red, Ancient =
  amber.
- Body text on dark backgrounds is `text-slate-200/95` or near.
- Tracked small-caps eyebrows: `text-[10px] uppercase
  tracking-[0.36em-0.5em]` in the accent colour.
- Buttons match `h-12 px-7 rounded-full` with the era serif (`fontFamily:
  theme.titleFont`) — see `BattleReplay` outro buttons for the canonical
  example.

---

## How to verify the WW2 fix end-to-end

1. Hard-refresh `http://localhost:5173`.
2. Click into the war timeline / list, pick World War II.
3. Hit "Watch the campaign" — the overture should mount.
4. Verify:
   - Single "WORLD WAR II" era pill at top (no "A WAR BEGINS" eyebrow
     anymore — was redundant).
   - Title "World War II" in serif at the centre.
   - Three stats: Span 1939-1945, Battles ~680, Belligerents in the
     tens (NOT 5).
   - Belligerent chip row reading "Nazi Germany · Japan · United States
     · United Kingdom · Soviet Union" (NOT "Union").
   - Two buttons: "Play the war" (white) and "Skip the overture" (era
     accent).

If any of those fail, the fix did not land. Investigate
`web/src/lib/country.ts` (rule order, canonical labels),
`web/src/components/WarPlayback.tsx` (cinematicSides, cinematicSidesTotal),
or `web/src/components/WarCinematicOverlay.tsx` (StatCell wiring).

---

## How to ship more curated battles fast

Each curated battle is a single JSON file in `data/curated/`. Schema:
```json
{
  "id": "slug-with-year",
  "name": "Battle of …",
  "year": 1944,
  "date": "6 June 1944",
  "lat": 49.2,
  "lng": -0.8,
  "era": "world-war-2",
  "war": "World War II",
  "battleType": "amphibious",
  "sides": [
    { "name": "...", "commander": "...", "strength": "...", "casualties": "..." },
    { "name": "...", "commander": "...", "strength": "...", "casualties": "..." }
  ],
  "victor": "...",
  "summary": "Prose, no em-dashes, no semicolons.",
  "significance": "Prose, no em-dashes, no semicolons.",
  "wikipediaTitle": "Battle of …"
}
```
Era keys: `ancient`, `medieval`, `early-modern`, `napoleonic`,
`industrial`, `world-war-1`, `interwar`, `world-war-2`, `cold-war`,
`contemporary`. Year ranges in `internal/importer/validate.go`.

If a stub with the same ID exists in `data/battles.json` (the Wikidata
bulk file), drop it first — the importer would otherwise reject a
duplicate. Python one-liner pattern:
```python
import json
p = '/Users/douglasadolph/src/dcadolph/battlesight/data/battles.json'
d = json.load(open(p))
drop = {'foo-id', 'bar-id'}
d = [b for b in d if b['id'] not in drop]
json.dump(d, open(p, 'w'), indent=2, ensure_ascii=False)
```

Validate then import:
```
cd /Users/douglasadolph/src/dcadolph/battlesight
go run ./cmd/import -json data/battles.json -validate
go run ./cmd/import -json data/battles.json
```

---

## How to talk to the owner

He is direct and time-poor. Drop the apologies, drop the preambles, ship
work. One-sentence status updates. End with what's next, not what was
done. He will tell you when the work is wrong; until then, just keep
moving. He has explicitly said performance is degrading on this push —
that means: stop hedging, stop iterating on the same surface twice
without verifying, do bigger sweeps, surface problems before he sees
them, and write the work end-to-end before declaring done.

---

## Quick path back into productive work

1. Read this file end to end.
2. Hard-refresh the browser at `localhost:5173`, open WW2 overture, see
   if the user-visible regressions from the screenshot are resolved.
3. If yes: pick up task #79 (territory time-shift wiring) and #80
   (curated battles).
4. If no: open devtools console; the most likely failure is something I
   wired wrong in the most recent two edits — country.ts rule order, or
   the sidesTotal prop wiring.
5. Run `cd web && npx tsc --noEmit` before committing anything.

Good luck.
