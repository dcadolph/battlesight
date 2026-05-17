import { useState, useRef, useEffect, useCallback } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';
import { formatYear } from '../lib/format';

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
  // onResetView is the "home" action fired when the user clicks the
  // BattleTrace wordmark. Clears every transient selection so the app
  // returns to the bare landing globe.
  onResetView: () => void;
  // onWarSelect opens the war playback panel preselected on the named
  // war. Used when a search match resolves to a war rather than to a
  // single battle, so the user lands inside the right curated context.
  onWarSelect: (warName: string) => void;
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
  onResetView,
  onWarSelect,
}: CommandBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Battle[]>([]);
  const [warResults, setWarResults] = useState<NameCount[]>([]);
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
    if (q.length < 2) {
      setResults([]);
      setWarResults([]);
      setSearchOpen(false);
      return;
    }
    // Battle results from the FTS index.
    fetch(`/api/battles/search?q=${encodeURIComponent(q)}&limit=8`)
      .then((r) => r.json())
      .then((d) => { setResults(d.battles || []); setSearchOpen(true); setActiveIndex(-1); })
      .catch(() => setResults([]));
    // War results filtered client-side from the stats endpoint's war list.
    // No need for a dedicated war search endpoint when the full set fits in
    // memory and a substring match covers the typical "I'm hunting for a
    // war by name" use case (Vietnam, Mongol, Hundred Years, etc.).
    if (stats && stats.wars) {
      const needle = q.toLowerCase();
      const matches = stats.wars
        .filter((w) => w.name.toLowerCase().includes(needle))
        .slice(0, 5);
      setWarResults(matches);
    } else {
      setWarResults([]);
    }
  }, [stats]);

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
    setWarResults([]);
    setSearchOpen(false);
    onIsolate(null);
  };

  const handleWarSelect = (warName: string) => {
    setQuery('');
    setResults([]);
    setWarResults([]);
    setSearchOpen(false);
    onWarSelect(warName);
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
      {/* Title block with co-located sound toggle. Previously the sound
          toggle floated at top-right, which collided with the close buttons
          on BattlePanel and WarPlayback (both occupy the full-height right
          column). Living next to the title keeps it out of every right-side
          panel's chrome lane permanently. */}
      <div className="fixed top-4 left-5 z-40 select-none">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onResetView}
            className="text-xl font-bold text-white tracking-tight leading-none hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 rounded-sm"
            title="Back to the main globe"
            aria-label="Reset view: back to the main globe"
          >
            Battle<span className="text-blue-400">Trace</span>
          </button>
          <span className="text-[11px] text-slate-600 tabular-nums leading-none pt-[2px]">
            {battleCount.toLocaleString()} battles
            {stats && stats.replayCount > 0 && (
              <span className="ml-2 text-blue-400/80">· {stats.replayCount} replays</span>
            )}
          </span>
          <button
            onClick={onToggleSound}
            className="ml-1 inline-flex items-center justify-center h-6 w-6 rounded-full text-slate-400 hover:text-white bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            title={soundOn ? 'Sound on. Click to mute.' : 'Sound off. Click for ambient audio.'}
            aria-label={soundOn ? 'Mute ambient audio' : 'Enable ambient audio'}
            aria-pressed={soundOn}
          >
            {soundOn ? (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M2 5 L4 5 L7 2 L7 10 L4 7 L2 7 Z"/><path d="M8.5 4 Q10 6 8.5 8" stroke="currentColor" strokeWidth="0.9" fill="none" strokeLinecap="round"/></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M2 5 L4 5 L7 2 L7 10 L4 7 L2 7 Z"/><path d="M9 4 L11 8 M11 4 L9 8" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/></svg>
            )}
          </button>
        </div>
      </div>

      {/* Search. The container is z-[100] so the dropdown is unambiguously
          above the mode-tab row below it. Tabs sit at z-30; this gives the
          dropdown a clear two-rank lead so no future stacking-context tweak
          can paint tabs back through the search results. */}
      <div className="fixed top-12 left-5 z-[100] w-64">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => (results.length > 0 || warResults.length > 0) && setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Search battles, wars, places, or paste lat, lng..."
            className="w-full h-10 px-4 bg-[#1e2030] border border-slate-600/50 rounded-xl text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-blue-400/70 focus:bg-[#232538] shadow-lg transition-all"
          />
          {query && (
            <button onClick={handleClear} className="absolute right-3 top-2.5 text-slate-500 hover:text-white text-lg leading-none">&times;</button>
          )}
        </div>

        {/* Search dropdown. Wars surface first (small section) since a
            named war is usually the bigger umbrella the user is hunting
            for; battles follow underneath. Either section is suppressed
            when it has no matches. */}
        {searchOpen && (warResults.length > 0 || results.length > 0) && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#16171f] border border-slate-700/60 rounded-lg overflow-hidden shadow-xl z-[100]">
            {warResults.length > 0 && (
              <div>
                <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-[0.22em] text-slate-500 bg-slate-900/40">
                  Wars
                </div>
                {warResults.map((w) => (
                  <button
                    key={`war-${w.name}`}
                    onMouseDown={() => handleWarSelect(w.name)}
                    className="w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-slate-800/60 border-t border-slate-800/40"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                      <span className="text-white truncate flex-1 font-medium">{w.name}</span>
                      <span className="text-[10px] text-slate-500 flex-shrink-0 tabular-nums">
                        {w.count.toLocaleString()} battles
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {results.length > 0 && (
              <div>
                {warResults.length > 0 && (
                  <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-[0.22em] text-slate-500 bg-slate-900/40 border-t border-slate-800/60">
                    Battles
                  </div>
                )}
                {results.map((b, i) => (
                  <button
                    key={b.id}
                    onMouseDown={() => handleSelect(b)}
                    className={`w-full text-left px-3 py-2 text-[12px] transition-colors ${
                      i === activeIndex ? 'bg-slate-700/50' : 'hover:bg-slate-800/50'
                    } border-t border-slate-800/50`}
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
          </div>
        )}

        {searchOpen && query.length >= 2 && results.length === 0 && warResults.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#16171f] border border-slate-700/60 rounded-lg p-3 text-center text-[12px] text-slate-600 shadow-xl z-[100]">
            No results
          </div>
        )}
      </div>

      {/* Mode tabs. Three primary modes (Explore / Wars / History) wrapped
          in a single glass capsule. Active mode pops with a soft accent
          fill and a tracked label; inactive modes hover to slate. SVG
          glyphs disambiguate at a glance. The previous border-underline
          treatment was functional but felt like a vanilla nav bar; this
          reads as crafted chrome. */}
      <div className="fixed top-[88px] left-5 z-30">
        <div
          className="inline-flex items-center gap-1 rounded-full p-1 backdrop-blur-md"
          style={{
            background: 'rgba(8, 10, 18, 0.6)',
            border: '1px solid rgba(148, 163, 184, 0.16)',
            boxShadow: '0 8px 24px -10px rgba(0, 0, 0, 0.55)',
          }}
        >
          <ModeTab
            label="Explore"
            active={!playbackActive && !historyActive}
            onClick={() => { setPanel('none'); }}
            icon={
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="6" cy="6" r="4.5" />
                <path d="M6 1.5 V 10.5 M1.5 6 H 10.5" />
              </svg>
            }
          />
          <ModeTab
            label="Wars"
            active={playbackActive}
            onClick={onPlaybackOpen}
            icon={
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 1.5 V 10.5 M2 1.5 L 9 4 L 2 6" />
              </svg>
            }
          />
          <ModeTab
            label="History"
            active={historyActive}
            onClick={onHistoryPlay}
            title="Play 3,500 years of history in 90 seconds"
            icon={
              <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2.5 1.5 L 10.5 6 L 2.5 10.5 Z" />
              </svg>
            }
          />
        </div>

        {!playbackActive && (
          <div className="flex gap-1.5 mt-3">
            <button
              onClick={() => setPanel(panel === 'filters' ? 'none' : 'filters')}
              className={`h-8 px-3 rounded-full text-[11px] font-semibold tracking-wide transition-all flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 ${
                panel === 'filters' || hasFilters
                  ? 'bg-blue-500/20 text-blue-200 border border-blue-500/40'
                  : 'bg-slate-800/70 text-slate-300 border border-slate-600/50 hover:text-white hover:border-slate-500/70 backdrop-blur-md'
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M1 2.5 H 11 M3 6 H 9 M5 9.5 H 7" />
              </svg>
              Filters
              {hasFilters && (
                <span
                  className="ml-0.5 inline-flex items-center justify-center text-[9px] font-bold tabular-nums"
                  style={{
                    minWidth: 14,
                    height: 14,
                    padding: '0 4px',
                    borderRadius: 9999,
                    background: 'rgba(96,165,250,0.35)',
                    color: '#fff',
                  }}
                >
                  {[filters.era, filters.war, filters.battleType, filters.quality].filter(Boolean).length}
                </span>
              )}
            </button>
            {hasFilters && (
              <button
                onClick={() => onFiltersChange({ era: '', war: '', battleType: '', quality: '' })}
                className="h-8 px-3 rounded-full text-[10px] font-semibold tracking-wide text-slate-400 hover:text-rose-200 hover:bg-rose-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filter panel */}
      {!playbackActive && panel === 'filters' && stats && (
        <div className="fixed top-[130px] left-5 z-30 w-64 bg-[#16171f] border border-slate-700/60 rounded-lg shadow-xl p-3 space-y-3">
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
              Reconstructed has phase-by-phase animation. Documented has verified sides and dates. Indexed entries are just a name and coordinates. Open Wikipedia for the story.
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

// ModeTab is one chip inside the top-left mode capsule. Active mode fills
// with a soft accent; inactive modes are slate with a hover lift. Icon
// sits to the left of the label. Used by Explore / Wars / History.
function ModeTab({
  label,
  active,
  onClick,
  icon,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[11px] font-semibold tracking-wide transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
      style={{
        background: active ? 'rgba(96, 165, 250, 0.18)' : 'transparent',
        color: active ? '#fff' : '#94a3b8',
        border: active ? '1px solid rgba(96, 165, 250, 0.45)' : '1px solid transparent',
      }}
    >
      <span style={{ color: active ? '#93c5fd' : '#64748b', display: 'inline-flex' }}>
        {icon}
      </span>
      {label}
    </button>
  );
}
