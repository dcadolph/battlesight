import { ERA_COLORS, ERA_LABELS } from '../types/battle';

interface EraLegendProps {
  // selectedEra is the currently active era filter, "" when none.
  selectedEra: string;
  // onSelect toggles the filter to this era, or clears it if already
  // selected. Clearing returns the globe to "every battle".
  onSelect: (era: string) => void;
}

// Era display order matches the timeline chronology. Keeps the legend
// readable as a top-to-bottom sweep through history rather than the
// alphabetical jumble the ERA_COLORS object key order would give.
const ERA_ORDER = [
  'ancient',
  'medieval',
  'early-modern',
  'napoleonic',
  'industrial',
  'world-war-1',
  'world-war-2',
  'modern',
];

// EraLegend is the globe's chromatic key. Eight era chips stacked at the
// top right of the viewport, each showing its color, label, and acting as
// a one-click filter. Clicking the active era clears the filter. Hidden
// behind any open right-side panel so it never competes with the dossier
// or war card; visible whenever the user is browsing the bare globe.
export default function EraLegend({ selectedEra, onSelect }: EraLegendProps) {
  return (
    <div
      className="fixed top-4 right-5 z-20 select-none"
      role="group"
      aria-label="Era legend; click to filter the globe by era"
    >
      <div
        className="rounded-2xl backdrop-blur-md p-1.5"
        style={{
          background: 'rgba(8, 10, 18, 0.55)',
          border: '1px solid rgba(148, 163, 184, 0.12)',
          boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div
          className="text-[9px] font-semibold uppercase tracking-[0.3em] text-slate-400 px-2.5 pt-1 pb-1.5"
        >
          Eras
        </div>
        <ul className="space-y-0.5">
          {ERA_ORDER.map((era) => {
            const isActive = selectedEra === era;
            const isDimmed = selectedEra !== '' && !isActive;
            const color = ERA_COLORS[era] ?? '#94a3b8';
            return (
              <li key={era}>
                <button
                  type="button"
                  onClick={() => onSelect(isActive ? '' : era)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                  style={{
                    background: isActive ? `${color}26` : 'transparent',
                    border: isActive ? `1px solid ${color}55` : '1px solid transparent',
                  }}
                  aria-pressed={isActive}
                  title={isActive ? 'Clear era filter' : `Show only ${ERA_LABELS[era] ?? era} battles`}
                >
                  <span
                    className="flex-shrink-0 rounded-full transition-all"
                    style={{
                      width: 8,
                      height: 8,
                      background: color,
                      boxShadow: isActive ? `0 0 8px ${color}` : `0 0 4px ${color}88`,
                      opacity: isDimmed ? 0.35 : 1,
                    }}
                  />
                  <span
                    className="text-[11px] tracking-wide leading-none whitespace-nowrap"
                    style={{
                      color: isActive ? '#fff' : isDimmed ? '#64748b' : '#cbd5e1',
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    {ERA_LABELS[era] ?? era}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
