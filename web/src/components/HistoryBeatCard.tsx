import type { HistoryBeat } from '../data/history-beats';
import { themeForEra } from '../theme/era';

interface HistoryBeatCardProps {
  beat: HistoryBeat;
  // onJump is fired when the user clicks the optional "Watch the battle"
  // affordance attached to beats that point at a curated replay.
  onJump?: (battleId: string) => void;
}

function formatBeatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year}`;
}

// HistoryBeatCard is the title-card overlay that flashes when the year
// playhead crosses a historical beat. Stays on screen for the parent's
// configured duration. Pointer-events stay enabled on the inner block so the
// optional "Watch the battle" link is clickable. The outer wrapper is
// passive so the rest of the UI keeps working.
export default function HistoryBeatCard({ beat, onJump }: HistoryBeatCardProps) {
  const theme = themeForEra(beat.era);

  return (
    <div
      className="fixed inset-0 z-30 pointer-events-none flex items-start justify-center pt-[22vh]"
      style={{ animation: 'title-card-veil 3200ms ease-out forwards' }}
    >
      <div
        className="text-center px-8 max-w-[88vw]"
        style={{
          opacity: 0,
          animation: 'title-card-block 3200ms cubic-bezier(.2,.65,.3,1) forwards',
          textShadow: '0 4px 24px rgba(0,0,0,0.75), 0 1px 2px rgba(0,0,0,0.6)',
        }}
      >
        {/* The year is the chapter marker. Era accent, tracked small caps. */}
        <div
          className="text-[12px] font-semibold uppercase tracking-[0.4em] mb-3"
          style={{ color: theme.accent }}
        >
          {formatBeatYear(beat.year)} · {theme.mood}
        </div>

        {/* Headline in the era display font. Large so the beat feels like a
            chapter heading. */}
        <h1
          className="text-white leading-[1.04] tracking-tight"
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 600,
            fontSize: 'clamp(34px, 6.4vw, 78px)',
            letterSpacing: '-0.01em',
          }}
        >
          {beat.headline}
        </h1>

        {/* Hairline rule. */}
        <div
          className="mx-auto mt-5 mb-4 h-px"
          style={{
            width: 120,
            background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
            opacity: 0.85,
          }}
        />

        {/* Dossier line: one sentence framing why the beat matters. */}
        <p
          className="text-[15px] md:text-[16px] leading-[1.55] text-slate-100/90 max-w-[64ch] mx-auto"
          style={{ fontFamily: theme.titleFont, fontStyle: 'italic' }}
        >
          {beat.sub}
        </p>

        {/* Optional jump link to the curated replay, when the beat has one. */}
        {beat.battleId && onJump && (
          <button
            type="button"
            onClick={() => onJump(beat.battleId!)}
            className="pointer-events-auto mt-5 inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] uppercase tracking-[0.18em] font-semibold border transition-colors"
            style={{
              color: theme.accent,
              borderColor: `${theme.accent}66`,
              background: `${theme.accent}10`,
            }}
          >
            Watch the battle
          </button>
        )}
      </div>
    </div>
  );
}
