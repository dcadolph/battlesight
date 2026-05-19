import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import BattleGlobe from './components/BattleGlobe';
import TimelineSlider from './components/TimelineSlider';
import BattlePanel from './components/BattlePanel';
import CommanderPanel from './components/CommanderPanel';
import { canonCountriesForBattle } from './lib/country';
import CommandBar from './components/CommandBar';
import EraLegend from './components/EraLegend';
import WarPlayback from './components/WarPlayback';
import BattleReplay from './components/replay/BattleReplay';
import IntroOverlay from './components/IntroOverlay';
import HistoryPlayhead from './components/HistoryPlayhead';
import BattleTitleCard from './components/BattleTitleCard';
import HistoryBeatCard from './components/HistoryBeatCard';
import { HISTORY_BEATS, type HistoryBeat } from './data/history-beats';
import { OWNER_COLORS, OWNER_LABELS } from './data/territory-snapshots';
import type { Battle } from './types/battle';
import { themeForEra, themeForYear } from './theme/era';
import { enableSound, disableSound, soundEnabled, setSoundEra, playSelect } from './audio/sound';
import { usePauseOnHidden } from './hooks/usePauseOnHidden';

// MIN_YEAR floors the timeline at -3000 so deep-antiquity engagements
// (Megiddo 1457 BC, Kadesh 1274 BC, future Mesopotamian and Egyptian
// dynastic-era battles) render on the slider and the history sweep. The
// app previously stopped at -500 which dropped every Bronze Age battle
// off the front of the bar.
const MIN_YEAR = -3000;
const MAX_YEAR = 2025;

interface Filters {
  era: string;
  war: string;
  battleType: string;
  quality: string;
}

