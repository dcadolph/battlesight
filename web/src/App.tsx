import { useEffect, useState, useCallback } from 'react';
import BattleGlobe from './components/BattleGlobe';
import TimelineSlider from './components/TimelineSlider';
import BattlePanel from './components/BattlePanel';
import CommandBar from './components/CommandBar';
import WarPlayback from './components/WarPlayback';
import BattleReplay from './components/replay/BattleReplay';
import IntroOverlay from './components/IntroOverlay';
import type { Battle } from './types/battle';

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

  const fetchBattles = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.era) params.set('era', filters.era);
    if (filters.war) params.set('war', filters.war);
    if (filters.battleType) params.set('battleType', filters.battleType);
    if (filters.quality) params.set('quality', filters.quality);
    if (yearRange[0] !== MIN_YEAR) params.set('yearMin', String(yearRange[0]));
    if (yearRange[1] !== MAX_YEAR) params.set('yearMax', String(yearRange[1]));

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
  }, [filters, yearRange]);

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
        setSelectedBattle(null);
        setIsolatedBattle(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [replayBattle, introVisible]);

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
      />

      <BattleGlobe
        battles={globeBattles}
        yearRange={yearRange}
        onBattleClick={handleBattleClick}
        selectedBattle={selectedBattle}
        dramatic={showPillars}
      />

      <TimelineSlider
        min={MIN_YEAR}
        max={MAX_YEAR}
        value={yearRange}
        onChange={setYearRange}
        battleCount={globeBattles.length}
      />

      {selectedBattle && (
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
    </div>
  );
}
