import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import BattleGlobe from './components/BattleGlobe';
import TimelineSlider from './components/TimelineSlider';
import BattlePanel from './components/BattlePanel';
import CommandBar from './components/CommandBar';
import WarPlayback from './components/WarPlayback';
import BattleReplay from './components/replay/BattleReplay';
import IntroOverlay from './components/IntroOverlay';
import HistoryPlayhead from './components/HistoryPlayhead';
import BattleTitleCard from './components/BattleTitleCard';
import HistoryBeatCard from './components/HistoryBeatCard';
import { HISTORY_BEATS, type HistoryBeat } from './data/history-beats';
import type { Battle } from './types/battle';
import { themeForEra, themeForYear } from './theme/era';
import { enableSound, disableSound, soundEnabled, setSoundEra, playSelect } from './audio/sound';

const MIN_YEAR = -500;
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
  const [filters, setFilters] = useState<Filters>({ era: '', war: '', battleType: '', quality: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlayback, setShowPlayback] = useState(false);
  const [replayBattle, setReplayBattle] = useState<Battle | null>(null);
  const [replayPhase, setReplayPhase] = useState(0);
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
  // firedBeats tracks beat years already shown in this run so a single sweep
  // does not flash the same beat twice. Cleared whenever history mode
  // restarts. Held in a ref so we don't re-fire on each state change.
  const firedBeatsRef = useRef<Set<number>>(new Set());
  const [soundOn, setSoundOn] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

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
        setSelectedBattle(null);
        setIsolatedBattle(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [replayBattle, introVisible, historyMode]);

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

  const handlePlaybackClose = useCallback(() => {
    setShowPlayback(false);
    setPlaybackBattles(null);
  }, []);

  const handleWatchReplay = useCallback(() => {
    if (!selectedBattle) return;
    setReplayBattle(selectedBattle);
    setReplayPhase(0);
  }, [selectedBattle]);

  const handleCloseReplay = useCallback(() => {
    setReplayBattle(null);
    setReplayPhase(0);
  }, []);

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

  // BEAT_CARD_MS is how long a history-beat title card stays on screen while
  // the sweep pauses. Tuned for "see the headline, read the dossier line".
  const BEAT_CARD_MS = 3200;

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
        // Check whether the advance just crossed a curated beat. We snap the
        // playhead to the beat's year and surface the title card so the
        // sweep feels like a guided tour rather than years flashing past.
        for (const beat of HISTORY_BEATS) {
          if (firedBeatsRef.current.has(beat.year)) continue;
          if (y < beat.year && next >= beat.year) {
            firedBeatsRef.current.add(beat.year);
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

  // Beat card auto-dismiss. When a beat fires we sleep for BEAT_CARD_MS,
  // then clear it so the advance loop resumes.
  useEffect(() => {
    if (!historyBeat) return;
    const t = setTimeout(() => setHistoryBeat(null), BEAT_CARD_MS);
    return () => clearTimeout(t);
  }, [historyBeat]);

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

  const handleHistoryClose = useCallback(() => {
    setHistoryMode(false);
    setHistoryPaused(false);
    setHistoryYear(MIN_YEAR);
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

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0f]">
        <div className="text-center">
          <div className="text-3xl font-bold text-white mb-2 tracking-tight">BattleTrace</div>
          <div className="text-slate-500 text-sm">Loading battles...</div>
          <div className="mt-4 w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0f]">
        <div className="text-center">
          <div className="text-3xl font-bold text-white mb-2 tracking-tight">BattleTrace</div>
          <div className="text-red-400 text-sm mb-4">{error}</div>
          <button
            onClick={() => { setLoading(true); setError(null); fetchBattles(); }}
            className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-sm hover:bg-blue-500/30 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <CommandBar
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
      />

      <BattleGlobe
        battles={globeBattles}
        yearRange={effectiveYearRange}
        onBattleClick={handleBattleClick}
        selectedBattle={selectedBattle}
        dramatic={showPillars}
        atmosphereColor={activeTheme.atmosphere}
      />

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
        />
      )}

      {showPlayback && (
        <WarPlayback
          onBattleFocus={handleBattleClick}
          onBattlesLoaded={setPlaybackBattles}
          onClose={handlePlaybackClose}
          onWarSelected={(name) => {
            // Fresh war pick: drop the detail panel and any single-battle
            // isolation so the user sees the whole war on the globe before
            // diving into a specific battle.
            if (name) {
              setSelectedBattle(null);
              setIsolatedBattle(null);
            }
          }}
          onPlayReplay={(b) => { setReplayBattle(b); setReplayPhase(0); }}
          onCloseReplay={() => { setReplayBattle(null); setReplayPhase(0); }}
        />
      )}

      {replayBattle && (
        <BattleReplay
          battle={replayBattle}
          initialPhase={replayPhase}
          onPhaseChange={setReplayPhase}
          onClose={handleCloseReplay}
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
          theme={activeTheme}
          playing={!historyPaused}
          onToggle={handleHistoryToggle}
          onClose={handleHistoryClose}
        />
      )}

      {/* Beat title card. Mounts whenever the sweep crosses a curated year
          and pauses the advance loop while it is visible so the user can
          read the dossier. The optional jump button exits history mode and
          opens the linked replay. Keyed on year so consecutive beats
          remount cleanly and re-fire the appear animation. */}
      {historyBeat && (
        <HistoryBeatCard
          key={`hb-${historyBeat.year}`}
          beat={historyBeat}
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
