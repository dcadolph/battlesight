import { useEffect } from 'react';
import type { HistoryBeat } from '../data/history-beats';
import { themeForEra } from '../theme/era';

interface HistoryBeatCardProps {
  beat: HistoryBeat;
  // onContinue resumes the sweep. The card stays on screen until the user
  // chooses to move on (or hits the keyboard shortcut), so they always have
  // time to read the dossier and decide whether to dive in.
  onContinue: () => void;
  // onJump jumps straight to a curated battle (selects + opens replay).
  // Only available when the beat names a battleId.
  onJump?: (battleId: string) => void;
  // onLearnMore opens the battle dossier without auto-playing the replay.
  // Falls back to onJump when the parent doesn't distinguish the two.
  onLearnMore?: (battleId: string) => void;
}

// formatBeatYear renders the canonical year-only display used when no
// finer-grained date string is attached to the beat.
function formatBeatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year}`;
}

// HistoryBeatCard is the chapter-break overlay that mounts when the history
// playhead crosses a curated beat. The sweep is paused while the card is on
// screen and only resumes when the user clicks Continue or hits Enter/Space.
// The card surfaces three things at a glance: when, where, what. The region
// chip and the precise date (where known) anchor each beat in space and time
// so a 2,500-year sweep does not collapse into a year ticker.
export default function HistoryBeatCard({ beat, onContinue, onJump, onLearnMore }: HistoryBeatCardProps) {
  const theme = themeForEra(beat.era);

  // Keyboard shortcuts: Enter / Space / right-arrow continue, Esc continues.
  // Escape always means "get me out of this card."
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Escape') {
        e.preventDefault();
        onContinue();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onContinue]);

  const hasBattle = !!beat.battleId;
  const dateLine = beat.date ?? formatBeatYear(beat.year);

  return (
    <div className="fixed inset-0 z-30 pointer-events-auto flex items-center justify-center px-6">
      {/* Veil: full-bleed dimmed backdrop with backdrop-blur. Reads as a
          chapter-break pause rather than a flashing overlay. Clicking the
          veil itself continues the sweep, mirroring the conventional
          dismiss-on-backdrop pattern. */}
      <button
        type="button"
        onClick={onContinue}
        aria-label="Continue history sweep"
        className="absolute inset-0 w-full h-full cursor-default bg-black/55 backdrop-blur-md"
        style={{ animation: 'beat-veil-in 600ms ease-out both' }}
      />

      <div
        className="relative max-w-[68ch] text-center px-2"
        style={{
          animation: 'beat-block-in 700ms cubic-bezier(.2,.65,.25,1) both',
        }}
      >
        {/* Era stamp: small caps in the era accent, with a region chip on the
            right so the eye reads When + Where in one beat. The chip uses a
            faint border in the accent color so it stays in the family without
            shouting. */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <span
            className="text-[12px] font-semibold uppercase tracking-[0.42em]"
            style={{ color: theme.accent, textShadow: '0 2px 12px rgba(0,0,0,0.7)' }}
          >
            {dateLine} · {theme.mood}
          </span>
          <span
            className="inline-flex items-center h-6 px-2.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{
              color: theme.accent,
              background: `${theme.accent}1f`,
              border: `1px solid ${theme.accent}55`,
              textShadow: '0 1px 4px rgba(0,0,0,0.6)',
            }}
          >
            {beat.region}
          </span>
        </div>

        {/* Headline in the era display font. Large, with a faint shadow so
            it reads cleanly against the dimmed globe. */}
        <h1
          className="text-white leading-[1.04] tracking-tight"
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 600,
            fontSize: 'clamp(38px, 6.8vw, 84px)',
            letterSpacing: '-0.01em',
            textShadow: '0 6px 32px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.7)',
          }}
        >
          {beat.headline}
        </h1>

        {/* Hairline rule. The gradient suggests "page break" without being
            literal about it. */}
        <div
          className="mx-auto mt-6 mb-5 h-px"
          style={{
            width: 140,
            background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
            opacity: 0.9,
          }}
        />

        <p
          className="text-[16px] md:text-[17px] leading-[1.55] text-slate-100/95 mx-auto"
          style={{
            fontFamily: theme.titleFont,
            fontStyle: 'italic',
            textShadow: '0 2px 12px rgba(0,0,0,0.75)',
          }}
        >
          {beat.sub}
        </p>

        {/* Action row. Continue is always present, sized as the primary CTA
            so even users who never read the buttons can find it. The two
            optional actions only render when the beat references a battle. */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full text-[13px] font-semibold tracking-wide bg-white text-slate-900 hover:bg-slate-100 transition-colors shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
            autoFocus
          >
            Continue
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Enter</span>
          </button>
          {hasBattle && onLearnMore && (
            <button
              type="button"
              onClick={() => onLearnMore(beat.battleId!)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-[12px] font-semibold tracking-wide border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
              style={{
                color: theme.accent,
                borderColor: `${theme.accent}66`,
                background: `${theme.accent}10`,
              }}
            >
              Read more
            </button>
          )}
          {hasBattle && onJump && (
            <button
              type="button"
              onClick={() => onJump(beat.battleId!)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-[12px] font-semibold tracking-wide border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
              style={{
                color: theme.accent,
                borderColor: `${theme.accent}88`,
                background: `${theme.accent}25`,
              }}
            >
              ▶ Watch the battle
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes beat-veil-in {
          from { opacity: 0; backdrop-filter: blur(0px); }
          to   { opacity: 1; backdrop-filter: blur(8px); }
        }
        @keyframes beat-block-in {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
