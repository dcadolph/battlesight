import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EraTheme } from '../theme/era';
import { ERA_RANGES, themeForEra } from '../theme/era';
import type { HistoryBeat } from '../data/history-beats';
import { formatYear } from '../lib/format';
import CloseButton from './CloseButton';

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
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
      <div
        className="px-9 pt-6 pb-5 rounded-3xl bg-black/70 backdrop-blur-2xl border shadow-[0_36px_80px_-16px_rgba(0,0,0,0.85)] text-center pointer-events-auto"
        style={{
          width: 'min(820px, 94vw)',
          borderColor: `${theme.accent}44`,
          boxShadow: `0 36px 80px -16px rgba(0,0,0,0.85), inset 0 1px 0 ${theme.accent}22, 0 0 60px ${theme.accent}1a`,
        }}
      >
        {/* Hero row: the year is the protagonist, set huge in the era
            display face. Mood text and controls flank it. The previous
            layout was a thin pill with a small year that read like a
            video-player toolbar; this one stages the sweep as a chapter
            heading the user actually wants to look at. */}
        <div className="flex items-start justify-between gap-6 mb-5">
          <div className="flex flex-col items-start text-left flex-1 min-w-0">
            <span
              className="text-[10px] uppercase tracking-[0.42em] font-semibold"
              style={{ color: theme.accent, textShadow: '0 2px 12px rgba(0,0,0,0.7)' }}
            >
              {theme.mood}
            </span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mt-1.5 tabular-nums">
              {battleCount.toLocaleString('en-US')} battles ignited
            </span>
          </div>
          <div
            className="tabular-nums text-white leading-none flex-shrink-0"
            style={{
              fontFamily: theme.titleFont,
              fontWeight: 500,
              fontSize: 'clamp(48px, 5.4vw, 64px)',
              letterSpacing: '-0.02em',
              textShadow: `0 4px 28px rgba(0,0,0,0.7), 0 0 18px ${theme.accent}33`,
            }}
          >
            {formatYear(year)}
          </div>
          <div className="flex-1 flex items-center justify-end gap-2">
            <button
              onClick={onToggle}
              className="inline-flex items-center justify-center h-10 w-10 rounded-full text-white transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 hover:scale-105"
              style={{
                backgroundColor: `${theme.accent}33`,
                border: `1px solid ${theme.accent}80`,
                boxShadow: `0 4px 16px ${theme.accent}33`,
              }}
              aria-label={playing ? 'Pause sweep (Space)' : 'Resume sweep (Space)'}
              title={playing ? 'Pause' : 'Resume'}
            >
              {playing ? (
                <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true"><rect x="1" y="0" width="3.5" height="14" rx="1"/><rect x="7.5" y="0" width="3.5" height="14" rx="1"/></svg>
              ) : (
                <svg width="13" height="14" viewBox="0 0 13 14" fill="currentColor" aria-hidden="true"><path d="M2 1 L2 13 L12 7 Z"/></svg>
              )}
            </button>
            <CloseButton onClick={onClose} label="Exit history mode (Esc)" tone="elevated" />
          </div>
        </div>

        {/* Scrub track. Thicker bar (12 px) with saturated era bands so
            the eye reads the shape of recorded history before the user
            does anything. Generous hit area (38 px) keeps drag forgiving
            on touch. */}
        <div
          ref={barRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          className="relative mt-1 mx-auto cursor-pointer select-none"
          style={{ height: 38, touchAction: 'none' }}
          role="slider"
          aria-label="History playhead. Drag to scrub through the years."
          aria-valuemin={minYear}
          aria-valuemax={maxYear}
          aria-valuenow={year}
        >
          {/* Era bands. Slightly heavier alpha so the colored slices read
              as a chapter map at rest, not a ghost behind the bar. */}
          <div className="absolute inset-x-0 top-[14px] h-[12px] rounded-full overflow-hidden bg-slate-900/85 border border-white/8" style={{ boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.6)' }}>
            {eraBands.map((b) => (
              <div
                key={b.key}
                className="absolute top-0 bottom-0"
                style={{
                  left: `${b.start * 100}%`,
                  width: `${(b.end - b.start) * 100}%`,
                  background: `linear-gradient(180deg, ${b.accent}55 0%, ${b.accent}35 100%)`,
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
                  background: 'rgba(255,255,255,0.22)',
                }}
              />
            ))}
            {/* Filled progress overlay on top of era bands so the colored
                slice through which the user has already swept reads as
                "lit" while the rest stays muted. */}
            <div
              className="absolute top-0 bottom-0 left-0"
              style={{
                width: `${progress * 100}%`,
                background: `linear-gradient(90deg, ${theme.accent}aa 0%, ${theme.accent} 100%)`,
                boxShadow: `0 0 18px ${theme.accent}bb, inset 0 1px 0 rgba(255,255,255,0.18)`,
                transition: isDragging ? 'none' : 'width 200ms ease-out',
              }}
            />
          </div>

          {/* Beat tickmarks. Vertical pillars rising above the bar in
              the era's accent. Lit (full opacity, glowing) when the
              playhead has passed them; dim and short when still upcoming.
              The headline pops on hover or focus into a small chapter
              chip above the tick. */}
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
                  height: 26,
                  width: 18,
                }}
                aria-label={`${beat.headline}, ${formatYear(beat.year)}`}
                title={`${beat.headline} · ${formatYear(beat.year)}`}
              >
                <span
                  className="block mx-auto rounded-full transition-all group-hover:scale-y-110"
                  style={{
                    width: 3,
                    height: past ? 14 : 10,
                    marginTop: past ? 0 : 4,
                    background: beatTheme.accent,
                    boxShadow: past
                      ? `0 0 10px ${beatTheme.accent}, 0 0 4px ${beatTheme.accent}`
                      : `0 0 4px ${beatTheme.accent}55`,
                    opacity: past ? 1 : 0.55,
                    transformOrigin: 'bottom',
                  }}
                />
                {/* Chapter chip above the tick. Pops on hover and focus. */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity pointer-events-none"
                  style={{ top: -42, whiteSpace: 'nowrap' }}
                >
                  <div
                    className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-white shadow-xl border backdrop-blur"
                    style={{
                      background: 'rgba(8, 10, 18, 0.92)',
                      borderColor: `${beatTheme.accent}88`,
                      boxShadow: `0 8px 24px rgba(0,0,0,0.6), 0 0 14px ${beatTheme.accent}33`,
                    }}
                  >
                    {beat.headline}
                    <span className="ml-2 opacity-60 tabular-nums text-[10px]">{formatYear(beat.year)}</span>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Hover preview: vertical hint line + year chip showing where
              a click would land while the cursor is over the bar but no
              drag is underway. Suppressed during active drag to avoid
              duplicating the thumb. */}
          {hoverPct != null && !isDragging && (
            <>
              <div
                className="absolute top-[10px] bottom-[6px] w-px pointer-events-none"
                style={{
                  left: `${hoverPct}%`,
                  background: 'rgba(255,255,255,0.45)',
                }}
              />
              <div
                className="absolute pointer-events-none tabular-nums text-[11px] text-white font-semibold px-2 py-0.5 rounded-md bg-black/85 border border-white/25 shadow-lg"
                style={{
                  left: `${hoverPct}%`,
                  top: 30,
                  transform: 'translateX(-50%)',
                }}
              >
                {formatYear(draggingHoverYear!)}
              </div>
            </>
          )}

          {/* Draggable thumb. Vertical pill anchored on the bar; the
              accent-colored core sits inside a white halo so the thumb
              registers as the protagonist of the bar against any era
              backdrop. */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${progress * 100}%`,
              top: 8,
              transform: 'translateX(-50%)',
              transition: isDragging ? 'none' : 'left 200ms ease-out',
            }}
          >
            <div
              className="rounded-full border-2"
              style={{
                width: 18,
                height: 24,
                background: `linear-gradient(180deg, #fff 0%, ${theme.accent} 100%)`,
                borderColor: '#fff',
                boxShadow: `0 0 0 4px ${theme.accent}44, 0 6px 18px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.6)`,
              }}
            />
          </div>
        </div>

        {/* Foot row: keyboard hint. Battle count moved up next to the
            mood label so the foot can carry the interaction teaching
            without competing for the eye. */}
        <div className="mt-4 flex items-center justify-center text-[10px] uppercase tracking-[0.24em] text-slate-500">
          <span className="hidden md:inline">
            Drag the bar · click a chapter mark · arrow keys step 25 years (shift for 100)
          </span>
          <span className="md:hidden">
            Drag to scrub · tap a chapter mark
          </span>
        </div>
      </div>
    </div>
  );
}
