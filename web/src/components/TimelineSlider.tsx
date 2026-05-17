import { useCallback, useMemo, useRef } from 'react';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';
import type { Battle } from '../types/battle';
import { formatYear } from '../lib/format';

interface TimelineSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  battleCount: number;
  // battles is the full unfiltered set used to render the density curve.
  // Filtered battle count is shown separately via battleCount.
  battles: Battle[];
}

const HISTOGRAM_BINS = 180;

const ERA_RANGES: Record<string, [number, number]> = {
  'ancient': [-3000, 500],
  'medieval': [500, 1500],
  'early-modern': [1500, 1700],
  'napoleonic': [1700, 1820],
  'industrial': [1820, 1914],
  'world-war-1': [1914, 1918],
  'interwar': [1919, 1938],
  'world-war-2': [1939, 1945],
  'modern': [1945, 2025],
};

// Shorter pill labels. The track itself carries the era color slivers, so
// these chips stay terse and fit on a single row across the full screen.
const PILL_LABEL: Record<string, string> = {
  'ancient': 'Ancient',
  'medieval': 'Medieval',
  'early-modern': 'Early Modern',
  'napoleonic': 'Napoleonic',
  'industrial': 'Industrial',
  'world-war-1': 'WWI',
  'interwar': 'Interwar',
  'world-war-2': 'WWII',
  'modern': 'Modern',
};

const SERIF_DISPLAY = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";