function parseHash(): { battleId?: string; phase?: number; replay?: boolean } {
  const h = window.location.hash.replace(/^#/, '');
  if (!h) return {};
  const params = new URLSearchParams(h);
  const out: { battleId?: string; phase?: number; replay?: boolean } = {};
  const b = params.get('b');
  if (b) out.battleId = b;
  const p = params.get('phase');
  if (p) out.phase = parseInt(p, 10);
  if (params.get('replay') === '1') out.replay = true;
  return out;
}

function writeHash(state: { battleId?: string; phase?: number; replay?: boolean }) {
  const params = new URLSearchParams();
  if (state.battleId) params.set('b', state.battleId);
  if (state.replay) params.set('replay', '1');
  if (typeof state.phase === 'number') params.set('phase', String(state.phase));
  const hash = params.toString();
  const newHash = hash ? `#${hash}` : '';
  if (window.location.hash !== newHash) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${newHash}`);
  }
}

export default function App() {
  const [battles, setBattles] = useState<Battle[]>([]);
  const [yearRange, setYearRange] = useState<[number, number]>([MIN_YEAR, MAX_YEAR]);
  const [selectedBattle, setSelectedBattle] = useState<Battle | null>(null);
  const [isolatedBattle, setIsolatedBattle] = useState<Battle | null>(null);
  const [playbackBattles, setPlaybackBattles] = useState<Battle[] | null>(null);
  // warCountries is the top-N participating countries for the currently
  // selected war on WarPlayback. Used to shade those countries on the globe
  // so the user can see at a glance which territories the war involved.
  // Empty when no war is selected or the war has no recognised participants.
  const [warCountries, setWarCountries] = useState<string[]>([]);
  // warCountryColors holds the time-shifting territory snapshot in effect
  // for the war currently being watched. Each entry maps a canonical country
  // name to the accent color of its controller at the playhead's battle
  // year (e.g. WW2 mid-1941: Germany red across Poland/France/Norway, USSR
  // blue across Russia). Null whenever no snapshot applies, in which case
  // BattleGlobe falls back to the flat warCountries shading.
  const [warCountryColors, setWarCountryColors] = useState<Record<string, string> | null>(null);
  // territoryLabel is the short caption tied to the active snapshot
  // ("June 1944: D-Day, Bagration"). Drives a HUD overlay so the user reads
  // the campaign beat as a labeled stage rather than a silent color change.
  const [territoryLabel, setTerritoryLabel] = useState<string | null>(null);
  // territoryFactions is the active owner-key list for the snapshot. Drives
  // the faction legend in the corner that maps color to label, so the user
  // can read which side controls which territory without guessing.
  const [territoryFactions, setTerritoryFactions] = useState<string[]>([]);
  // commanderQuery powers the CommanderPanel attribution view. Set from a
  // click on a commander chip in BattlePanel; cleared on close.
  const [commanderQuery, setCommanderQuery] = useState<string>('');
  const [filters, setFilters] = useState<Filters>({ era: '', war: '', battleType: '', quality: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlayback, setShowPlayback] = useState(false);
  const [replayBattle, setReplayBattle] = useState<Battle | null>(null);
  // replayCinematic is true when the open replay was launched by the war
  // cinematic auto-step (not by the user clicking "Watch the replay" on a
  // dossier). Suppresses the per-battle interactive outro so the war
  // timer can drive forward motion without the user feeling stuck on the
  // verdict card.
  const [replayCinematic, setReplayCinematic] = useState(false);
  const [replayPhase, setReplayPhase] = useState(0);
  // cinematicAdvanceTick increments every time the inner BattleReplay
  // signals "battle done, move on" or the user clicks the manual Next
  // button on the cinematic outro. WarPlayback watches this prop and
  // jumps to the next battle without waiting on its wall-clock dwell. Lets
  // a long replay (>28s of phases) close cleanly instead of stranding the
  // viewer on its outro card.
  const [cinematicAdvanceTick, setCinematicAdvanceTick] = useState(0);
  // cinematicPrevTick mirrors the advance tick for the "Previous battle"
  // manual control. Same propagation path; WarPlayback decrements
  // groupIndex by one when this changes.
  const [cinematicPrevTick, setCinematicPrevTick] = useState(0);
  const [introVisible, setIntroVisible] = useState(false);
  const [featured, setFeatured] = useState<Battle | null>(null);
  // historyMode is true whenever the user is in the play-history overlay,
  // even when paused. historyPaused gates the RAF loop without exiting the
  // mode, so the playhead stays on screen and the Resume button works.
  const [historyMode, setHistoryMode] = useState(false);
  const [historyPaused, setHistoryPaused] = useState(false);
  const [historyYear, setHistoryYear] = useState<number>(MIN_YEAR);
  // historyBeat is the currently flashing title card during a sweep. The
  // RAF loop sets it when the playhead crosses a beat year and clears it
  // after BEAT_CARD_MS. The advance is paused while a beat is on screen.
  const [historyBeat, setHistoryBeat] = useState<HistoryBeat | null>(null);
  // firedBeats tracks beat array indices already shown in this run so a
  // single sweep does not flash the same beat twice. Indices, not years,
  // because multiple beats can share a year (Singapore and Stalingrad both
  // fire in 1942). Cleared whenever history mode restarts.
  const firedBeatsRef = useRef<Set<number>>(new Set());
  const [soundOn, setSoundOn] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  // splashStartRef pins the timestamp the loading splash mounted so we can
  // enforce a minimum visible duration. On localhost the battles fetch
  // returns in under 100ms and the splash used to flash in and right back
  // out before its own entrance animation finished, which read as broken.
  const splashStartRef = useRef<number>(Date.now());
  const [splashReady, setSplashReady] = useState(false);

  const fetchBattles = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.era) params.set('era', filters.era);
    if (filters.war) params.set('war', filters.war);
    if (filters.battleType) params.set('battleType', filters.battleType);
    if (filters.quality) params.set('quality', filters.quality);
    // During history playback we want the full timeline, ignoring the user's
    // slider range, so battles light up as the playhead reaches their year.
    if (!historyMode) {
      if (yearRange[0] !== MIN_YEAR) params.set('yearMin', String(yearRange[0]));
      if (yearRange[1] !== MAX_YEAR) params.set('yearMax', String(yearRange[1]));
    }

    const qs = params.toString();
    const url = `/api/battles${qs ? '?' + qs : ''}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setBattles(data.battles || []);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        console.error('Failed to fetch battles:', err);
        setError('Failed to load battles');
        setLoading(false);
      });
  }, [filters, yearRange, historyMode]);

  useEffect(() => {
    fetchBattles();
  }, [fetchBattles]);

  // Enforce a minimum splash time so the loading state always gets to land
  // on screen and finish its entrance animation, even when localhost
  // responds in 30ms. Two seconds is long enough for the eye to read the
  // headline; not so long it feels like the app is broken on a hot reload.
  useEffect(() => {
    const elapsed = Date.now() - splashStartRef.current;
    const minMs = 2000;
    if (elapsed >= minMs) {
      setSplashReady(true);
      return;
    }
    const t = setTimeout(() => setSplashReady(true), minMs - elapsed);
    return () => clearTimeout(t);
  }, []);

  // Load featured battle for first visit / intro card.
  useEffect(() => {
    fetch('/api/battles/featured')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Battle | null) => {
        if (b) setFeatured(b);
      })
      .catch(() => {});
  }, []);

  // Honor URL hash on first load.
  useEffect(() => {
    const s = parseHash();
    if (s.battleId) {
      fetch(`/api/battles/${s.battleId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b: Battle | null) => {
          if (!b) return;
          setSelectedBattle(b);
          setIsolatedBattle(b);
          if (s.replay && (b.hasReplay ?? false)) {
            setReplayBattle(b);
            if (typeof s.phase === 'number') setReplayPhase(s.phase);
          }
        })
        .catch(() => {});
    } else {
      // First visit: show intro overlay if there is no battle in URL.
      const seen = localStorage.getItem('bt.intro_seen') === '1';
      if (!seen) setIntroVisible(true);
    }
  }, []);

  // Mirror state into URL hash for sharable links.
  useEffect(() => {
    if (replayBattle) {
      writeHash({ battleId: replayBattle.id, replay: true, phase: replayPhase });
    } else if (selectedBattle) {
      writeHash({ battleId: selectedBattle.id });
    } else {
      writeHash({});
    }
  }, [selectedBattle, replayBattle, replayPhase]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (replayBattle) return; // Replay handles its own Escape
        if (introVisible) {
          setIntroVisible(false);
          return;
        }
        // History mode takes priority over panel close so the user can bail
        // out of a long sweep with a single keystroke.
        if (historyMode) {
          setHistoryMode(false);
          setHistoryPaused(false);
          setHistoryYear(MIN_YEAR);
          return;
        }
        // War mode: collapse all war state back to the bare landing globe.
        // Inlined (not the useCallback) so this effect doesn't need a
        // forward reference to handlePlaybackClose.
        if (showPlayback) {
          setShowPlayback(false);
          setPlaybackBattles(null);
          setSelectedBattle(null);
          setIsolatedBattle(null);
          setReplayBattle(null);
          setReplayPhase(0);
          setYearRange([MIN_YEAR, MAX_YEAR]);
          setWarCountryColors(null);
          setTerritoryLabel(null);
          setTerritoryFactions([]);
          return;
        }
        setSelectedBattle(null);
        setIsolatedBattle(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [replayBattle, introVisible, historyMode, showPlayback]);

  const handleBattleClick = useCallback((battle: Battle) => {
    setSelectedBattle(battle);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedBattle(null);
  }, []);

  const handleIsolate = useCallback((battle: Battle | null) => {
    setIsolatedBattle(battle);
    if (!battle) setSelectedBattle(null);
  }, []);

  // Closing the war panel returns the user to the bare landing globe: no
  // selected battle, no isolated battle, no playback markers, no replay
  // overlay, no year filter. Anything else and the user is left with stray
  // state from a war they thought they exited.
  const handlePlaybackClose = useCallback(() => {
    setShowPlayback(false);
    setPlaybackBattles(null);
    setSelectedBattle(null);
    setIsolatedBattle(null);
    setReplayBattle(null);
    setReplayPhase(0);
    setYearRange([MIN_YEAR, MAX_YEAR]);
    setWarCountryColors(null);
    setTerritoryLabel(null);
    setTerritoryFactions([]);
  }, []);

  const handleWatchReplay = useCallback(() => {
    if (!selectedBattle) return;
    setReplayBattle(selectedBattle);
    setReplayPhase(0);
    setReplayCinematic(false);
  }, [selectedBattle]);

  const handleCloseReplay = useCallback(() => {
    setReplayBattle(null);
    setReplayPhase(0);
  }, []);

  // Stable references for WarPlayback's cinematic auto-step. Inline arrows
  // would get a fresh identity on every App render, which thrashes the dwell
  // timer in WarPlayback's playing effect (the effect's deps include these
  // callbacks; new identity => effect tears down and re-arms the timer on
  // every render, so advances never fire and "playback" looks frozen).
  const handleWarOpenReplay = useCallback((b: Battle) => {
    setReplayBattle(b);
    setReplayPhase(0);
    setReplayCinematic(true);
  }, []);
  const handleWarCloseReplay = useCallback(() => {
    setReplayBattle(null);
    setReplayPhase(0);
    setReplayCinematic(false);
  }, []);
  // handleCinematicBattleEnded is fired by BattleReplay after the outro
  // pause expires during cinematic playback. Bumps the advance tick so
  // WarPlayback can pull the trigger on the next battle even if its own
  // dwell timer has not fired yet (replay phases ran long).
  const handleCinematicBattleEnded = useCallback(() => {
    setCinematicAdvanceTick((t) => t + 1);
  }, []);
  // handleCinematicAdvancePrev rewinds one battle. Same propagation path
  // as the next advance, just routed to WarPlayback's prev tick prop.
  const handleCinematicAdvancePrev = useCallback(() => {
    setCinematicPrevTick((t) => t + 1);
  }, []);
  const handleWarSelected = useCallback((name: string) => {
    if (name) {
      setSelectedBattle(null);
      setIsolatedBattle(null);
    }
  }, []);
  // handleWarTerritory takes the resolved snapshot for the playhead's
  // current battle year from WarPlayback and threads it into BattleGlobe.
  // Stable identity keeps WarPlayback's effect dependency list from
  // tearing down and re-arming on every App render.
  const handleWarTerritory = useCallback(
    (colors: Record<string, string> | null, label: string | null, factions: string[]) => {
      setWarCountryColors(colors);
      setTerritoryLabel(label);
      setTerritoryFactions(factions);
    },
    [],
  );

  const handleShareSelected = useCallback(async () => {
    if (!selectedBattle) return;
    const url = `${window.location.origin}${window.location.pathname}#b=${encodeURIComponent(selectedBattle.id)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Share link:', url);
    }
  }, [selectedBattle]);

  // The active theme drives the globe's atmosphere color, the screen-edge
  // vignette, and the ambient sound bed. Priority: a selected battle wins,
  // history playback follows next, otherwise we use the neutral default.
  const activeTheme = useMemo(() => {
    if (selectedBattle) return themeForEra(selectedBattle.era);
    if (historyMode) return themeForYear(historyYear);
    return themeForEra('');
  }, [selectedBattle, historyMode, historyYear]);

  useEffect(() => {
    setSoundEra(activeTheme.era);
  }, [activeTheme.era]);

  const stopHistoryRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTickRef.current = null;
  }, []);

  // Year advance loop: roughly 2525 years over 90 seconds, so ~28 years/sec.
  // We pin the cadence to wall-clock dt rather than fixed-per-frame
  // increments so the playback rate stays consistent regardless of frame
  // rate. The loop runs only when history mode is on, not paused, and no
  // beat card is currently on screen.
  useEffect(() => {
    if (!historyMode || historyPaused || historyBeat) {
      stopHistoryRaf();
      return;
    }
    const YEARS_PER_SECOND = (MAX_YEAR - MIN_YEAR) / 90;
    const tick = (ts: number) => {
      if (lastTickRef.current == null) lastTickRef.current = ts;
      const dt = ts - lastTickRef.current;
      lastTickRef.current = ts;
      setHistoryYear((y) => {
        const next = y + (dt / 1000) * YEARS_PER_SECOND;
        // Check whether the advance reached a curated beat. We fire the
        // first un-fired beat whose year is at or before our new position
        // and snap the playhead to its year so the title card feels
        // anchored. Index-based firing lets multiple beats share a year
        // (1942: Singapore then Stalingrad) and still each get their card.
        for (let i = 0; i < HISTORY_BEATS.length; i++) {
          if (firedBeatsRef.current.has(i)) continue;
          const beat = HISTORY_BEATS[i];
          if (next >= beat.year) {
            firedBeatsRef.current.add(i);
            setHistoryBeat(beat);
            return beat.year;
          }
        }
        if (next >= MAX_YEAR) {
          // Reached the end of history. Pause at the final year and let the
          // user choose to exit from the playhead controls.
          setHistoryPaused(true);
          return MAX_YEAR;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return stopHistoryRaf;
  }, [historyMode, historyPaused, historyBeat, stopHistoryRaf]);

  // No auto-dismiss for beat cards. The user clicks Continue (or hits a key)
  // when they're ready. Persistent display gives them time to read, decide
  // whether to dive into the named battle, or just take in the chapter.

  const handleHistoryStart = useCallback(() => {
    setSelectedBattle(null);
    setIsolatedBattle(null);
    setShowPlayback(false);
    setPlaybackBattles(null);
    setIntroVisible(false);
    setHistoryYear(MIN_YEAR);
    setHistoryPaused(false);
    setHistoryMode(true);
  }, []);

  const handleHistoryToggle = useCallback(() => {
    setHistoryPaused((p) => !p);
  }, []);

  // Stop the history sweep AND any running war/replay when the tab is
  // hidden or the window blurs. Audio is muted at the same time so a hidden
  // tab is fully silent. Resuming is an explicit user action when they come
  // back.
  usePauseOnHidden(useCallback(() => {
    setHistoryPaused(true);
    if (soundEnabled()) {
      disableSound();
      setSoundOn(false);
    }
  }, []));

  const handleHistoryClose = useCallback(() => {
    setHistoryMode(false);
    setHistoryPaused(false);
    setHistoryYear(MIN_YEAR);
    firedBeatsRef.current.clear();
  }, []);

  // initialWar holds a war name a search result wants WarPlayback to open
  // on. Set by handleSearchWarSelect and consumed by the WarPlayback prop
  // below. Cleared back to "" after WarPlayback mounts so a subsequent
  // user-initiated open of the panel does not jump back to the last
  // search result.
  const [initialWar, setInitialWar] = useState('');

  // handleSearchWarSelect is the wire from the search dropdown's war
  // section to WarPlayback. Filters the globe to the war so battle dots
  // outside the war fade, opens the war panel, and primes it on the
  // chosen war so the user lands inside the right curated context.
  const handleSearchWarSelect = useCallback((warName: string) => {
    setSelectedBattle(null);
    setIsolatedBattle(null);
    setReplayBattle(null);
    setReplayPhase(0);
    setHistoryMode(false);
    setHistoryBeat(null);
    setFilters((f) => ({ ...f, war: warName }));
    setInitialWar(warName);
    setShowPlayback(true);
  }, []);

  // handleResetView is the "back to the bare globe" action exposed via the
  // BattleSight wordmark. Clears every transient selection so a user who
  // has spelunked deep into a battle, war, or history sweep can get back
  // to the cold landing globe in one click.
  const handleResetView = useCallback(() => {
    setSelectedBattle(null);
    setIsolatedBattle(null);
    setPlaybackBattles(null);
    setShowPlayback(false);
    setReplayBattle(null);
    setReplayPhase(0);
    setHistoryMode(false);
    setHistoryPaused(false);
    setHistoryYear(MIN_YEAR);
    setHistoryBeat(null);
    firedBeatsRef.current.clear();
    setYearRange([MIN_YEAR, MAX_YEAR]);
    setFilters({ era: '', war: '', battleType: '', quality: '' });
    setWarCountryColors(null);
    setTerritoryLabel(null);
    setTerritoryFactions([]);
  }, []);

  // handleHistoryScrub moves the playhead to an explicit year and rewrites
  // the fired-beats set so a beat is not fired twice (when scrubbing forward
  // past a beat we already saw) and a beat can fire again if we scrubbed
  // backwards before it. The sweep is paused for the duration of the drag
  // so the user is in control while scrubbing; resume is an explicit action.
  const handleHistoryScrub = useCallback((targetYear: number) => {
    setHistoryYear(targetYear);
    setHistoryPaused(true);
    const next = new Set<number>();
    HISTORY_BEATS.forEach((beat, i) => {
      if (beat.year < targetYear) next.add(i);
    });
    firedBeatsRef.current = next;
    setHistoryBeat(null);
  }, []);

  // handleHistorySeekBeat snaps to a curated beat and surfaces its title
  // card immediately. The user clicked the marker because they want to read
  // that chapter, so we honor the intent rather than waiting for the sweep
  // to crawl back over the year.
  const handleHistorySeekBeat = useCallback((beatIndex: number) => {
    const beat = HISTORY_BEATS[beatIndex];
    if (!beat) return;
    setHistoryYear(beat.year);
    setHistoryPaused(true);
    const next = new Set<number>();
    HISTORY_BEATS.forEach((b, i) => {
      if (i < beatIndex) next.add(i);
      if (b.year < beat.year) next.add(i);
    });
    next.add(beatIndex);
    firedBeatsRef.current = next;
    setHistoryBeat(beat);
  }, []);

  const handleToggleSound = useCallback(() => {
    if (soundEnabled()) {
      disableSound();
      setSoundOn(false);
    } else {
      enableSound();
      setSoundOn(true);
      // Soft confirmation so the user hears that audio came online.
      playSelect();
    }
  }, []);

  const handleDismissIntro = useCallback(() => {
    setIntroVisible(false);
    localStorage.setItem('bt.intro_seen', '1');
  }, []);

  const handleStartWithFeatured = useCallback(() => {
    if (!featured) return;
    setIntroVisible(false);
    localStorage.setItem('bt.intro_seen', '1');
    setSelectedBattle(featured);
    setIsolatedBattle(featured);
    if (featured.hasReplay) {
      setReplayBattle(featured);
      setReplayPhase(0);
    }
  }, [featured]);

  const showPillars = !isolatedBattle && !playbackBattles && !selectedBattle;

  let globeBattles = battles;
  if (isolatedBattle) {
    globeBattles = [isolatedBattle];
  } else if (playbackBattles) {
    globeBattles = playbackBattles;
  }

  // Effective year window: during history playback this is a trailing range
  // from the very start of recorded history up to the current playhead, so
  // battles light up as we cross their year. Outside playback it's whatever
  // the user has dialed in on the timeline.
  const effectiveYearRange: [number, number] = historyMode
    ? [MIN_YEAR, Math.floor(historyYear) + 1]
    : yearRange;

  if (loading || !splashReady) {
    return (
      <div
        className="w-full h-full flex items-center justify-center bg-[#06070d] relative overflow-hidden"
        role="status"
        aria-live="polite"
      >
        {/* Atmospheric bloom only; no entrance animation on the text so the
            headline never appears half-opacity. The bloom breathes
            independently of any state change so the eye reads "alive"
            from the first frame. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 50% 55%, rgba(147,197,253,0.18) 0%, rgba(147,197,253,0.05) 32%, transparent 65%)',
            animation: 'splash-bloom 5000ms ease-in-out infinite',
          }}
        />

        <div
          className="relative text-center px-8 mx-auto w-full max-w-[1200px]"
          style={{ textAlign: 'center' }}
        >
          <div
            className="font-semibold uppercase mb-6"
            style={{
              fontSize: 11,
              letterSpacing: '0.55em',
              color: '#93c5fd',
              textShadow: '0 2px 14px rgba(0,0,0,0.7), 0 0 24px rgba(147,197,253,0.35)',
            }}
          >
            BATTLE TRACE
          </div>
          {/* Headline: two clean lines with explicit <span> blocks per
              line. Previously a single string with <br/> let the renderer
              break the first line on its own ("Two thousand five" / "hundred")
              at large viewports because the headline outgrew the container.
              Forcing each line into its own block locks the layout. */}
          <h1
            className="leading-[0.95] tracking-tight"
            style={{
              fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
              fontWeight: 600,
              fontSize: 'clamp(40px, 6.4vw, 82px)',
              letterSpacing: '-0.018em',
              color: '#ffffff',
              textShadow: '0 10px 40px rgba(0,0,0,0.85), 0 0 28px rgba(255,255,255,0.08)',
            }}
          >
            <span className="block whitespace-nowrap">Three thousand five hundred</span>
            <span className="block whitespace-nowrap">years of war</span>
          </h1>
          <div
            className="mx-auto mt-8 mb-6 h-px"
            style={{
              width: 140,
              background: 'linear-gradient(90deg, transparent 0%, rgba(147,197,253,0.85) 50%, transparent 100%)',
              boxShadow: '0 0 10px rgba(147,197,253,0.6)',
            }}
          />
          <p
            className="italic mx-auto"
            style={{
              fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
              fontSize: 17,
              lineHeight: 1.55,
              color: 'rgba(226,232,240,0.92)',
              textShadow: '0 2px 14px rgba(0,0,0,0.7)',
              maxWidth: '92ch',
              textAlign: 'center',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            From Megiddo to Mariupol
          </p>

          {/* Indeterminate progress sliver. Stays subtle so the headline
              owns the frame; reads as "machinery turning over." */}
          <div
            className="mt-10 mx-auto rounded-full overflow-hidden"
            style={{
              width: 320,
              height: 2,
              background: 'rgba(148,163,184,0.16)',
            }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: '32%',
                background: 'linear-gradient(90deg, transparent 0%, #93c5fd 50%, transparent 100%)',
                animation: 'splash-progress 2400ms ease-in-out infinite',
                boxShadow: '0 0 18px rgba(147,197,253,0.5)',
              }}
            />
          </div>
        </div>

        <style>{`
          @keyframes splash-bloom {
            0%, 100% { opacity: 0.6; transform: scale(1); }
            50%      { opacity: 0.95; transform: scale(1.05); }
          }
          @keyframes splash-progress {
            0%   { transform: translateX(-110%); }
            100% { transform: translateX(310%); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#06070d] relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at 50% 60%, rgba(244,63,94,0.18) 0%, transparent 60%)',
          }}
        />
        <div className="relative text-center px-8 max-w-md">
          <div className="text-[10px] font-semibold uppercase tracking-[0.5em] text-rose-300/85 mb-4">
            Battle&nbsp;Sight
          </div>
          <h2
            className="text-white text-2xl mb-3"
            style={{ fontFamily: "'Iowan Old Style', Georgia, serif", fontWeight: 600 }}
          >
            Could not reach the battle archive
          </h2>
          <p className="text-slate-400 text-[14px] mb-6 leading-relaxed">{error}</p>
          <button
            onClick={() => { setLoading(true); setError(null); fetchBattles(); }}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full text-[13px] font-semibold tracking-wide bg-white text-slate-900 hover:bg-slate-100 transition-colors shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {/* Command bar — wordmark, search, mode rail. Hidden while a war
          cinematic battle replay is active so the search box doesn't
          float over the cinematic action. The user closes the replay
          (or the war cinematic overlay) to get it back. */}
      {!(replayBattle && replayCinematic) && <CommandBar
        filters={filters}
        onFiltersChange={setFilters}
        onBattleSelect={handleBattleClick}
        onIsolate={handleIsolate}
        onPlaybackOpen={() => setShowPlayback(true)}
        playbackActive={showPlayback}
        battleCount={battles.length}
        onHistoryPlay={handleHistoryStart}
        historyActive={historyMode}
        soundOn={soundOn}
        onToggleSound={handleToggleSound}
        onResetView={handleResetView}
        onWarSelect={handleSearchWarSelect}
        onCommanderSelect={setCommanderQuery}
      />}

      <BattleGlobe
        battles={globeBattles}
        yearRange={effectiveYearRange}
        onBattleClick={handleBattleClick}
        selectedBattle={selectedBattle}
        dramatic={showPillars}
        atmosphereColor={activeTheme.atmosphere}
        warCountries={
          warCountries.length > 0
            ? warCountries
            : (selectedBattle ? canonCountriesForBattle(selectedBattle.sides) : [])
        }
        warAccent={activeTheme.accent}
        warCountryColors={warCountryColors ?? undefined}
        territoryLabel={territoryLabel ?? undefined}
      />

      {/* Era legend chip. Visible while the user is browsing the globe.
          Hidden during history mode (the playhead and beat cards own the
          top edge) and during replay (full-screen overlay covers it). */}
      {!historyMode && !replayBattle && (
        <EraLegend
          selectedEra={filters.era}
          onSelect={(era) => setFilters((f) => ({ ...f, era }))}
        />
      )}

      {/* Era-tinted screen vignette. A full-bleed overlay with a soft radial
          gradient that pulls the eye toward the center while staining the
          edges with the era's mood color. CSS transition smooths the cross
          between eras during history playback. */}
      <div
        className="pointer-events-none fixed inset-0 z-10 transition-[background] duration-[1500ms] ease-out"
        style={{
          background: `radial-gradient(ellipse at center, transparent 55%, ${activeTheme.vignette} 100%)`,
        }}
      />

      <TimelineSlider
        min={MIN_YEAR}
        max={MAX_YEAR}
        value={effectiveYearRange}
        onChange={setYearRange}
        battleCount={globeBattles.length}
        battles={battles}
      />

      {/* Cinematic title card. Keyed on battle id so each new selection
          remounts and re-fires the appear / hold / clear animation. Suppressed
          during war playback because the WarPlayback panel handles its own
          battle UI and rapid focus changes there caused the card to re-fire
          mid-animation, which read as flashing. Also suppressed during
          history mode for the same reason. */}
      {selectedBattle && !replayBattle && !showPlayback && !historyMode && (
        <BattleTitleCard key={`tc-${selectedBattle.id}`} battle={selectedBattle} />
      )}

      {/* The right-edge battle dossier only mounts when the user is browsing
          the globe directly, not while a war story or history sweep is on
          screen. Both of those have their own primary panels and rendering
          BattlePanel on top of them caused the right column to flicker as
          focus changed. */}
      {selectedBattle && !showPlayback && !historyMode && (
        <BattlePanel
          battle={selectedBattle}
          onClose={handleClosePanel}
          onWatchReplay={handleWatchReplay}
          onShare={handleShareSelected}
          onCommanderClick={setCommanderQuery}
        />
      )}

      {commanderQuery && (
        <CommanderPanel
          name={commanderQuery}
          onClose={() => setCommanderQuery('')}
          onBattleClick={(b) => {
            setCommanderQuery('');
            setSelectedBattle(b);
          }}
        />
      )}

      {/* Territory snapshot HUD. Drops a small caption at the top-centre of
          the viewport during war cinematic playback, naming the campaign
          beat the current battle year lands on ("June 1944: D-Day,
          Bagration"). Re-keyed on label so each new beat remounts and
          re-plays the fade-in, reading as a stage card rather than a
          silent shade change. */}
      {showPlayback && territoryLabel && (
        <div
          key={`terr-${territoryLabel}`}
          className="pointer-events-none fixed left-1/2 z-30 -translate-x-1/2"
          style={{
            top: 88,
            animation: 'territory-cap 4200ms ease-out forwards',
          }}
        >
          <div
            className="rounded-full border px-4 py-1.5 text-[10.5px] font-semibold uppercase backdrop-blur-md"
            style={{
              letterSpacing: '0.34em',
              color: activeTheme.accent,
              borderColor: `${activeTheme.accent}66`,
              background: 'rgba(10,12,18,0.6)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
              textShadow: '0 1px 8px rgba(0,0,0,0.7)',
            }}
          >
            {territoryLabel}
          </div>
        </div>
      )}

      {/* Faction legend. While a war cinematic plays, list the active sides
          with their accent color so the user can read the globe shading at
          a glance instead of guessing what Axis red or French blue mean.
          Bottom-right so it doesn't compete with the dossier panel on the
          right or the chrome stack on the left. */}
      {showPlayback && territoryFactions.length > 0 && (
        <div
          className="pointer-events-none fixed right-4 bottom-24 z-30"
          style={{ animation: 'legend-fade 600ms ease-out both' }}
        >
          <div
            className="rounded-lg border px-3 py-2 backdrop-blur-md"
            style={{
              borderColor: 'rgba(148,163,184,0.28)',
              background: 'rgba(10,12,18,0.62)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
              minWidth: 140,
            }}
          >
            <div
              className="text-[8.5px] font-semibold uppercase text-slate-400 mb-1.5"
              style={{ letterSpacing: '0.3em' }}
            >
              Factions
            </div>
            <div className="flex flex-col gap-1">
              {territoryFactions.map((owner) => (
                <div key={owner} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block rounded-sm"
                    style={{
                      width: 10,
                      height: 10,
                      background: OWNER_COLORS[owner] || '#64748b',
                      boxShadow: `0 0 8px ${OWNER_COLORS[owner] || '#64748b'}80`,
                    }}
                  />
                  <span className="text-[11px] text-slate-200 leading-none">
                    {OWNER_LABELS[owner] || owner}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes territory-cap {
          0%   { opacity: 0; transform: translate(-50%, -8px); }
          12%  { opacity: 1; transform: translate(-50%, 0); }
          82%  { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, 0); }
        }
        @keyframes legend-fade {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {showPlayback && (
        <WarPlayback
          onBattleFocus={handleBattleClick}
          onBattlesLoaded={setPlaybackBattles}
          onClose={() => { setInitialWar(''); handlePlaybackClose(); }}
          onWarSelected={handleWarSelected}
          onWarCountries={setWarCountries}
          onPlayReplay={handleWarOpenReplay}
          onCloseReplay={handleWarCloseReplay}
          onWarTerritory={handleWarTerritory}
          cinematicAdvanceTick={cinematicAdvanceTick}
          cinematicPrevTick={cinematicPrevTick}
          initialWar={initialWar}
        />
      )}

      {replayBattle && (
        <BattleReplay
          battle={replayBattle}
          initialPhase={replayPhase}
          onPhaseChange={setReplayPhase}
          onClose={handleCloseReplay}
          cinematicMode={replayCinematic}
          onEnded={replayCinematic ? handleCinematicBattleEnded : undefined}
          onAdvanceNext={replayCinematic ? handleCinematicBattleEnded : undefined}
          onAdvancePrev={replayCinematic ? handleCinematicAdvancePrev : undefined}
          warCountryColors={warCountryColors ?? undefined}
        />
      )}

      {introVisible && featured && (
        <IntroOverlay
          featured={featured}
          onDismiss={handleDismissIntro}
          onStart={handleStartWithFeatured}
        />
      )}

      {/* The playhead and the beat card occupy the same top zone, so the
          playhead steps aside while a beat card is on screen. The card
          already shows the year and era mood, so no info is lost. */}
      {historyMode && !historyBeat && (
        <HistoryPlayhead
          year={Math.floor(historyYear)}
          minYear={MIN_YEAR}
          maxYear={MAX_YEAR}
          theme={activeTheme}
          playing={!historyPaused}
          beats={HISTORY_BEATS}
          battleCount={globeBattles.filter((b) => b.year <= Math.floor(historyYear) + 1).length}
          onToggle={handleHistoryToggle}
          onClose={handleHistoryClose}
          onScrub={handleHistoryScrub}
          onSeekBeat={handleHistorySeekBeat}
        />
      )}

      {/* Beat title card. Mounts whenever the sweep crosses a curated year
          and pauses the advance loop while it is visible. The card stays up
          until the user clicks Continue (or hits Enter/Space/Esc); Read more
          jumps to the dossier without auto-playing; Watch jumps and plays.
          Keyed on year so consecutive beats remount cleanly. */}
      {historyBeat && (
        <HistoryBeatCard
          key={`hb-${historyBeat.year}`}
          beat={historyBeat}
          onContinue={() => setHistoryBeat(null)}
          onLearnMore={(battleId) => {
            setHistoryMode(false);
            setHistoryPaused(false);
            setHistoryBeat(null);
            firedBeatsRef.current.clear();
            fetch(`/api/battles/${battleId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((b: Battle | null) => {
                if (!b) return;
                setSelectedBattle(b);
                setIsolatedBattle(b);
              })
              .catch(() => {});
          }}
          onJump={(battleId) => {
            setHistoryMode(false);
            setHistoryPaused(false);
            setHistoryBeat(null);
            firedBeatsRef.current.clear();
            fetch(`/api/battles/${battleId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((b: Battle | null) => {
                if (!b) return;
                setSelectedBattle(b);
                setIsolatedBattle(b);
                if (b.hasReplay) {
                  setReplayBattle(b);
                  setReplayPhase(0);
                }
              })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
