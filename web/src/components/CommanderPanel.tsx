import { useEffect, useState } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS } from '../types/battle';
import { themeForEra } from '../theme/era';
import { formatYear } from '../lib/format';
import CloseButton from './CloseButton';

interface CommanderBattle {
  battle: Battle;
  role: 'led' | 'participated';
}

interface CommanderResponse {
  name: string;
  battles: CommanderBattle[];
  total: number;
}

interface CommanderPanelProps {
  name: string;
  onClose: () => void;
  onBattleClick: (battle: Battle) => void;
}

// CommanderPanel surfaces every battle attributed to a single general or
// leader, separated by whether they were the top-billed commander on a side
// (led) or merely listed (participated). Opened from the BattlePanel by
// clicking a commander chip. Reuses the right-side overlay shell shared by
// the other detail surfaces so the user lands in a familiar layout.
export default function CommanderPanel({ name, onClose, onBattleClick }: CommanderPanelProps) {
  const [data, setData] = useState<CommanderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/people/battles?name=${encodeURIComponent(name)}&limit=200`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: CommanderResponse) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load battles for this commander.');
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const led = data?.battles.filter((b) => b.role === 'led') ?? [];
  const participated = data?.battles.filter((b) => b.role === 'participated') ?? [];

  return (
    <div className="fixed top-0 right-0 h-full w-[460px] max-w-[92vw] z-30 bg-[#0f1019]/95 backdrop-blur-xl border-l border-slate-800 flex flex-col">
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800/60 flex-shrink-0 gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.32em] text-slate-500">
            Battles attributed to
          </div>
          <h3 className="text-[15px] font-semibold text-white truncate">{name}</h3>
        </div>
        <CloseButton onClick={onClose} label="Close (Esc)" />
      </div>

      <div className="p-4 overflow-y-auto flex-1">
        {error && (
          <p className="text-[12px] text-amber-300/90 italic mb-3">{error}</p>
        )}
        {!data && !error && (
          <p className="text-[12px] text-slate-500 italic">Looking up battles…</p>
        )}
        {data && data.battles.length === 0 && (
          <p className="text-[12px] text-slate-500 italic">
            No battles match. Try a shorter form of the name (e.g. "Napoleon" not
            "Napoleon Bonaparte").
          </p>
        )}

        {led.length > 0 && (
          <Section title="Led a side" theme="led" battles={led} onBattleClick={onBattleClick} />
        )}
        {participated.length > 0 && (
          <Section
            title="Listed as a commander"
            theme="participated"
            battles={participated}
            onBattleClick={onBattleClick}
          />
        )}
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  theme: 'led' | 'participated';
  battles: CommanderBattle[];
  onBattleClick: (battle: Battle) => void;
}

function Section({ title, theme, battles, onBattleClick }: SectionProps) {
  const accent = theme === 'led' ? '#fbbf24' : '#94a3b8';
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <div
          className="text-[10px] uppercase tracking-[0.32em] font-semibold"
          style={{ color: accent }}
        >
          {title}
        </div>
        <span className="text-[10px] text-slate-600 tabular-nums">{battles.length}</span>
      </div>
      <div className="space-y-1">
        {battles.map(({ battle: b }) => {
          const eraColor = ERA_COLORS[b.era] || '#fff';
          const eraTheme = themeForEra(b.era);
          return (
            <button
              key={b.id}
              onClick={() => onBattleClick(b)}
              className="relative w-full text-left rounded-lg px-3 py-2 hover:bg-slate-800/50 transition-colors overflow-hidden"
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
                style={{
                  background: `linear-gradient(180deg, ${eraTheme.accent}cc 0%, ${eraTheme.accent}55 100%)`,
                }}
              />
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className="text-[13px] font-semibold text-white truncate"
                  title={b.name}
                >
                  {b.name}
                </span>
                <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0">
                  {formatYear(b.year)}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                <span style={{ color: eraColor }}>{b.war || '—'}</span>
                {b.victor && (
                  <>
                    <span className="text-slate-600 mx-1">·</span>
                    Victor <span className="text-slate-300">{b.victor}</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