export default function TimelineSlider({ min, max, value, onChange, battleCount, battles }: TimelineSliderProps) {
  const eras = useMemo(() => Object.entries(ERA_LABELS), []);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Bin battles into HISTOGRAM_BINS buckets across the [min, max] window.
  // More bins than before because the bar is wider now, so a denser
  // distribution reads as a curve rather than visible blocks.
  const histogram = useMemo(() => {
    if (battles.length === 0) return new Array(HISTOGRAM_BINS).fill(0);
    const bins = new Array(HISTOGRAM_BINS).fill(0) as number[];
    const range = max - min;
    if (range <= 0) return bins;
    for (const b of battles) {
      if (b.year < min || b.year > max) continue;
      let idx = Math.floor(((b.year - min) / range) * HISTOGRAM_BINS);
      if (idx >= HISTOGRAM_BINS) idx = HISTOGRAM_BINS - 1;
      if (idx < 0) idx = 0;
      bins[idx]++;
    }
    return bins;
  }, [battles, min, max]);

  const maxBin = useMemo(() => Math.max(1, ...histogram), [histogram]);

  const lowPct = ((value[0] - min) / (max - min)) * 100;
  const highPct = ((value[1] - min) / (max - min)) * 100;

  const yearFromClientX = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return value[0];
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(min + pct * (max - min));
    },
    [min, max, value],
  );

  // Clicking the track snaps whichever handle is nearest.
  const onTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!(e.target as HTMLElement).dataset.trackHit) return;
      const year = yearFromClientX(e.clientX);
      const distLow = Math.abs(year - value[0]);
      const distHigh = Math.abs(year - value[1]);
      if (distLow < distHigh) {
        onChange([Math.min(year, value[1] - 1), value[1]]);
      } else {
        onChange([value[0], Math.max(year, value[0] + 1)]);
      }
    },
    [yearFromClientX, value, onChange],
  );

  const isAllEras = value[0] === min && value[1] === max;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-[#070912f5] via-[#070912cc] to-transparent pt-5 pb-4 pointer-events-none">
      <div className="px-10 pointer-events-auto">
        {/* Refined readout. Year endpoints set in a display serif so they
            read like the chapter mark on a print spread, not a form value.
            "TO" set tracked small-caps in between, terse and quiet. */}
        <div className="mb-3 flex items-baseline justify-center gap-4 tabular-nums">
          <span
            className="text-slate-100 text-[22px] font-light tracking-tight"
            style={{ fontFamily: SERIF_DISPLAY }}
          >
            {formatYear(value[0])}
          </span>
          <span className="text-slate-600 text-[10px] uppercase tracking-[0.32em]">to</span>
          <span
            className="text-slate-100 text-[22px] font-light tracking-tight"
            style={{ fontFamily: SERIF_DISPLAY }}
          >
            {formatYear(value[1])}
          </span>
          <span className="text-slate-700 mx-1.5">·</span>
          <span className="text-blue-300 text-[15px] font-semibold tabular-nums">
            {battleCount.toLocaleString('en-US')}
          </span>
          <span className="text-slate-500 text-[10px] uppercase tracking-[0.24em]">
            in window
          </span>
          {!isAllEras && (
            <button
              onClick={() => onChange([min, max])}
              className="ml-3 text-[10px] uppercase tracking-[0.18em] text-slate-500 hover:text-slate-200 transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        {/* Track: full-bleed, era slivers + density + range box + thin pin
            handles. Nothing rides above the track now, so labels can't
            collide. */}
        <div
          ref={trackRef}
          className="relative h-[34px] rounded-lg overflow-hidden cursor-pointer bg-slate-950/70 border border-slate-800/70"
          onClick={onTrackClick}
        >
          {/* Era color slivers as the track background. Very low opacity so
              density bars stay primary. */}
          <div className="absolute inset-0 pointer-events-none" data-track-hit="1">
            {eras.map(([key]) => {
              const range = ERA_RANGES[key];
              if (!range) return null;
              const l = Math.max(min, range[0]);
              const r = Math.min(max, range[1]);
              if (r <= l) return null;
              const left = ((l - min) / (max - min)) * 100;
              const width = ((r - l) / (max - min)) * 100;
              return (
                <div
                  key={key}
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: `${ERA_COLORS[key]}14`,
                  }}
                />
              );
            })}
          </div>

          {/* Density bars rendered inside the track. */}
          <div className="absolute inset-0 flex items-end pointer-events-none" data-track-hit="1">
            {histogram.map((count, i) => {
              const left = (i / HISTOGRAM_BINS) * 100;
              const year = min + (i / HISTOGRAM_BINS) * (max - min);
              const within = year >= value[0] && year <= value[1];
              const h = Math.max(1.5, (count / maxBin) * 30);
              return (
                <div
                  key={i}
                  className="absolute bottom-0"
                  style={{
                    left: `${left}%`,
                    width: `calc(${100 / HISTOGRAM_BINS}% - 0.5px)`,
                    height: `${h}px`,
                    background: within ? 'rgba(96,165,250,0.7)' : 'rgba(148,163,184,0.18)',
                    transition: 'background 200ms ease, height 200ms ease',
                  }}
                />
              );
            })}
          </div>

          {/* Active range box. */}
          <div
            className="absolute top-0 bottom-0 border-x-2 border-blue-400/85 bg-blue-500/8 pointer-events-none"
            style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
            data-track-hit="1"
          />

          {/* Two stacked native range inputs with pin-style thumbs. */}
          <input
            type="range"
            min={min}
            max={max}
            value={value[0]}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              if (v < value[1]) onChange([v, value[1]]);
            }}
            className="absolute inset-x-0 top-0 bottom-0 w-full appearance-none bg-transparent timeline-range"
            aria-label="Earliest year"
          />
          <input
            type="range"
            min={min}
            max={max}
            value={value[1]}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              if (v > value[0]) onChange([value[0], v]);
            }}
            className="absolute inset-x-0 top-0 bottom-0 w-full appearance-none bg-transparent timeline-range"
            aria-label="Latest year"
          />
        </div>

        {/* Era jump row. Quiet monochrome pills with a color dot, only the
            pill whose era overlaps the active window lights up. Replaces the
            on-track labels so narrow eras (WWI / WWII / Modern) keep their
            jump affordance even though they fit no inline label. */}
        <div className="mt-2.5 flex items-center justify-center gap-1.5 flex-wrap">
          {eras.map(([key]) => {
            const range = ERA_RANGES[key];
            if (!range) return null;
            const lit = value[0] < range[1] && value[1] > range[0];
            const label = PILL_LABEL[key] || ERA_LABELS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange([Math.max(min, range[0]), Math.min(max, range[1])])}
                className="h-[22px] px-2.5 rounded-full text-[10px] uppercase tracking-[0.16em] font-medium border transition-colors inline-flex items-center gap-1.5"
                style={{
                  color: lit ? ERA_COLORS[key] : 'rgba(148,163,184,0.65)',
                  borderColor: lit ? `${ERA_COLORS[key]}66` : 'rgba(51,65,85,0.55)',
                  background: lit ? `${ERA_COLORS[key]}14` : 'transparent',
                }}
                title={`Jump to ${ERA_LABELS[key]}`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: ERA_COLORS[key],
                    opacity: lit ? 1 : 0.45,
                  }}
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
