import type { Battle } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';
import { formatYear } from '../lib/format';

interface IntroOverlayProps {
  featured: Battle;
  onDismiss: () => void;
  onStart: () => void;
}

export default function IntroOverlay({ featured, onDismiss, onStart }: IntroOverlayProps) {
  const color = ERA_COLORS[featured.era] || '#3b82f6';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#070912]/85 backdrop-blur-md p-6">
      <div className="max-w-2xl w-full bg-[#0d1322]/95 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-8 pt-8 pb-6">
          <div className="text-[11px] uppercase tracking-[0.22em] text-blue-400/80 mb-2">A world atlas of battles</div>
          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
            Battle<span className="text-blue-400">Trace</span>
          </h1>
          <p className="text-slate-300 text-[15px] leading-relaxed mb-6">
            Explore 2,500 years of organized violence on an interactive globe. Search by name, filter by era, replay
            iconic battles phase by phase to see exactly how they unfolded.
          </p>

          <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-5 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ backgroundColor: `${color}25`, color }}
              >
                {ERA_LABELS[featured.era] || featured.era}
              </span>
              {featured.hasReplay && (
                <span className="inline-flex items-center gap-1 text-[10px] text-blue-300/90 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30">
                  ▶ Phase-by-phase replay
                </span>
              )}
            </div>
            <div className="text-lg font-semibold text-white mb-1">
              Today: {featured.name}
            </div>
            <div className="text-xs text-slate-500 mb-3">
              {featured.date || formatYear(featured.year)}
              {featured.war ? ` · ${featured.war}` : ''}
            </div>
            <p className="text-[13px] text-slate-300 leading-relaxed">
              {featured.summary || featured.significance}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onStart}
              className="px-5 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold transition-colors"
            >
              {featured.hasReplay ? 'Watch the replay' : 'Open this battle'}
            </button>
            <button
              onClick={onDismiss}
              className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm transition-colors"
            >
              Explore the globe
            </button>
          </div>
        </div>
        <div className="px-8 py-3 bg-slate-900/70 border-t border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <div className="text-[11px] text-slate-500">
            Press <kbd className="px-1 rounded bg-slate-800 text-slate-300">/</kbd> to search ·
            <kbd className="px-1 rounded bg-slate-800 text-slate-300 ml-1">Esc</kbd> to close panels
          </div>
          <button
            onClick={onDismiss}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Skip ›
          </button>
        </div>
      </div>
    </div>
  );
}
