import { useEffect, useState } from 'react';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';

interface NameCount {
  name: string;
  count: number;
}

interface StatsData {
  totalBattles: number;
  eras: NameCount[];
  wars: NameCount[];
  battleTypes: NameCount[];
}

interface Filters {
  era: string;
  war: string;
  battleType: string;
}

interface FilterBarProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/battles/stats')
      .then((res) => res.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const hasFilters = filters.era || filters.war || filters.battleType;

  const clearAll = () => onChange({ era: '', war: '', battleType: '' });

  if (!stats) return null;

  return (
    <div className="fixed top-16 left-6 z-20">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
          hasFilters
            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
            : 'bg-slate-800/80 text-slate-400 border border-slate-700/50 hover:bg-slate-700/80'
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        Filters
        {hasFilters && (
          <span className="bg-blue-500/30 px-1.5 py-0.5 rounded-full text-[10px]">
            {[filters.era, filters.war, filters.battleType].filter(Boolean).length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 bg-[#1a1b24]/95 backdrop-blur-xl border border-slate-700/50 rounded-xl p-4 w-64 shadow-2xl">
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Era</label>
              <select
                value={filters.era}
                onChange={(e) => onChange({ ...filters, era: e.target.value })}
                className="w-full bg-slate-800/80 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50"
              >
                <option value="">All eras</option>
                {stats.eras.map((e) => (
                  <option key={e.name} value={e.name}>
                    {ERA_LABELS[e.name] || e.name} ({e.count})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">War</label>
              <select
                value={filters.war}
                onChange={(e) => onChange({ ...filters, war: e.target.value })}
                className="w-full bg-slate-800/80 border border-slate-700/50 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50"
              >
                <option value="">All wars</option>
                {stats.wars.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name} ({w.count})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Type</label>
              <div className="flex flex-wrap gap-1.5">
                {stats.battleTypes.map((bt) => (
                  <button
                    key={bt.name}
                    onClick={() =>
                      onChange({
                        ...filters,
                        battleType: filters.battleType === bt.name ? '' : bt.name,
                      })
                    }
                    className={`px-2.5 py-1 rounded-full text-[11px] capitalize transition-all ${
                      filters.battleType === bt.name
                        ? 'bg-blue-500/25 text-blue-400 border border-blue-500/40'
                        : 'bg-slate-800/60 text-slate-400 border border-slate-700/30 hover:bg-slate-700/60'
                    }`}
                  >
                    {bt.name} ({bt.count})
                  </button>
                ))}
              </div>
            </div>
          </div>

          {hasFilters && (
            <div className="mt-3 pt-3 border-t border-slate-700/30">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {filters.era && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{
                      backgroundColor: `${ERA_COLORS[filters.era] || '#666'}20`,
                      color: ERA_COLORS[filters.era] || '#999',
                    }}
                  >
                    {ERA_LABELS[filters.era] || filters.era}
                    <button onClick={() => onChange({ ...filters, era: '' })} className="hover:opacity-70">&times;</button>
                  </span>
                )}
                {filters.war && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700/50 text-slate-300">
                    {filters.war}
                    <button onClick={() => onChange({ ...filters, war: '' })} className="hover:opacity-70">&times;</button>
                  </span>
                )}
                {filters.battleType && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700/50 text-slate-300 capitalize">
                    {filters.battleType}
                    <button onClick={() => onChange({ ...filters, battleType: '' })} className="hover:opacity-70">&times;</button>
                  </span>
                )}
              </div>
              <button
                onClick={clearAll}
                className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
