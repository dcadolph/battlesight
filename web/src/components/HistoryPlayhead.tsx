import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EraTheme } from '../theme/era';
import { ERA_RANGES, themeForEra } from '../theme/era';
import type { HistoryBeat } from '../data/history-beats';
import { formatYear } from '../lib/format';

interface HistoryPlayheadProps {
  // year currently being highlighted on the timeline.
  year: number;
  // minYear / maxYear bracket the scrub range. Identical to the App's
  // MIN_YEAR / MAX_YEAR constants so the bar always spans the full sweep.
  minYear: number;
  maxYear: number;
  // theme drives mood text and accent color so the overlay coheres with the
  // globe's atmosphere shift.
  theme: EraTheme;
  // playing toggles the play/pause glyph.
  playing: boolean;
  // beats are the curated history beats. Rendered as tickmarks on the bar so
  // the user reads upcoming chapters and can click straight to one.
  beats: HistoryBeat[];
  // battleCount is the number of battles ignited so far.
  battleCount: number;
  onToggle: () => void;
  onClose: () => void;
  // onScrub fires when the user drags or clicks on the scrub bar. The host
  // updates the playhead year and decides what to do with the curated beats
  // that were skipped over.
  onScrub: (year: number) => void;
  // onSeekBeat fires when the user clicks a beat marker. The host jumps to
  // that beat's year and surfaces the beat title card.
  onSeekBeat: (beatIndex: number) => void;
}

