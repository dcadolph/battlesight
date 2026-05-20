import { useState, useRef, useEffect, useCallback } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';
import { formatYear } from '../lib/format';
import EyeLogo from './EyeLogo';

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
  // BattleSight wordmark. Clears every transient selection so the app
  // returns to the bare landing globe.
  onResetView: () => void;
  // onWarSelect opens the war playback panel preselected on the named
  // war. Used when a search match resolves to a war rather than to a
  // single battle, so the user lands inside the right curated context.
  onWarSelect: (warName: string) => void;
  // onCommanderSelect opens the CommanderPanel for the given name. Used
  // when the user types a person's name in the search bar and accepts the
  // "Battles attributed to X" suggestion that appears above the battle
  // results.
  onCommanderSelect?: (name: string) => void;
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
  onCommanderSelect,
}: CommandBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Battle[]>([]);
  const [warResults, setWarResults] = useState<NameCount[]>([]);
  const [commanderCount, setCommanderCount] = useState<number>(0);
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
      setCommanderCount(0);
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
    // Commander probe. Hits the people endpoint with limit=1 to get a
    // total count without paying for the full result set; the user sees a
    // single "X battles attributed to <q>" row when at least one match
    // exists, and clicking it opens the CommanderPanel.
    if (q.length >= 3 && onCommanderSelect) {
      fetch(`/api/people/battles?name=${encodeURIComponent(q)}&limit=1`)
        .then((r) => r.json())
        .then((d) => setCommanderCount(typeof d?.total === 'number' ? d.total : 0))
        .catch(() => setCommanderCount(0));
    } else {
      setCommanderCount(0);
    }
  }, [stats, onCommanderSelect]);

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
      {/* Top-left chrome stack: wordmark + stat strip + sound, then search,
          then the mode rail. Reads as an editorial masthead rather than a
          dashboard navbar. Tight tracking, hairline dividers, single
          accent. The vertical rhythm is the same 8px grid throughout. */}
      <div className="fixed top-5 left-6 z-40 select-none">
        <div className="flex items-baseline gap-3">
          <button
            type="button"
            onClick={onResetView}
            className="leading-none hover:opacity-95 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 rounded-sm inline-flex items-baseline gap-1.5"
            title="Back to the main globe"
            aria-label="Reset view: back to the main globe"
            style={{
              fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
              fontWeight: 600,
              fontSize: 24,
              letterSpacing: '-0.025em',
              color: '#ffffff',
            }}
          >
            <EyeLogo size={14} color="#60a5fa" />
            <span>Battle<span style={{ color: '#60a5fa' }}>Sight</span></span>
          </button>
        </div>
        <div
          className="mt-1.5 text-[9.5px] tabular-nums leading-none"
          style={{ letterSpacing: '0.32em', textTransform: 'uppercase' }}
        >
          <span className="text-slate-500">{battleCount.toLocaleString()}</span>
          <span className="text-slate-600 ml-1.5">Battles</span>
          {stats && stats.replayCount > 0 && (
            <>
              <span className="text-slate-700 mx-2.5">/</span>
              <span style={{ color: '#60a5fa' }}>{stats.replayCount}</span>
              <span className="text-slate-600 ml-1.5">Replays</span>
            </>
          )}
        </div>
      </div>

      {/* Search. z-[100] so its dropdown floats above the mode rail (z-30). */}
      <div className="fixed top-[78px] left-6 z-[100] w-[268px]">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <circle cx="5.5" cy="5.5" r="3.7" />
            <path d="M8.5 8.5 L11.5 11.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => (results.length > 0 || warResults.length > 0) && setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Search battles, wars, places…"
            className="w-full h-9 pl-9 pr-9 bg-[#0d0f17]/85 backdrop-blur-md border border-slate-700/40 rounded-md text-[12.5px] text-white placeholder-slate-500 focus:outline-none focus:border-amber-300/50 focus:bg-[#11141e]/90 transition-colors"
            style={{ letterSpacing: '0.01em' }}
          />
          {query && (
            <button
              onClick={handleClear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 hover:text-white hover:bg-slate-700/60 transition-colors"
              aria-label="Clear search"
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" />
              </svg>
            </button>
          )}
        </div>

        {/* Search dropdown. Wars surface first (small section) since a
            named war is usually the bigger umbrella the user is hunting
            for; battles follow underneath. Either section is suppressed
            when it has no matches. */}
        {searchOpen && (warResults.length > 0 || results.length > 0 || commanderCount > 0) && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-[#16171f] border border-slate-700/60 rounded-lg overflow-hidden shadow-xl z-[100]">
            {commanderCount > 0 && onCommanderSelect && (
              <button
                onMouseDown={() => {
                  onCommanderSelect(query);
                  setSearchOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-slate-800/60 bg-amber-500/[0.06] border-b border-amber-500/10"
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-amber-300" />
                  <span className="text-amber-200 truncate flex-1">
                    Battles attributed to{' '}
                    <span className="font-semibold">{query}</span>
                  </span>
                  <span className="text-[10px] text-amber-400/80 flex-shrink-0 tabular-nums">
                    {commanderCount} {commanderCount === 1 ? 'battle' : 'battles'}
                  </span>
                </div>
              </button>
            )}
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

        {searchOpen && query.length >= 2 && results.length === 0 && warResults.length === 0 && commanderCount === 0 && (
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
          reads as crafted chrome.
          Vertical position is anchored to top-[126px] so it lands cleanly
          below the search row (search at top-78 + h-9 ends at 114, then
          a 12px gap). Earlier the rail sat at top-88 which collided with
          the new search height and hid the rail entirely. */}
      {/* Mode rail. Editorial chapter labels rather than SaaS-blue pills.
          Each label sits inline with a tracked-caps treatment; the active
          one carries a thin warm-amber underline that reads like a
          newspaper-section accent. No bright fills, no rounded
          baby-button shapes — the chrome is meant to disappear behind the
          globe. */}
      <div className="fixed top-[126px] left-6 z-30">
        <div className="inline-flex items-baseline gap-5">
          <ModeTab
            label="Wars"
            active={playbackActive}
            onClick={onPlaybackOpen}
          />
          <ModeTab
            label="History"
            active={historyActive}
            onClick={onHistoryPlay}
            title="Play 3,500 years of history in 90 seconds"
          />
        </div>

        {!playbackActive && (
          <div className="flex items-baseline gap-4 mt-3">
            <button
              onClick={() => setPanel(panel === 'filters' ? 'none' : 'filters')}
              className="text-[10px] font-semibold uppercase tracking-[0.32em] transition-colors focus:outline-none"
              style={{
                color: panel === 'filters' || hasFilters ? '#fbbf24' : '#94a3b8',
              }}
            >
              Filters
              {hasFilters && (
                <span className="ml-1.5 tabular-nums text-[9px] font-bold" style={{ color: '#fbbf24' }}>
                  · {[filters.era, filters.war, filters.battleType, filters.quality].filter(Boolean).length}
                </span>
              )}
            </button>
            {hasFilters && (
              <button
                onClick={() => onFiltersChange({ era: '', war: '', battleType: '', quality: '' })}
                className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500 hover:text-rose-300 transition-colors focus:outline-none"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filter panel */}
      {!playbackActive && panel === 'filters' && stats && (
        <div className="fixed top-[218px] left-6 z-30 w-64 bg-[#16171f] border border-slate-700/60 rounded-lg shadow-xl p-3 space-y-3">
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
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className="relative inline-flex items-baseline text-[10.5px] font-semibold uppercase tracking-[0.32em] transition-colors focus:outline-none"
      style={{
        color: active ? '#ffffff' : '#94a3b8',
        paddingBottom: 4,
      }}
    >
      {label}
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 bottom-0 h-[1.5px] rounded-full"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, #fbbf24 50%, transparent 100%)',
            boxShadow: '0 0 8px rgba(251,191,36,0.55)',
          }}
        />
      )}
    </button>
  );
}
