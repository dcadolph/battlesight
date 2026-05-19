import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { themeForYear } from '../theme/era';
import { ERA_LABELS } from '../types/battle';
import { formatYear, formatCasualtyEstimate, formatCountCompact, cleanProseText } from '../lib/format';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import CloseButton from './CloseButton';

interface WarSummaryShape {
  outcome?: string;
  aftermath?: string;
  notable?: string[];
  yearStart: number;
  yearEnd: number;
  battleCount: number;
  totalCasualties: number;
  // humanDeaths is the curated total (civilians + famine + genocide).
  // Preferred for the stat strip and aftermath card when present.
  humanDeaths?: number;
  // curatedStartYear / curatedEndYear override the catalog years so the
  // overture and stat strip read from the curator's calendar.
  curatedStartYear?: number;
  curatedEndYear?: number;
  finalVictor?: string;
}

// StatCell renders one figure inside the cinematic's stat strip. Tight
// monospace number, era-accent eyebrow, and a thin baseline rule so the
// row reads as an editorial fact strip rather than a dashboard. Reveal
// timing is driven by the parent via animationDelay.
function StatCell({
  value,
  label,
  accent,
  delayMs,
  reducedMotion,
}: {
  value: React.ReactNode;
  label: string;
  accent: string;
  delayMs: number;
  reducedMotion: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 min-w-[88px]"
      style={{
        animation: reducedMotion
          ? 'none'
          : `wc-rise 700ms ${delayMs}ms cubic-bezier(.2,.7,.25,1) both`,
      }}
    >
      <div
        className="text-[9.5px] font-semibold uppercase tracking-[0.32em]"
        style={{ color: accent }}
      >
        {label}
      </div>
      <div
        className="text-[22px] font-semibold tabular-nums text-white leading-none"
        style={{ textShadow: '0 2px 12px rgba(0,0,0,0.65)' }}
      >
        {value}
      </div>
    </div>
  );
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
  // sidesTotal is the actual count of distinct belligerents across every
  // battle in the war (before the top-5 chip-strip cap). Drives the
  // Belligerents stat cell so a 40-nation coalition war doesn't read as
  // "5" just because the chip strip is capped.
  sidesTotal?: number;
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
  sidesTotal,
  onDismiss,
  onBegin,
}: WarCinematicOverlayProps) {
  const [autoBegun, setAutoBegun] = useState(false);
  // Prefer the curated years and curated death toll for display so World
  // War II renders 1931-1945 / ~75M instead of the catalog's narrower
  // 1939-1945 / battle-sum number.
  const displayStart = summary?.curatedStartYear || summary?.yearStart || 0;
  const displayEnd = summary?.curatedEndYear || summary?.yearEnd || 0;
  const displayCasualties = (summary?.humanDeaths && summary.humanDeaths > 0) ? summary.humanDeaths : (summary?.totalCasualties ?? 0);
  const midYear = summary ? (displayStart + displayEnd) / 2 : 1500;
  const theme = themeForYear(midYear);
  const reducedMotion = usePrefersReducedMotion();

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

  // The overture used to auto-advance after ~5 seconds. That felt rushed:
  // a viewer reading the title and the belligerents would be ambushed by
  // the playback starting before they were ready. The card now waits on
  // the explicit Begin click (or Enter/Space) so the user owns the start.
  void autoBegun;
  void setAutoBegun;

  if (stage === 'none') return null;

  // Mount via portal to document.body so the overlay always covers the full
  // viewport. Without the portal it sits inside WarPlayback, whose pane has
  // a `backdrop-blur` filter that creates a containing block for fixed-
  // positioned descendants. The result was the cinematic card and its veil
  // getting clipped to the 420px right pane width, leaving the globe
  // visibly cut off on the left edge of the overlay.
  const node = (
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

      {/* Top-right close mark. Matches the global exit affordance used by
          BattlePanel and WarPlayback so the user has the same out from
          every modal mode, not a different gesture per surface. */}
      <div className="absolute top-4 right-4 z-10">
        <CloseButton onClick={onDismiss} label="Close cinematic (Esc)" tone="elevated" />
      </div>

      {/* Soft era-themed bloom. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 55% 45% at 50% 45%, ${theme.accent}26 0%, transparent 60%)`,
          animation: 'wc-bloom 1600ms ease-out both',
        }}
      />

      <div className="relative w-full max-w-[860px] max-h-[92vh] overflow-y-auto text-center px-1 py-4">
        {/* Top hairline. Era accent gradient with a soft glow; reads as the
            opening of a film frame. */}
        <div
          className="mx-auto mb-7"
          style={{
            width: 100,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)`,
            boxShadow: `0 0 12px ${theme.accent}aa`,
            animation: reducedMotion ? 'none' : 'wc-line 800ms 100ms ease-out both',
          }}
        />

        {/* Single eyebrow line. Just the era stamp — the war name and the
            stat strip together tell the reader this is the opening of the
            war; an extra "A war begins" string was redundant with the
            title and crowded the layout. */}
        <div
          className="flex items-center justify-center mb-4"
          style={{ animation: reducedMotion ? 'none' : 'wc-rise 750ms 200ms cubic-bezier(.2,.7,.25,1) both' }}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.42em] px-3 py-1 rounded-full"
            style={{
              color: theme.accent,
              background: `${theme.accent}1f`,
              border: `1px solid ${theme.accent}44`,
              textShadow: '0 2px 12px rgba(0,0,0,0.6)',
            }}
          >
            {ERA_LABELS[theme.era] || theme.mood}
          </span>
        </div>

        <h2
          className="leading-[0.98] tracking-tight mx-auto"
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 600,
            fontSize: 'clamp(34px, 4.8vw, 64px)',
            letterSpacing: '-0.015em',
            color: '#ffffff',
            textShadow: '0 8px 36px rgba(0,0,0,0.8)',
            maxWidth: '24ch',
            animation: reducedMotion ? 'none' : 'wc-rise 800ms 360ms cubic-bezier(.2,.7,.25,1) both',
          }}
        >
          {warName}
        </h2>

        {/* Hero stat strip. Three (overture) or four (aftermath) editorial
            cells: span / battles / belligerents on opening; years / battles
            / lives / victor on closing. The cells reveal as a wave, each
            one ~80ms after the previous, so the eye reads them as a single
            rhythmic beat. */}
        {summary && stage === 'overture' && (
          <div className="mt-5 flex items-center justify-center gap-7 flex-wrap">
            <StatCell
              accent={theme.accent}
              reducedMotion={reducedMotion}
              delayMs={540}
              label="Span"
              value={`${formatYear(displayStart)}–${formatYear(displayEnd)}`}
            />
            <span className="w-px h-7 bg-slate-700/60" />
            <StatCell
              accent={theme.accent}
              reducedMotion={reducedMotion}
              delayMs={620}
              label="Battles"
              value={summary.battleCount.toLocaleString('en-US')}
            />
            {(sidesTotal ?? sides.length) > 0 && (
              <>
                <span className="w-px h-7 bg-slate-700/60" />
                <StatCell
                  accent={theme.accent}
                  reducedMotion={reducedMotion}
                  delayMs={700}
                  label="Belligerents"
                  value={(sidesTotal ?? sides.length).toLocaleString('en-US')}
                />
              </>
            )}
          </div>
        )}

        {summary && stage === 'aftermath' && (
          <div className="mt-5 flex items-center justify-center gap-7 flex-wrap">
            <StatCell
              accent={theme.accent}
              reducedMotion={reducedMotion}
              delayMs={540}
              label="Years"
              value={Math.max(1, displayEnd - displayStart + 1)}
            />
            <span className="w-px h-7 bg-slate-700/60" />
            <StatCell
              accent={theme.accent}
              reducedMotion={reducedMotion}
              delayMs={620}
              label="Battles"
              value={summary.battleCount.toLocaleString('en-US')}
            />
            {displayCasualties > 0 && (
              <>
                <span className="w-px h-7 bg-slate-700/60" />
                <StatCell
                  accent={theme.accent}
                  reducedMotion={reducedMotion}
                  delayMs={700}
                  label="Lives lost"
                  value={formatCountCompact(displayCasualties)}
                />
              </>
            )}
          </div>
        )}

        {stage === 'overture' && sides.length > 0 && (
          <div
            className="mt-6 mx-auto max-w-[64ch]"
            style={{ animation: reducedMotion ? 'none' : 'wc-rise 850ms 820ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div className="flex items-center justify-center gap-x-2.5 gap-y-1.5 flex-wrap">
              {sides.slice(0, 6).map((s, i) => (
                <span key={`${i}-${s}`} className="inline-flex items-center gap-2">
                  {i > 0 && <span className="text-slate-700">·</span>}
                  <span
                    className="text-[14.5px] tracking-tight"
                    style={{
                      fontFamily: theme.titleFont,
                      fontStyle: 'italic',
                      color: 'rgba(241,245,249,0.96)',
                      textShadow: '0 2px 12px rgba(0,0,0,0.7)',
                    }}
                  >
                    {s}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {stage === 'aftermath' && cleanProseText(summary?.outcome) && (
          <p
            className="mt-9 mx-auto max-w-[64ch] text-[16px] leading-[1.6] text-slate-100/95 text-left"
            style={{
              fontFamily: theme.titleFont,
              animation: reducedMotion ? 'none' : 'wc-rise 850ms 860ms cubic-bezier(.2,.7,.25,1) both',
            }}
          >
            {cleanProseText(summary?.outcome)}
          </p>
        )}

        {stage === 'aftermath' && cleanProseText(summary?.aftermath) && (
          <p
            className="mt-4 mx-auto max-w-[64ch] text-[13.5px] leading-[1.7] text-slate-300/85 italic text-left"
            style={{
              fontFamily: theme.titleFont,
              animation: reducedMotion ? 'none' : 'wc-rise 900ms 1080ms cubic-bezier(.2,.7,.25,1) both',
            }}
          >
            {cleanProseText(summary?.aftermath)}
          </p>
        )}

        {stage === 'aftermath' && summary?.notable && summary.notable.length > 0 && (
          <div
            className="mt-7 mx-auto max-w-[64ch] text-left"
            style={{ animation: reducedMotion ? 'none' : 'wc-rise 900ms 1240ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            <div className="text-[10px] uppercase tracking-[0.36em] text-slate-500 mb-2">
              Notable
            </div>
            <ul className="space-y-1.5">
              {summary.notable.slice(0, 5).map((n, i) => (
                <li
                  key={`${i}-${n}`}
                  className="text-[13px] leading-[1.6] text-slate-200/90 flex items-start gap-2"
                  style={{ fontFamily: theme.titleFont }}
                >
                  <span
                    className="mt-[7px] flex-shrink-0 rounded-full"
                    style={{ width: 3, height: 3, background: theme.accent }}
                  />
                  <span>{cleanProseText(n)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stage === 'aftermath' && summary && displayCasualties > 0 && !summary.aftermath && (
          <p
            className="mt-4 text-[12px] tracking-[0.18em] text-slate-400/90"
            style={{ animation: reducedMotion ? 'none' : 'wc-rise 800ms 1320ms cubic-bezier(.2,.7,.25,1) both' }}
          >
            {formatCasualtyLine(displayCasualties)}
          </p>
        )}

        {/* Primary + secondary action row. The primary is a substantial
            rectangular button with the play glyph forward-loaded, in the
            war's accent so it reads as the operative move on this title
            card. The secondary is a flat text-only action, no border, no
            background — its purpose is to step out of the cinematic into
            the manual war pane (and on the aftermath card, back to the
            globe), and a heavy outlined pill made it compete with the
            primary visually. Sans-serif body throughout so the buttons
            stop fighting the editorial serif of the title above. */}
        <div
          className="mt-8 flex items-center justify-center gap-5 flex-wrap"
          style={{
            animation: reducedMotion ? 'none' : 'wc-rise 800ms 1320ms cubic-bezier(.2,.7,.25,1) both',
            fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          }}
        >
          {stage === 'overture' && onBegin && (
            <button
              type="button"
              onClick={onBegin}
              autoFocus
              className="group inline-flex items-center gap-3 h-12 pl-3 pr-6 rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 hover:translate-y-[-1px]"
              style={{
                background: theme.accent,
                color: '#0b0d14',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.01em',
                boxShadow: `0 12px 32px -10px ${theme.accent}80, 0 0 0 1px ${theme.accent} inset`,
              }}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md"
                style={{ background: 'rgba(11,13,20,0.18)' }}
              >
                <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" className="ml-0.5">
                  <path d="M0.5 0.93v11.14a.5.5 0 0 0 .77.42l9.07-5.57a.5.5 0 0 0 0-.84L1.27.51A.5.5 0 0 0 .5.93z" />
                </svg>
              </span>
              <span>Play the war</span>
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="group inline-flex items-center gap-1.5 h-12 px-1 text-slate-300 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 rounded-sm"
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              letterSpacing: '0.04em',
            }}
          >
            <span>
              {stage === 'aftermath' ? 'Back to the globe' : 'Browse the battles'}
            </span>
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
            >
              <path d="M4 2 L8 6 L4 10" />
            </svg>
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
  return typeof document === 'undefined' ? node : createPortal(node, document.body);
}
