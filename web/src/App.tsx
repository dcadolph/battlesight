import { useEffect, useState, useCallback } from 'react';
import BattleGlobe from './components/BattleGlobe';
import TimelineSlider from './components/TimelineSlider';
import BattlePanel from './components/BattlePanel';
import CommandBar from './components/CommandBar';
import WarPlayback from './components/WarPlayback';
import type { Battle } from './types/battle';

const MIN_YEAR = -500;
const MAX_YEAR = 2025;

interface Filters {
  era: string;
  war: string;
  battleType: string;
}

export default function App() {
  const [battles, setBattles] = useState<Battle[]>([]);
  const [yearRange, setYearRange] = useState<[number, number]>([MIN_YEAR, MAX_YEAR]);
  const [selectedBattle, setSelectedBattle] = useState<Battle | null>(null);
  const [isolatedBattle, setIsolatedBattle] = useState<Battle | null>(null);
  const [playbackBattles, setPlaybackBattles] = useState<Battle[] | null>(null);
  const [filters, setFilters] = useState<Filters>({ era: '', war: '', battleType: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPlayback, setShowPlayback] = useState(false);

  const fetchBattles = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.era) params.set('era', filters.era);
    if (filters.war) params.set('war', filters.war);
    if (filters.battleType) params.set('battleType', filters.battleType);
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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedBattle(null);
        setIsolatedBattle(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

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
        <BattlePanel battle={selectedBattle} onClose={handleClosePanel} />
      )}

      {showPlayback && (
        <WarPlayback
          onBattleFocus={handleBattleClick}
          onBattlesLoaded={setPlaybackBattles}
          onClose={handlePlaybackClose}
        />
      )}
    </div>
  );
}
