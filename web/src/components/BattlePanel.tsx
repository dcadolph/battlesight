import { useEffect, useState } from 'react';
import type { Battle, Reference } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';

interface BattlePanelProps {
  battle: Battle;
  onClose: () => void;
}

const REF_TYPE_LABELS: Record<string, string> = {
  book: 'Books',
  film: 'Films',
  documentary: 'Documentaries',
  article: 'Articles',
};

const REF_TYPE_ORDER = ['book', 'film', 'documentary', 'article'];

function groupRefs(refs: Reference[]): Map<string, Reference[]> {
  const groups = new Map<string, Reference[]>();
  for (const type of REF_TYPE_ORDER) {
    const items = refs.filter((r) => r.type === type);
    if (items.length > 0) groups.set(type, items);
  }
  return groups;
}

export default function BattlePanel({ battle, onClose }: BattlePanelProps) {
  const color = ERA_COLORS[battle.era] || '#ffffff';
  const [detail, setDetail] = useState<Battle>(battle);

  useEffect(() => {
    setDetail(battle);
    fetch(`/api/battles/${battle.id}`)
      .then((res) => res.json())
      .then(setDetail)
      .catch(() => {});
  }, [battle]);

  const refs = detail.references || [];
  const groupedRefs = groupRefs(refs);

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
        <div className="flex items-center gap-3 mb-5">
          <span className="text-slate-500 text-sm">{battle.war}</span>
          <a
            href={`https://earth.google.com/web/@${battle.lat},${battle.lng},0a,30000d,35y,0h,0t,0r`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
          >
            View in Google Earth
          </a>
        </div>

        <div className="mb-5">
          <div className="text-center">
            <span className="inline-block px-3 py-1 rounded-full text-sm bg-slate-800 text-slate-300 capitalize">
              {battle.battleType}
            </span>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          {(detail.sides || []).map((side, i) => {
            const isVictor = side.name === detail.victor;
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

        {detail.summary && (
          <div className="mb-5">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Summary</h3>
            <p className="text-slate-300 text-sm leading-relaxed">{detail.summary}</p>
          </div>
        )}

        {detail.significance && (
          <div className="mb-5">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Significance</h3>
            <p className="text-slate-300 text-sm leading-relaxed">{detail.significance}</p>
          </div>
        )}

        {!detail.summary && !detail.significance && (
          <div className="mb-5 text-center py-4">
            <p className="text-slate-500 text-sm">Detailed information not yet available for this battle.</p>
          </div>
        )}

        {groupedRefs.size > 0 && (
          <div className="border-t border-slate-800 pt-5">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">References</h3>
            {Array.from(groupedRefs.entries()).map(([type, items]) => (
              <div key={type} className="mb-4">
                <h4 className="text-[11px] text-slate-400 font-semibold mb-2">
                  {REF_TYPE_LABELS[type] || type}
                </h4>
                <div className="space-y-2">
                  {items.map((ref, i) => (
                    <div key={i} className="rounded-lg bg-slate-800/40 border border-slate-700/30 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm text-white font-medium leading-tight">
                            {ref.url ? (
                              <a href={ref.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">
                                {ref.title}
                              </a>
                            ) : (
                              ref.title
                            )}
                          </div>
                          {ref.author && (
                            <div className="text-xs text-slate-400 mt-0.5">{ref.author}</div>
                          )}
                        </div>
                        {ref.year !== undefined && ref.year > 0 && (
                          <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">{ref.year}</span>
                        )}
                      </div>
                      {ref.note && (
                        <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">{ref.note}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
