import { useState, useRef, useEffect, useCallback } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';

interface NameCount { name: string; count: number; }
interface StatsData { totalBattles: number; eras: NameCount[]; wars: NameCount[]; battleTypes: NameCount[]; }
interface Filters { era: string; war: string; battleType: string; }

interface CommandBarProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onBattleSelect: (battle: Battle) => void;
  onIsolate: (battle: Battle | null) => void;
  onPlaybackOpen: () => void;
  playbackActive: boolean;
  battleCount: number;
}

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BC` : `${year}`;
}

export default function CommandBar({ filters, onFiltersChange, onBattleSelect, onIsolate, onPlaybackOpen, playbackActive, battleCount }: CommandBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Battle[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [panel, setPanel] = useState<'none' | 'filters'>('none');
  const [stats, setStats] = useState<StatsData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetch('/api/battles/stats').then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); setSearchOpen(false); return; }
    fetch(`/api/battles/search?q=${encodeURIComponent(q)}&limit=6`)
      .then((r) => r.json())
      .then((d) => { setResults(d.battles || []); setSearchOpen(true); setActiveIndex(-1); })
      .catch(() => setResults([]));
  }, []);

  const handleChange = (v: string) => {
    setQuery(v);
    if (v === '') onIsolate(null);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(v), 250);
  };

  const handleSelect = (battle: Battle) => {
    setQuery('');
    setResults([]);
    setSearchOpen(false);
    onIsolate(battle);
    onBattleSelect(battle);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setSearchOpen(false);
    onIsolate(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { handleClear(); inputRef.current?.blur(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((p) => Math.min(p + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((p) => Math.max(p - 1, 0)); }
    else if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) handleSelect(results[activeIndex]);
  };

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !['INPUT','TEXTAREA','SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const hasFilters = !!(filters.era || filters.war || filters.battleType);

  return (
    <>
      {/* Title */}
      <div className="fixed top-4 left-5 z-40 select-none">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Battle<span className="text-blue-400">Trace</span>
          </h1>
          <span className="text-[11px] text-slate-600 tabular-nums">{battleCount.toLocaleString()} battles</span>
        </div>
      </div>

      {/* Search */}
      <div className="fixed top-12 left-5 z-40 w-64">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Search battles..."
            className="w-full h-10 px-4 bg-[#1e2030] border border-slate-600/50 rounded-xl text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-blue-400/70 focus:bg-[#232538] shadow-lg transition-all"
          />
          {query && (
            <button onClick={handleClear} className="absolute right-3 top-2.5 text-slate-500 hover:text-white text-lg leading-none">&times;</button>
          )}
        </div>

        {/* Search results dropdown */}
        {searchOpen && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#16171f] border border-slate-700/60 rounded-lg overflow-hidden shadow-xl z-50">
            {results.map((b, i) => (
              <button
                key={b.id}
                onMouseDown={() => handleSelect(b)}
                className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                  i === activeIndex ? 'bg-slate-700/50' : 'hover:bg-slate-800/50'
                } ${i > 0 ? 'border-t border-slate-800/50' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: ERA_COLORS[b.era] || '#666' }} />
                  <span className="text-slate-200 truncate flex-1">{b.name}</span>
                  <span className="text-[10px] text-slate-600 flex-shrink-0">{formatYear(b.year)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {searchOpen && query.length >= 2 && results.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#16171f] border border-slate-700/60 rounded-lg p-3 text-center text-[12px] text-slate-600 shadow-xl z-50">
            No results
          </div>
        )}
      </div>

      {/* Mode tabs */}
      <div className="fixed top-[88px] left-5 z-40">
        <div className="flex bg-[#16171f] rounded-lg border border-slate-700/50 overflow-hidden">
          <button
            onClick={() => { setPanel('none'); }}
            className={`h-8 px-4 text-[12px] font-medium transition-colors ${
              !playbackActive
                ? 'bg-blue-500/15 text-blue-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Explore
          </button>
          <button
            onClick={onPlaybackOpen}
            className={`h-8 px-4 text-[12px] font-medium transition-colors ${
              playbackActive
                ? 'bg-blue-500/15 text-blue-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Stories
          </button>
        </div>

        {!playbackActive && (
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={() => setPanel(panel === 'filters' ? 'none' : 'filters')}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                panel === 'filters' || hasFilters
                  ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : 'bg-[#1e2030] text-slate-400 border border-slate-600/50 hover:text-white hover:border-slate-500/60'
              }`}
            >
              Filters{hasFilters ? ` (${[filters.era, filters.war, filters.battleType].filter(Boolean).length})` : ''}
            </button>
            {hasFilters && (
              <button
                onClick={() => onFiltersChange({ era: '', war: '', battleType: '' })}
                className="h-7 px-2 rounded-md text-[10px] text-slate-600 hover:text-slate-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filter panel */}
      {!playbackActive && panel === 'filters' && stats && (
        <div className="fixed top-[130px] left-5 z-40 w-56 bg-[#16171f] border border-slate-700/60 rounded-lg shadow-xl p-3 space-y-2">
          <div>
            <label className="block text-[10px] text-slate-600 uppercase tracking-wider mb-1">Era</label>
            <select
              value={filters.era}
              onChange={(e) => onFiltersChange({ ...filters, era: e.target.value })}
              className="w-full h-7 bg-[#1c1d27] border border-slate-700/40 rounded text-[12px] text-slate-300 px-2 focus:outline-none focus:border-blue-500/50"
            >
              <option value="">All</option>
              {stats.eras.map((e) => (
                <option key={e.name} value={e.name}>{ERA_LABELS[e.name] || e.name} ({e.count})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-600 uppercase tracking-wider mb-1">Type</label>
            <div className="flex flex-wrap gap-1">
              {stats.battleTypes.map((bt) => (
                <button
                  key={bt.name}
                  onClick={() => onFiltersChange({ ...filters, battleType: filters.battleType === bt.name ? '' : bt.name })}
                  className={`h-6 px-2 rounded text-[10px] capitalize transition-colors ${
                    filters.battleType === bt.name
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-[#1c1d27] text-slate-500 border border-slate-700/30 hover:text-slate-300'
                  }`}
                >
                  {bt.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
