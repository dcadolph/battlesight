import { useState, useRef, useEffect, useCallback } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';

interface NameCount { name: string; count: number; }
interface StatsData {
  totalBattles: number;
  verifiedBattles: number;
  replayCount: number;
  eras: NameCount[];
  wars: NameCount[];
  battleTypes: NameCount[];
}
interface Filters { era: string; war: string; battleType: string; quality: string }

interface CommandBarProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onBattleSelect: (battle: Battle) => void;
  onIsolate: (battle: Battle | null) => void;
  onPlaybackOpen: () => void;
  playbackActive: boolean;
  battleCount: number;
  // onHistoryPlay starts the cinematic year-sweep overlay.
  onHistoryPlay: () => void;
  // historyActive reflects whether the year-sweep is currently on screen.
  historyActive: boolean;
  // soundOn / onToggleSound expose the ambient audio toggle in the chrome.
  soundOn: boolean;
  onToggleSound: () => void;
}

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BC` : `${year}`;
}

export default function CommandBar({
  filters,
  onFiltersChange,
  onBattleSelect,
  onIsolate,
  onPlaybackOpen,
  playbackActive,
  battleCount,
  onHistoryPlay,
  historyActive,
  soundOn,
  onToggleSound,
}: CommandBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Battle[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [panel, setPanel] = useState<'none' | 'filters'>('none');
  const [stats, setStats] = useState<StatsData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetch('/api/battles/stats').then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); setSearchOpen(false); return; }
    fetch(`/api/battles/search?q=${encodeURIComponent(q)}&limit=8`)
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

  const hasFilters = !!(filters.era || filters.war || filters.battleType || filters.quality);

  return (
    <>
      {/* Title */}
      <div className="fixed top-4 left-5 z-40 select-none">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Battle<span className="text-blue-400">Trace</span>
          </h1>
          <span className="text-[11px] text-slate-600 tabular-nums">
            {battleCount.toLocaleString()} battles
            {stats && stats.replayCount > 0 && (
              <span className="ml-2 text-blue-400/80">· {stats.replayCount} replays</span>
            )}
          </span>
        </div>
      </div>

      {/* Sound toggle: small, discreet, top-right. Muted by default so the
          first impression of the page is silent; users opt in. The icon is
          plain text so we don't pay for an icon font. */}
      <button
        onClick={onToggleSound}
        className="fixed top-4 right-5 z-40 h-8 px-3 rounded-full text-[11px] font-medium tracking-wide bg-slate-800/70 border border-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-700/80 transition-colors"
        title={soundOn ? 'Sound on. Click to mute.' : 'Sound off. Click for ambient audio.'}
      >
        {soundOn ? '♪ Sound' : '♪ Muted'}
      </button>

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
                  {b.hasReplay && (
                    <span className="text-[9px] text-blue-300 px-1 rounded bg-blue-500/20" title="Has phase replay">▶</span>
                  )}
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
        <div className="flex items-center gap-5 px-1">
          <button
            onClick={() => { setPanel('none'); }}
            className={`h-8 text-[12px] font-medium tracking-wide transition-colors border-b-2 ${
              !playbackActive && !historyActive
                ? 'text-white border-blue-400'
                : 'text-slate-500 hover:text-slate-300 border-transparent'
            }`}
          >
            Explore
          </button>
          <button
            onClick={onPlaybackOpen}
            className={`h-8 text-[12px] font-medium tracking-wide transition-colors border-b-2 ${
              playbackActive
                ? 'text-white border-blue-400'
                : 'text-slate-500 hover:text-slate-300 border-transparent'
            }`}
          >
            Wars
          </button>
          <button
            onClick={onHistoryPlay}
            className={`h-8 text-[12px] font-medium tracking-wide transition-colors border-b-2 ${
              historyActive
                ? 'text-white border-blue-400'
                : 'text-slate-500 hover:text-slate-300 border-transparent'
            }`}
            title="Play 2,500 years of history in 90 seconds"
          >
            ▶ History
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
              Filters{hasFilters ? ` (${[filters.era, filters.war, filters.battleType, filters.quality].filter(Boolean).length})` : ''}
            </button>
            {hasFilters && (
              <button
                onClick={() => onFiltersChange({ era: '', war: '', battleType: '', quality: '' })}
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
        <div className="fixed top-[130px] left-5 z-40 w-64 bg-[#16171f] border border-slate-700/60 rounded-lg shadow-xl p-3 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] text-slate-600 uppercase tracking-wider">Tier</label>
              <span className="text-[9px] text-slate-700 normal-case">Trust contract</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {([
                { v: 'reconstructed', label: 'Reconstructed', desc: `${stats.replayCount} battles with hand-built phase replays` },
                { v: '', label: 'Documented', desc: `Curated + clean Wikidata. The default; ${stats.totalBattles.toLocaleString()} max.` },
                { v: 'indexed', label: 'Indexed', desc: 'Sparse Wikidata entries. Treat as a pointer to Wikipedia.' },
                { v: 'all', label: 'All', desc: 'No quality gate, including messy records.' },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => onFiltersChange({ ...filters, quality: opt.v })}
                  className={`h-7 px-2 rounded text-[10px] transition-colors ${
                    (filters.quality || '') === opt.v
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-[#1c1d27] text-slate-500 border border-slate-700/30 hover:text-slate-300'
                  }`}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-slate-600">
              Reconstructed has phase-by-phase animation. Documented has verified sides and dates. Indexed entries are just a name and coordinates — open Wikipedia for the story.
            </p>
          </div>

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
