import type { Battle } from '../types/battle';
import { themeForEra } from '../theme/era';

interface BattleTitleCardProps {
  battle: Battle;
}

// formatYearLabel mirrors the same labeling used elsewhere in the app so a
// 490 BC battle reads "490 BC" not "-490".
function formatYearLabel(year: number): string {
  if (year === 0) return '';
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year}`;
}

// BattleTitleCard is a fixed full-bleed overlay that flashes a film-style
// title card whenever a new battle is selected. The parent mounts it with a
// key tied to battle.id so each new selection plays a fresh animation. The
// card holds for about two seconds and then fades. Pointer events stay off
// so the user can keep interacting with the globe or panel underneath.
export default function BattleTitleCard({ battle }: BattleTitleCardProps) {
  const theme = themeForEra(battle.era);
  const year = formatYearLabel(battle.year);
  const sub = [battle.war, year].filter(Boolean).join(' · ');

  return (
    <div
      className="fixed inset-0 z-30 pointer-events-none flex items-start justify-center pt-[18vh]"
      style={{ animation: 'title-card-veil 2800ms ease-out forwards' }}
    >
      <div
        className="text-center px-8 max-w-[90vw]"
        style={{
          opacity: 0,
          animation: 'title-card-block 2800ms cubic-bezier(.2,.65,.3,1) forwards',
          textShadow: '0 4px 24px rgba(0,0,0,0.75), 0 1px 2px rgba(0,0,0,0.6)',
        }}
      >
        {/* Era stamp: small-caps mood word in the era accent. Sets the tone
            before the title lands. */}
        <div
          className="text-[12px] font-semibold uppercase tracking-[0.36em] mb-4"
          style={{ color: theme.accent }}
        >
          {theme.mood}
        </div>

        {/* The battle title is the centerpiece. Era display font, very large.
            On small viewports it scales down via clamp. */}
        <h1
          className="text-white leading-[1.05] tracking-tight"
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 600,
            fontSize: 'clamp(36px, 6.8vw, 84px)',
            letterSpacing: '-0.01em',
          }}
        >
          {battle.name}
        </h1>

        {/* Hairline rule between title and metadata. Mirrors the bars on a
            classical title card. */}
        <div
          className="mx-auto mt-5 mb-4 h-px"
          style={{
            width: 120,
            background: `linear-gradient(90deg, transparent 0%, ${theme.accent} 50%, transparent 100%)`,
            opacity: 0.85,
          }}
        />

        {sub && (
          <div className="text-[12px] uppercase tracking-[0.34em] text-slate-200/85">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
