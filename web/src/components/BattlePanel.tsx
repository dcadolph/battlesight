import type { Battle } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';

interface BattlePanelProps {
  battle: Battle;
  onClose: () => void;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year}`;
}

export default function BattlePanel({ battle, onClose }: BattlePanelProps) {
  const color = ERA_COLORS[battle.era] || '#ffffff';

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] max-w-[90vw] z-30 bg-[#0f1019]/95 backdrop-blur-xl border-l border-slate-800 overflow-y-auto">
      <div className="p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
        >
          &times;
        </button>

        <div
          className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-3"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {ERA_LABELS[battle.era] || battle.era}
        </div>

        <h2 className="text-2xl font-bold text-white mb-1">{battle.name}</h2>
        <p className="text-slate-400 text-sm mb-1">{battle.date}</p>
        <p className="text-slate-500 text-sm mb-5">{battle.war}</p>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="text-center text-xs text-slate-500 uppercase tracking-wider col-span-2 mb-1">
            Type
          </div>
          <div className="col-span-2 text-center">
            <span className="inline-block px-3 py-1 rounded-full text-sm bg-slate-800 text-slate-300 capitalize">
              {battle.battleType}
            </span>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          {battle.sides.map((side, i) => {
            const isVictor = side.name === battle.victor;
            return (
              <div
                key={i}
                className="rounded-lg p-4"
                style={{
                  backgroundColor: isVictor ? `${color}10` : 'rgba(30,32,44,0.8)',
                  border: isVictor ? `1px solid ${color}30` : '1px solid rgba(51,55,76,0.5)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-white text-sm">{side.name}</span>
                  {isVictor && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${color}25`, color }}>
                      Victor
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500 mb-0.5">Commander</div>
                    <div className="text-slate-300">{side.commander}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-0.5">Strength</div>
                    <div className="text-slate-300">{side.strength}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-0.5">Casualties</div>
                    <div className="text-slate-300">{side.casualties}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mb-5">
          <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Summary</h3>
          <p className="text-slate-300 text-sm leading-relaxed">{battle.summary}</p>
        </div>

        <div>
          <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Significance</h3>
          <p className="text-slate-300 text-sm leading-relaxed">{battle.significance}</p>
        </div>
      </div>
    </div>
  );
}
