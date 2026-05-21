# Using BattleSight

## Shareable URLs

Battles and replays are addressable by URL hash.

```
.../#b=cannae                   open the battle panel
.../#b=cannae&replay=1          launch the phase replay
.../#b=cannae&replay=1&phase=3  jump to phase 4 of the replay
```

The Share button in the battle panel copies a deep link to the clipboard.

## Keyboard

| Key&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Action |
|---|---|
| `/`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Focus the search box |
| `Esc`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Close panel, dismiss intro, exit replay |
| `Space`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Play or pause the replay |
| `←` `→`&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Previous or next replay phase |

## Modes

- **Globe**. Default. Pan, zoom, click a marker.
- **History sweep**. Play the timeline from 3000 BC forward. Era theme
  changes with the playhead, beat cards flash at landmark years, battles
  light up as they enter their year.
- **War cinematic**. Pick a war from the war list, press Play the war.
  BattleSight auto-steps through the war's iconic battles, launching the
  phase replay for each one that has it. Press Skip the overture to
  browse battles by hand instead. Globe shading shifts country control
  per year for wars with territory snapshots (WW2, Russia-Ukraine).
- **Battle dossier**. Click any marker. Reads outcome, sides,
  commanders, casualty estimates, references (books, films, articles),
  and a link out to Google Earth at the battle coordinates.

## Reduced motion

BattleSight respects the OS `prefers-reduced-motion` setting. The
cinematic replay engine falls back to a static phase navigator with no
auto-advance and no movement-arrow animation. All content remains
accessible.
