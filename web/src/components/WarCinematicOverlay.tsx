import { useEffect, useState } from 'react';
import { themeForYear } from '../theme/era';
import { formatYear, formatCasualtyEstimate } from '../lib/format';

interface WarSummaryShape {
  outcome?: string;
  aftermath?: string;
  notable?: string[];
  yearStart: number;
  yearEnd: number;
  battleCount: number;
  totalCasualties: number;
  finalVictor?: string;
}

interface WarCinematicOverlayProps {
  // stage controls what the overlay shows. "overture" is the opening
  // title card before the first battle plays; "aftermath" is the
  // closing card after the last battle finishes; "none" hides the
  // overlay.
  stage: 'none' | 'overture' | 'aftermath';
  // warName is the canonical name of the war the cinematic covers.
  warName: string;
  // summary is the curated war metadata fetched from /api/wars/summary,
  // used to render dates, sides, outcome, and aftermath. May arrive
  // shortly after the overlay mounts; the component handles a null
  // summary by rendering only the war name.
  summary: WarSummaryShape | null;
  // sides are the deduplicated belligerent labels shown on the opening
  // card. Pulled from the war's battles by the parent.
  sides: string[];
  // onDismiss exits the cinematic stage. Bound to Esc, the Continue
  // button on the overture, and the Done button on the aftermath.
  onDismiss: () => void;
  // onBegin advances from the overture to the playing stage. The parent
  // is responsible for actually starting the playback; the overlay just
  // signals user intent.
  onBegin?: () => void;
}

// formatCasualtyLine is the long-form sentence used at the bottom of the
// aftermath card. Wraps the shared estimator with the trailing "across
// the war" clause for context.
function formatCasualtyLine(n: number): string {
  const base = formatCasualtyEstimate(n);
  return base === 'Casualty count not recorded' ? base : `${base} across the war.`;
}