// HistoryPlayhead is the cinematic control surface shown while the history
// sweep is active. The bar is the protagonist: the user can scrub it like a
// film timeline, click any era band to jump to it, or click a beat marker to
// surface its chapter card immediately. Era bands behind the bar give the
// 2,500-year sweep a sense of shape. Beat ticks rise above the bar so the
// reader knows what is coming and can skip ahead.
export default function HistoryPlayhead({
  year,
  minYear,
  maxYear,
  theme,
  playing,
  beats,
  battleCount,
  onToggle,
  onClose,
  onScrub,
  onSeekBeat,
}: HistoryPlayheadProps) {
  const span = Math.max(1, maxYear - minYear);
  const progress = Math.max(0, Math.min(1, (year - minYear) / span));

  const barRef = useRef<HTMLDivElement | null>(null);
  const [draggingHoverYear, setDraggingHoverYear] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // yearFromClientX converts a viewport x coordinate into the corresponding
  // year on the bar. Clamped to the bar's bounds so an over-pull beyond the
  // bar still resolves to the closest valid year.
  const yearFromClientX = useCallback(
    (clientX: number): number => {
      const el = barRef.current;
      if (!el) return year;
      const rect = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(minYear + t * span);
    },
    [year, minYear, span],
  );

  // Pointer-driven scrub. Pointer events unify mouse, pen, and touch into one
  // path so the bar feels identical on a trackpad and an iPad. setPointerCapture
  // means the drag keeps tracking even after the cursor leaves the bar.
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setIsDragging(true);
      const y = yearFromClientX(e.clientX);
      setDraggingHoverYear(y);
      onScrub(y);
    },
    [onScrub, yearFromClientX],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) {
        // Even when not dragging, show the hover preview so the user reads
        // the year they would land on if they clicked.
        setDraggingHoverYear(yearFromClientX(e.clientX));
        return;
      }
      const y = yearFromClientX(e.clientX);
      setDraggingHoverYear(y);
      onScrub(y);
    },
    [isDragging, onScrub, yearFromClientX],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      setIsDragging(false);
    },
    [],
  );

  const onPointerLeave = useCallback(() => {
    if (!isDragging) setDraggingHoverYear(null);
  }, [isDragging]);

  // Arrow-key stepping is ±25 years, Shift+Arrow ±100 years. Lets a keyboard
  // user move quickly through a long sweep without picking up the pointer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Avoid swallowing arrows when the user is typing in a control. The
      // playhead is the global control surface during history mode, so it
      // should respond when the page itself is focused, not always.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = (e.shiftKey ? 100 : 25) * (e.key === 'ArrowRight' ? 1 : -1);
        onScrub(Math.max(minYear, Math.min(maxYear, year + step)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [year, minYear, maxYear, onScrub]);

  // Era band geometry: faint colored regions behind the bar. Width is
  // proportional to each era's year span, so the eye reads how much of
  // recorded history each era covers at a glance (ancient is wide; world-war-1
  // is a sliver). Color is the era's accent at very low alpha so the bar's
  // foreground stroke still reads as the protagonist.
  const eraBands = useMemo(() => {
    return ERA_RANGES.map(([key, lo, hi]) => {
      const start = Math.max(0, (lo - minYear) / span);
      const end = Math.min(1, (hi - minYear) / span);
      if (end <= start) return null;
      const t = themeForEra(key);
      return { key, start, end, accent: t.accent, mood: t.mood };
    }).filter(Boolean) as { key: string; start: number; end: number; accent: string; mood: string }[];
  }, [minYear, span]);

  const hoverPct = draggingHoverYear != null
    ? Math.max(0, Math.min(1, (draggingHoverYear - minYear) / span)) * 100
    : null;

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div
        className="px-7 pt-3 pb-3 rounded-2xl bg-black/65 backdrop-blur-xl border shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] text-center pointer-events-auto"
        style={{
          width: 'min(680px, 92vw)',
          borderColor: `${theme.accent}33`,
        }}
      >
        {/* Top row: mood label · year · controls. Year sits in the middle so
            it reads as the headline; controls hug the right; mood the left. */}
        <div className="flex items-center justify-between gap-4 mb-2">
          <div
            className="text-[10px] uppercase tracking-[0.36em] flex-1 text-left"
            style={{ color: theme.accent }}
          >
            {theme.mood}
          </div>
          <div
            className="tabular-nums text-white leading-none"
            style={{
              fontFamily: theme.titleFont,
              fontWeight: 500,
              fontSize: 38,
              textShadow: '0 4px 24px rgba(0,0,0,0.6)',
            }}
          >
            {formatYear(year)}
          </div>
          <div className="flex-1 flex justify-end gap-1.5">
            <button
              onClick={onToggle}
              className="inline-flex items-center justify-center h-8 w-8 rounded-full text-white/90 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              style={{
                backgroundColor: `${theme.accent}26`,
                border: `1px solid ${theme.accent}55`,
              }}
              aria-label={playing ? 'Pause sweep (Space)' : 'Resume sweep (Space)'}
              title={playing ? 'Pause' : 'Resume'}
            >
              {playing ? (
                <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor"><rect x="0" y="0" width="3.5" height="12" rx="1"/><rect x="7" y="0" width="3.5" height="12" rx="1"/></svg>
              ) : (
                <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor"><path d="M1 0.5 L1 11.5 L10.5 6 Z"/></svg>
              )}
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center h-8 w-8 rounded-full text-rose-200 hover:text-white bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60"
              aria-label="Exit history mode (Esc)"
              title="Exit history mode (Esc)"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 1 L10 10 M10 1 L1 10"/></svg>
            </button>
          </div>
        </div>

        {/* Scrub track. Wraps a generous hit area around a thinner visual
            bar so dragging is forgiving on touch. */}
        <div
          ref={barRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          className="relative mt-1 mx-auto cursor-pointer select-none"
          style={{ height: 28, touchAction: 'none' }}
          role="slider"
          aria-label="History playhead. Drag to scrub through the years."
          aria-valuemin={minYear}
          aria-valuemax={maxYear}
          aria-valuenow={year}
        >
          {/* Era bands. Faint backdrop colors so the user reads "this stretch
              is medieval, this short slice is WW1" without text labels. */}
          <div className="absolute inset-x-0 top-[11px] h-[6px] rounded-full overflow-hidden bg-slate-900/80 border border-white/5">
            {eraBands.map((b) => (
              <div
                key={b.key}
                className="absolute top-0 bottom-0"
                style={{
                  left: `${b.start * 100}%`,
                  width: `${(b.end - b.start) * 100}%`,
                  background: `${b.accent}26`,
                }}
                title={b.mood}
              />
            ))}
            {/* Era boundary hairlines so the user feels the chapter breaks. */}
            {eraBands.slice(0, -1).map((b) => (
              <div
                key={`${b.key}-end`}
                className="absolute top-0 bottom-0 w-px"
                style={{
                  left: `${b.end * 100}%`,
                  background: 'rgba(255,255,255,0.16)',
                }}
              />
            ))}
            {/* Filled progress. */}
            <div
              className="absolute top-0 bottom-0 left-0"
              style={{
                width: `${progress * 100}%`,
                background: `linear-gradient(90deg, ${theme.accent}90, ${theme.accent})`,
                boxShadow: `0 0 14px ${theme.accent}88`,
                transition: isDragging ? 'none' : 'width 200ms ease-out',
              }}
            />
          </div>

          {/* Beat tickmarks above the bar. Each marker is a clickable target
              with a hover tooltip. Marker height varies by past/future state
              so the eye reads progress at a glance. */}
          {beats.map((beat, i) => {
            const t = (beat.year - minYear) / span;
            if (t < 0 || t > 1) return null;
            const past = beat.year <= year;
            const beatTheme = themeForEra(beat.era);
            return (
              <button
                key={`${i}-${beat.year}-${beat.headline}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSeekBeat(i);
                }}
                className="group absolute pointer-events-auto focus:outline-none"
                style={{
                  left: `${t * 100}%`,
                  top: 0,
                  transform: 'translateX(-50%)',
                  height: 14,
                  width: 14,
                }}
                aria-label={`${beat.headline}, ${formatYear(beat.year)}`}
                title={`${beat.headline} · ${formatYear(beat.year)}`}
              >
                <span
                  className="block mx-auto rounded-full transition-all"
                  style={{
                    width: 6,
                    height: past ? 10 : 7,
                    marginTop: past ? 0 : 2,
                    background: beatTheme.accent,
                    boxShadow: past ? `0 0 6px ${beatTheme.accent}` : 'none',
                    opacity: past ? 1 : 0.6,
                  }}
                />
                {/* Tooltip pinned above the tick. Pops on hover/focus. */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity pointer-events-none"
                  style={{ top: -38, whiteSpace: 'nowrap' }}
                >
                  <div
                    className="rounded-md px-2 py-1 text-[10px] font-semibold tracking-wide text-white shadow-lg border"
                    style={{
                      background: 'rgba(8, 10, 18, 0.94)',
                      borderColor: `${beatTheme.accent}66`,
                    }}
                  >
                    {beat.headline}
                    <span className="ml-1.5 opacity-60 tabular-nums">{formatYear(beat.year)}</span>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Hover preview line: vertical hint line showing where a click
              would land while the cursor is over the bar but no drag is
              underway. Suppressed during active drag so it does not duplicate
              the thumb. */}
          {hoverPct != null && !isDragging && (
            <>
              <div
                className="absolute top-[8px] bottom-[6px] w-px pointer-events-none"
                style={{
                  left: `${hoverPct}%`,
                  background: 'rgba(255,255,255,0.35)',
                }}
              />
              <div
                className="absolute pointer-events-none tabular-nums text-[10px] text-white/90 font-semibold px-1.5 py-0.5 rounded bg-black/70 border border-white/15"
                style={{
                  left: `${hoverPct}%`,
                  top: 22,
                  transform: 'translateX(-50%)',
                }}
              >
                {formatYear(draggingHoverYear!)}
              </div>
            </>
          )}

          {/* Draggable thumb. Larger hit target than its visual so it stays
              easy to grab on a touchscreen. */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${progress * 100}%`,
              top: 7,
              transform: 'translateX(-50%)',
              transition: isDragging ? 'none' : 'left 200ms ease-out',
            }}
          >
            <div
              className="rounded-full border-2"
              style={{
                width: 14,
                height: 14,
                background: theme.accent,
                borderColor: '#fff',
                boxShadow: `0 0 0 4px ${theme.accent}33, 0 4px 12px rgba(0,0,0,0.5)`,
              }}
            />
          </div>
        </div>

        {/* Foot row: battle count + scrub hint. The hint teaches the
            interaction the first time the user sees the bar. */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
          <span className="tabular-nums">
            {battleCount.toLocaleString('en-US')} battles ignited
          </span>
          <span className="text-slate-500 hidden md:inline">
            Drag the bar or click a chapter mark to jump
          </span>
        </div>
      </div>
    </div>
  );
}
