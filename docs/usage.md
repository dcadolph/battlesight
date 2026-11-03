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

- **Globe**. Default. Pan, zoom, click a marker. The globe spins
  slowly when idle at the whole-globe view. Any drag, scroll, or touch
  stops it. It starts again after 10 seconds idle only when no battle
  is selected and the view is zoomed out to the whole globe, so a
  close-up view stays still.
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
  and a link out to Google Earth at the battle coordinates. Pressing
  Play on a battle replay makes the replay fill the browser window and
  hides the dossier while it plays. Closing the replay brings the
  dossier back where it was.

## On a phone

- Replay controls, war pane controls, and the landing controls held
  upright are at least 44 px tall for touch.
- Held upright, the battle dossier and the war pane open as
  bottom sheets so the globe stays visible above them.
- Held sideways, the war pane narrows to a side column and a replay
  fills the screen. While a replay plays, its top and bottom bars fade
  3 seconds after the last touch. Tap anywhere to bring them back.
- The replay speed control is one button that cycles 0.5x, 1x, 1.5x,
  and 2x.
- Recording a replay to video is a desktop feature and is hidden on
  phones.
- While a war cinematic plays, the war pane steps aside. Stop the
  cinematic to bring it back.

## Reduced motion

BattleSight respects the OS `prefers-reduced-motion` setting. The
cinematic replay engine falls back to a static phase navigator with no
auto-advance and no movement-arrow animation. All content remains
accessible.
