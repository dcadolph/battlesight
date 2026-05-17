import type { Battle } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';
import { themeForEra } from '../theme/era';
import { formatYear } from '../lib/format';
import CloseButton from './CloseButton';

interface IntroOverlayProps {
  featured: Battle;
  onDismiss: () => void;
  onStart: () => void;
}

// IntroOverlay is the cinematic gateway the user lands on the first time
// they open the app (and again on a reset). The previous version was a
// stock modal with rounded corners and a blue CTA; this one carries the
// same editorial typography as the splash and the battle dossier so the
// product reads consistent across surfaces. The featured battle gets a
// real spread of its own rather than a thumb-sized card.
export default function IntroOverlay({ featured, onDismiss, onStart }: IntroOverlayProps) {
  const color = ERA_COLORS[featured.era] || '#3b82f6';
  const theme = themeForEra(featured.era);
  const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'intro-veil-in 800ms ease-out both' }}
    >
      {/* Veil. Click-to-dismiss like every other overlay, and a faint
          era-themed bloom centered behind the card so the page feels
          alive rather than greyed-out. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close intro and explore"
        className="absolute inset-0 w-full h-full cursor-default"
        style={{
          background: 'rgba(4,6,12,0.86)',
          backdropFilter: 'blur(12px)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 45%, ${color}22 0%, transparent 65%)`,
          animation: 'intro-bloom 1600ms ease-out both',
        }}
      />

      {/* Top-right exit. Same gesture as the rest of the app. */}
      <div className="absolute top-5 right-5 z-10">
        <CloseButton onClick={onDismiss} label="Close intro (Esc)" tone="elevated" />
      </div>

      {/* Card. No hard rounded-card shell; instead a wide editorial
          spread with a hairline rule and accent type, so the product
          opens with the encyclopedia voice rather than a SaaS modal. */}
      <div
        className="relative max-w-[640px] w-full text-center px-2"
        style={{ animation: 'intro-block-in 900ms cubic-bezier(.2,.65,.25,1) both' }}
      >
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.42em] mb-5"
          style={{ color, textShadow: '0 2px 14px rgba(0,0,0,0.7)' }}
        >
          A world atlas of battles
        </div>

        <h1
          className="text-white leading-[1.02] tracking-tight mb-5"
          style={{
            fontFamily: SERIF,
            fontWeight: 600,
            fontSize: 'clamp(48px, 7.2vw, 86px)',
            letterSpacing: '-0.018em',
            textShadow: '0 10px 40px rgba(0,0,0,0.85), 0 0 28px rgba(255,255,255,0.08)',
          }}
        >
          Battle<span style={{ color }}>Trace</span>
        </h1>

        {/* Hairline rule under the title, era-accent gradient. */}
        <div
          className="mx-auto mt-4 mb-6 h-px"
          style={{
            width: 160,
            background: `linear-gradient(90deg, transparent 0%, ${color} 50%, transparent 100%)`,
            boxShadow: `0 0 10px ${color}88`,
          }}
        />

        <p
          className="italic text-slate-200 mx-auto mb-8"
          style={{
            fontFamily: SERIF,
            fontSize: 17,
            lineHeight: 1.55,
            maxWidth: '54ch',
            textShadow: '0 2px 14px rgba(0,0,0,0.7)',
          }}
        >
          Three and a half thousand years of organized violence, from the Battle of Megiddo in 1457 BC to the
          front lines of the present day. Mapped, dated, named, and replayed phase by phase where the
          record allows.
        </p>

        {/* Featured battle card. Themed by era. The serif body keeps the
            editorial voice; the era stamp at top reads as a chapter mark
            so the card feels like a page from the atlas itself. */}
        <div
          className="rounded-2xl px-6 py-5 mb-6 mx-auto text-left"
          style={{
            background: 'rgba(8,10,18,0.78)',
            border: `1px solid ${color}40`,
            boxShadow: `0 24px 56px -16px rgba(0,0,0,0.6), inset 0 1px 0 ${color}22`,
            maxWidth: 520,
          }}
        >
          <div className="flex items-center gap-2.5 mb-3 flex-wrap">
            <span
              className="inline-block px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-[0.2em] font-semibold"
              style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
            >
              {ERA_LABELS[featured.era] || featured.era}
            </span>
            <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
              Today's featured battle
            </span>
            {featured.hasReplay && (
              <span
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(59,130,246,0.18)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.35)' }}
              >
                ▶ Replay
              </span>
            )}
          </div>
          <div
            className="text-white text-[22px] font-semibold mb-1 tracking-tight"
            style={{ fontFamily: theme.titleFont }}
          >
            {featured.name}
          </div>
          <div className="text-[12px] uppercase tracking-[0.18em] text-slate-500 mb-3 tabular-nums">
            {featured.date || formatYear(featured.year)}
            {featured.war ? ` · ${featured.war}` : ''}
          </div>
          <p
            className="text-slate-300 leading-relaxed"
            style={{ fontFamily: SERIF, fontSize: 14 }}
          >
            {featured.summary || featured.significance}
          </p>
        </div>

        {/* Action row. The primary action carries the era accent; the
            secondary stays a quiet outline so the eye knows which is the
            invitation. */}
        <div className="flex flex-wrap gap-3 justify-center mb-5">
          <button
            onClick={onStart}
            className="inline-flex items-center justify-center h-11 px-6 rounded-full text-[13px] font-semibold tracking-wide text-white shadow-lg transition-all hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
            style={{
              background: `linear-gradient(180deg, ${color} 0%, ${color}cc 100%)`,
              boxShadow: `0 8px 24px ${color}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
            }}
          >
            {featured.hasReplay ? 'Watch the replay' : 'Open this battle'}
          </button>
          <button
            onClick={onDismiss}
            className="inline-flex items-center justify-center h-11 px-6 rounded-full text-[13px] font-semibold tracking-wide text-slate-200 bg-transparent border border-slate-600/60 hover:bg-slate-800/50 hover:border-slate-400 transition-colors"
          >
            Explore the globe
          </button>
        </div>

        {/* Keyboard hint. Tracked small caps, neutral. */}
        <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
          Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-300 not-italic mx-0.5">/</kbd> to search · <kbd className="px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-300 not-italic mx-0.5">Esc</kbd> to close
        </div>
      </div>

      <style>{`
        @keyframes intro-veil-in {
          from { opacity: 0; backdrop-filter: blur(0px); }
          to   { opacity: 1; backdrop-filter: blur(12px); }
        }
        @keyframes intro-bloom {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes intro-block-in {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
