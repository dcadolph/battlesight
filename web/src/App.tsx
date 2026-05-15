import { useEffect, useState, useCallback } from 'react';
import BattleGlobe from './components/BattleGlobe';
import TimelineSlider from './components/TimelineSlider';
import BattlePanel from './components/BattlePanel';
import type { Battle } from './types/battle';

const MIN_YEAR = -500;
const MAX_YEAR = 2025;

export default function App() {
  const [battles, setBattles] = useState<Battle[]>([]);
  const [yearRange, setYearRange] = useState<[number, number]>([MIN_YEAR, MAX_YEAR]);
  const [selectedBattle, setSelectedBattle] = useState<Battle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/battles')
      .then((res) => res.json())
      .then((data) => {
        setBattles(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch battles:', err);
        setLoading(false);
      });
  }, []);

  const filteredCount = battles.filter(
    (b) => b.year >= yearRange[0] && b.year <= yearRange[1]
  ).length;

  const handleBattleClick = useCallback((battle: Battle) => {
    setSelectedBattle(battle);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedBattle(null);
  }, []);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0f]">
        <div className="text-center">
          <div className="text-3xl font-bold text-white mb-2 tracking-tight">BattleTrace</div>
          <div className="text-slate-500 text-sm">Loading battles...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div className="fixed top-5 left-6 z-20">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Battle<span className="text-blue-400">Trace</span>
        </h1>
        <p className="text-slate-500 text-xs mt-0.5">Trace every conflict</p>
      </div>

      <BattleGlobe
        battles={battles}
        yearRange={yearRange}
        onBattleClick={handleBattleClick}
        selectedBattle={selectedBattle}
      />

      <TimelineSlider
        min={MIN_YEAR}
        max={MAX_YEAR}
        value={yearRange}
        onChange={setYearRange}
        battleCount={filteredCount}
      />

      {selectedBattle && (
        <BattlePanel battle={selectedBattle} onClose={handleClosePanel} />
      )}
    </div>
  );
}
