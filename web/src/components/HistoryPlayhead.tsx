import type { EraTheme } from '../theme/era';

interface HistoryPlayheadProps {
  // year currently being highlighted on the timeline.
  year: number;
  // theme drives mood text and accent color so the overlay coheres with the
  // globe's atmosphere shift.
  theme: EraTheme;
  // playing toggles the play/pause glyph.
  playing: boolean;
  onToggle: () => void;
  onClose: () => void;
}

// formatYear matches the convention used elsewhere: negative years are
// rendered as "N BC". Avoids drift from a separate formatter.
function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year}`;
}

// HistoryPlayhead is the floating year ticker shown while play-history mode is
// active. Centered near the top of the screen so the eye can read it without
// leaving the globe, with light controls below for pause and stop.
export default function HistoryPlayhead({ year, theme, playing, onToggle, onClose }: HistoryPlayheadProps) {
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div
        className="px-6 py-4 rounded-2xl bg-black/55 backdrop-blur-md border shadow-2xl text-center pointer-events-auto"
        style={{ borderColor: `${theme.accent}55` }}
      >
        <div
          className="text-[10px] uppercase tracking-[0.32em] mb-1.5"
          style={{ color: theme.accent }}
        >
          {theme.mood}
        </div>
        <div
          className="text-5xl tabular-nums tracking-tight text-white leading-none"
          style={{ fontFamily: theme.titleFont, fontWeight: 500 }}
        >
          {formatYear(year)}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            onClick={onToggle}
            className="h-7 px-3 rounded-full text-[11px] font-semibold text-white/90 hover:text-white transition-colors"
            style={{
              backgroundColor: `${theme.accent}25`,
              border: `1px solid ${theme.accent}55`,
            }}
          >
            {playing ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={onClose}
            className="h-7 px-3 rounded-full text-[11px] font-medium text-slate-300 hover:text-white bg-slate-800/70 border border-slate-700/60 transition-colors"
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
