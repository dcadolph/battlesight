# Cinematic mode

How the war cinematic actually plays. The timing, the advance logic,
the failure modes, and the controls.

## Index

- [What it does](#what-it-does)
- [The auto-step loop](#the-auto-step-loop)
- [Territory tides](#territory-tides)
- [Controls](#controls)
- [Stalls and how we recover](#stalls-and-how-we-recover)
- [Glossary](#glossary)

## What it does

Pick a war from the war list, hit "Cinematic", and BattleSight
auto-steps through the iconic battles of that war in chronological
order. Each battle plays its phase replay (hand-crafted scenes with
tactical narration, unit positions, movement arrows). Between battles,
the globe re-shades countries to match the year's territorial state.

The result reads like a 5-12 minute documentary, depending on how many
hand-crafted battles the war has.

## The auto-step loop

The loop lives in `WarPlayback.tsx`. Pseudocode:

```
for groupIndex in 0..groups.length:
  for subIndex in 0..groups[groupIndex].battles.length:
    battle = groups[groupIndex].battles[subIndex]
    onPlayReplay(battle)       # mount BattleReplay
    territorySnapshot ← findSnapshot(war, battle.year)
    onWarTerritory(snapshot)   # paint the globe
    wait until one of:
      • BattleReplay fires onEnded (preferred)
      • Dwell timer expires (backstop, 120s)
      • User clicks Next/Prev manually
    onCloseReplay()            # unmount BattleReplay
```

The cinematic-grade filter picks the battles. By default this is
`b.hasReplay && !b.hasSchematic`. Hand-crafted phase replays only.
Falls back to the full battle list when the filter would yield fewer
than 3 entries.

## Territory tides

Each war has a list of dated snapshots in
`web/src/data/territory-snapshots.ts`. When the playhead moves to a new
battle, we look up the most recent snapshot whose year is ≤ the
battle's year. That snapshot's `control` map becomes the globe's
country-coloring.

The polygon transition tweens between snapshots over ~1200ms. A
territory-flip ring pulse fires at the centroid of every country that
changed hands across the snapshot boundary. So you can see Germany's
black ring expanding east across Poland, then France, then the Low
Countries.

After the cinematic ends, the final snapshot stays painted ("aftermath
mode") so the post-war ownership remains visible until the user picks
a new war.

## Controls

| Control&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Where | What it does |
| --- | --- | --- |
| Play / Pause&nbsp;&nbsp; | Bottom-left of WarPlayback | Toggles the auto-step loop. |
| Scrubber&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Bottom strip | Jump to any battle in the campaign. |
| `Next battle` button&nbsp;&nbsp; | Cinematic outro card | Force-advance to the next battle. |
| `Previous` button&nbsp;&nbsp; | Cinematic outro card | Step back one battle. |
| `→` / `←`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Keyboard | Next / Previous battle (in cinematic mode). |
| `Esc`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Keyboard | Close the replay overlay. |
| `Space`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Keyboard | Toggle pause. Disabled in cinematic mode to prevent foot-gun pause-on-Stalingrad. |

## Stalls and how we recover

A "stall" is when the user reaches a battle's outro card and the
cinematic doesn't advance. We have three guard layers:

1. **`onEnded` callback (primary)**. `BattleReplay` fires this 2.4s
   after the last phase lands. Drives the next-battle handoff at the
   right moment regardless of the dwell budget.
2. **Wall-clock dwell timer (backstop)**. `WarPlayback` arms a 120s
   timeout at the start of each cinematic battle. If `onEnded` never
   fires (broken phases, JS error, etc.), this catches the campaign
   and advances anyway.
3. **Manual Next / Previous buttons**. Visible on every cinematic
   outro card. The user always has agency.

The advance handler is a shared code path. All three layers funnel
through `setCinematicAdvanceTick`, which WarPlayback observes and
consumes. Even if one layer races another, the duplicate tick is a
no-op (the ref-based dedupe ignores already-consumed ticks).

If you're debugging a stall, the failure is almost always one of:
- `onEnded` never reached because phases never finished (paused state).
- The dwell timer was cleared by an unmount race.
- The advance tick was consumed under wrong conditions (`!cinematic`,
  `groups.length === 0`).

Add a console log inside the tick-advance effect to trace.

## Glossary

| Term&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Definition |
| --- | --- |
| **Phase replay**&nbsp;&nbsp; | A 4-10 scene tactical reconstruction of one battle, with narration. |
| **Phase**&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | One scene of a replay. ~6-8s by default. |
| **Snapshot**&nbsp;&nbsp; | Per-war, dated country-control state. Drives globe shading. |
| **Owner key**&nbsp;&nbsp; | Identifier in a snapshot's `control` map. Maps to a color in `OWNER_COLORS`. |
| **Cinematic-grade**&nbsp;&nbsp; | Battles that pass the cinematic filter (currently `hasReplay && !hasSchematic`). |
| **Tier**&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Quality level (S/A/B/C). Drives surface decisions. |
| **Faction**&nbsp;&nbsp;&nbsp; | Side in a replay: `a`, `b`, or `c`. Display name lives in `factionA/B/C` on the Replay object. |