// WarCinematicOverlay is the full-screen title card framing a war
// cinematic. The opening "overture" mounts before the first battle
// plays: war name in the era display face, the date range, the
// belligerent line, and a Begin button. The closing "aftermath" mounts
// after the last battle: victor, outcome line, aftermath prose, the
// notable beats, and a Done button. Same visual vocabulary as the
// battle outro so the user reads the two layers as one continuous
// cinematic surface.
export default function WarCinematicOverlay({
  stage,
  warName,
  summary,
  sides,
  onDismiss,
  onBegin,
}: WarCinematicOverlayProps) {
  const [autoBegun, setAutoBegun] = useState(false);
  const midYear = summary ? (summary.yearStart + summary.yearEnd) / 2 : 1500;
  const theme = themeForYear(midYear);

  // Esc dismisses at any stage. Enter advances the overture; on the
  // aftermath it also dismisses, so the user can chain through with
  // the keyboard.
  useEffect(() => {
    if (stage === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (stage === 'overture' && onBegin) onBegin();
        else if (stage === 'aftermath') onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, onDismiss, onBegin]);

  // Auto-advance the overture after a generous read so a viewer who
  // does not engage the controls still flows into the playback. Set
  // long enough to read the title and the sides but short enough not
  // to feel like the app stalled.
  useEffect(() => {
    if (stage !== 'overture' || !onBegin || autoBegun) return;
    setAutoBegun(true);
    const t = setTimeout(() => onBegin(), 5200);
    return () => clearTimeout(t);
  }, [stage, onBegin, autoBegun]);

  // Reset the auto-begun flag whenever we exit the overture so a
  // re-entry plays the overture again.
  useEffect(() => {
    if (stage !== 'overture') setAutoBegun(false);
  }, [stage]);

  if (stage === 'none') return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'wc-veil-in 700ms ease-out both' }}
    >
      {/* Veil. Drops the underlying globe to a faint silhouette so the
          title owns the frame. Clicking the veil itself dismisses. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close cinematic"
        className="absolute inset-0 w-full h-full cursor-default"
        style={{
          background: 'rgba(4,6,12,0.84)',
          backdropFilter: 'blur(10px)',
        }}
      />

      {/* Soft era-themed bloom. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 55% 45% at 50% 45%, ${theme.accent}26 0%, transparent 60%)`,
          animation: 'wc-bloom 1600ms ease-out both',
        }}
      />

      <div className="relative w-full max-w-[820px] text-center">
        <div
          className="mx-auto mb-7"
          style={{
            width: 100,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
            boxShadow: `0 0 12px ${theme.accent}aa`,
            animation: 'wc-line 800ms 100ms ease-out both',
          }}
        />

        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.5em] mb-5"
          style={{
            color: theme.accent,
            textShadow: '0 2px 12px rgba(0,0,0,0.65)',
            animation: 'wc-rise 750ms 220ms cubic-bezier(.2,.7,.25,1) both',
          }}
        >
          {stage === 'overture' ? 'A war begins' : 'The war ends'}
        </div>

        <h2
          className="leading-[0.98] tracking-tight mx-auto"
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 600,
            fontSize: 'clamp(36px, 5.4vw, 72px)',
            letterSpacing: '-0.015em',
            color: '#ffffff',
            textShadow: '0 8px 36px rgba(0,0,0,0.8)',
            maxWidth: '24ch',
            animation: 'wc-rise 800ms 360ms cubic-bezier(.2,.7,.25,1) both',
          }}
        >
          {warName}
        </h2>

        {summary && (
          <div
            className="mt-4 text-[12px] tracking-[0.32em] uppercase text-slate-300/90"
            style={{ animation: 'wc-rise 800ms 540ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            {formatYear(summary.yearStart)} <span style={{ color: theme.accent }}>·</span> {formatYear(summary.yearEnd)}
            <span className="text-slate-500 ml-3">·</span>
            <span className="ml-3 tabular-nums">{summary.battleCount} battles</span>
          </div>
        )}

        {stage === 'overture' && sides.length > 0 && (
          <div
            className="mt-7 mx-auto max-w-[60ch]"
            style={{ animation: 'wc-rise 850ms 760ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div className="text-[10px] uppercase tracking-[0.36em] text-slate-500 mb-2">
              The belligerents
            </div>
            <p
              className="text-[15px] leading-[1.65] text-slate-100/95"
              style={{ fontFamily: theme.titleFont, fontStyle: 'italic' }}
            >
              {sides.slice(0, 5).join(' · ')}
            </p>
          </div>
        )}

        {stage === 'aftermath' && summary?.outcome && (
          <p
            className="mt-7 mx-auto max-w-[64ch] text-[15.5px] leading-[1.65] text-slate-100/95"
            style={{
              fontFamily: theme.titleFont,
              animation: 'wc-rise 850ms 720ms cubic-bezier(.2,.7,.25,1) both',
            }}
          >
            {summary.outcome}
          </p>
        )}

        {stage === 'aftermath' && summary?.aftermath && (
          <p
            className="mt-4 mx-auto max-w-[64ch] text-[13.5px] leading-[1.7] text-slate-300/85 italic"
            style={{
              fontFamily: theme.titleFont,
              animation: 'wc-rise 900ms 980ms cubic-bezier(.2,.7,.25,1) both',
            }}
          >
            {summary.aftermath}
          </p>
        )}

        {stage === 'aftermath' && summary && summary.totalCasualties > 0 && (
          <p
            className="mt-4 text-[12px] tracking-[0.18em] text-slate-400/90"
            style={{ animation: 'wc-rise 800ms 1180ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            {formatCasualtyLine(summary.totalCasualties)}
          </p>
        )}

        <div
          className="mt-9 flex items-center justify-center gap-3"
          style={{ animation: 'wc-rise 800ms 1320ms cubic-bezier(.2,.7,.25,1) both' }}
        >
          {stage === 'overture' && onBegin && (
            <button
              type="button"
              onClick={onBegin}
              autoFocus
              className="inline-flex items-center gap-2 h-11 px-6 rounded-full text-[13px] font-semibold tracking-wide bg-white text-slate-900 hover:bg-slate-100 transition-all shadow-[0_8px_24px_-8px_rgba(255,255,255,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:scale-[1.02]"
            >
              Begin the campaign
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 1.5 L8.5 6 L4 10.5" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-full text-[13px] font-semibold tracking-wide border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:scale-[1.02]"
            style={{
              color: stage === 'aftermath' ? '#fff' : theme.accent,
              borderColor: `${theme.accent}80`,
              background: stage === 'aftermath' ? `${theme.accent}26` : `${theme.accent}14`,
            }}
          >
            {stage === 'aftermath' ? 'Back to the wars list' : 'Skip'}
          </button>
        </div>

        {summary?.finalVictor && stage === 'aftermath' && (
          <div
            className="mt-7 inline-flex items-center gap-2 px-4 py-1.5 rounded-full"
            style={{
              background: `${theme.accent}1a`,
              border: `1px solid ${theme.accent}66`,
              animation: 'wc-rise 800ms 1480ms cubic-bezier(.2,.7,.25,1) both',
            }}
          >
            <span className="text-[9px] uppercase tracking-[0.32em]" style={{ color: theme.accent }}>
              Final victor
            </span>
            <span className="text-[13px] font-semibold text-white">{summary.finalVictor}</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes wc-veil-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes wc-bloom {
          from { opacity: 0; transform: scale(0.9); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes wc-line {
          from { opacity: 0; transform: scaleX(0); }
          to   { opacity: 1; transform: scaleX(1); }
        }
        @keyframes wc-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
