import { useCallback, useMemo, useRef } from 'react';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';
import type { Battle } from '../types/battle';

interface TimelineSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  battleCount: number;
  // battles is the full unfiltered set used to render the density histogram.
  // Filtered battle count is shown separately via battleCount.
  battles: Battle[];
}

const HISTOGRAM_BINS = 96;
const ERA_RANGES: Record<string, [number, number]> = {
  'ancient': [-500, 500],
  'medieval': [500, 1500],
  'early-modern': [1500, 1700],
  'napoleonic': [1700, 1820],
  'industrial': [1820, 1914],
  'world-war-1': [1914, 1918],
  'world-war-2': [1939, 1945],
  'modern': [1945, 2025],
};

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year}`;
}

export default function TimelineSlider({ min, max, value, onChange, battleCount, battles }: TimelineSliderProps) {
  const eras = useMemo(() => Object.entries(ERA_LABELS), []);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Bin battles into HISTOGRAM_BINS buckets across the [min, max] window.
  // The resulting bars give the user a visual sense of where battle density
  // is highest before they even drag the handles.
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

  // Percent positions of the two handles along the track.
  const lowPct = ((value[0] - min) / (max - min)) * 100;
  const highPct = ((value[1] - min) / (max - min)) * 100;

  // commitFromClientX maps a screen-space x to a year, used by the optional
  // click-to-jump handler on the track.
  const commitFromClientX = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return value[0];
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(min + pct * (max - min));
    },
    [min, max, value],
  );

  const onTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only the track background itself triggers a jump. The handles use
      // the input[type=range] thumbs underneath.
      if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.trackHit) return;
      const year = commitFromClientX(e.clientX);
      // Snap whichever handle is closer.
      const distLow = Math.abs(year - value[0]);
      const distHigh = Math.abs(year - value[1]);
      if (distLow < distHigh) {
        onChange([Math.min(year, value[1] - 1), value[1]]);
      } else {
        onChange([value[0], Math.max(year, value[0] + 1)]);
      }
    },
    [commitFromClientX, value, onChange],
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-[#070912] via-[#070912ee] to-transparent pt-6 pb-3 px-6">
      <div className="max-w-5xl mx-auto">
        {/* Top row: handles, counts, ranges */}
        <div className="flex items-end justify-between mb-2 text-[11px] tracking-wide">
          <div className="flex flex-col items-start min-w-[5ch]">
            <span className="text-[9px] uppercase text-slate-500 tracking-[0.2em]">From</span>
            <span className="text-slate-200 font-mono tabular-nums text-[13px]">{formatYear(value[0])}</span>
          </div>
          <div className="text-center">
            <div className="text-[9px] uppercase text-slate-500 tracking-[0.2em]">In window</div>
            <div className="text-blue-300 tabular-nums text-[13px] font-semibold">
              {battleCount.toLocaleString('en-US')} battle{battleCount !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="flex flex-col items-end min-w-[5ch]">
            <span className="text-[9px] uppercase text-slate-500 tracking-[0.2em]">To</span>
            <span className="text-slate-200 font-mono tabular-nums text-[13px]">{formatYear(value[1])}</span>
          </div>
        </div>

        {/* Track + histogram + handles */}
        <div
          ref={trackRef}
          className="relative h-[58px] select-none cursor-pointer"
          onClick={onTrackClick}
        >
          {/* Era band backdrop. Each era is a faint colored tile spanning its
              year range, giving the user a sense of which historical period a
              point in the slider belongs to. */}
          <div className="absolute inset-x-0 top-0 h-[42px] flex pointer-events-none">
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
                    background: `linear-gradient(180deg, ${ERA_COLORS[key]}22 0%, ${ERA_COLORS[key]}06 100%)`,
                  }}
                />
              );
            })}
          </div>

          {/* Density histogram. Each bar's height is proportional to the
              count of battles whose year falls in that bin. Rendered as div
              flex columns rather than SVG to keep DOM weight low. */}
          <div className="absolute inset-x-0 top-0 h-[42px] flex items-end gap-[1px] pointer-events-none">
            {histogram.map((count, i) => {
              const left = (i / HISTOGRAM_BINS) * 100;
              const within = (() => {
                const year = min + (i / HISTOGRAM_BINS) * (max - min);
                return year >= value[0] && year <= value[1];
              })();
              const h = Math.max(2, (count / maxBin) * 42);
              return (
                <div
                  key={i}
                  className="absolute bottom-[16px]"
                  style={{
                    left: `${left}%`,
                    width: `calc(${100 / HISTOGRAM_BINS}% - 1px)`,
                    height: `${h}px`,
                    background: within ? 'rgba(96,165,250,0.65)' : 'rgba(148,163,184,0.18)',
                    transition: 'background 200ms ease',
                  }}
                />
              );
            })}
          </div>

          {/* Filled range bar between the two handles. */}
          <div
            className="absolute top-[40px] h-[6px] rounded-full bg-blue-500/40 border border-blue-400/30 pointer-events-none"
            style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
          />
          {/* Empty range bar full-width as background. */}
          <div
            className="absolute top-[40px] inset-x-0 h-[6px] rounded-full bg-slate-800/60 pointer-events-none"
            data-track-hit="1"
          />

          {/* Two stacked native range inputs. Their tracks are invisible
              (only the thumbs show) so they don't fight the styled track
              above. pointer-events: none on the input itself, auto on the
              thumb via :slider-thumb selectors in global CSS. We approximate
              that by making the input transparent and full-bleed. */}
          <input
            type="range"
            min={min}
            max={max}
            value={value[0]}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              if (v < value[1]) onChange([v, value[1]]);
            }}
            className="absolute inset-x-0 top-[34px] w-full appearance-none bg-transparent timeline-range"
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
            className="absolute inset-x-0 top-[34px] w-full appearance-none bg-transparent timeline-range"
            aria-label="Latest year"
          />
        </div>

        {/* Era chips. Compact, smaller than before, with one-tap shortcut. */}
        <div className="mt-1 flex flex-wrap gap-1.5 justify-center">
          {eras.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                const range = ERA_RANGES[key];
                if (range) onChange([Math.max(min, range[0]), Math.min(max, range[1])]);
              }}
              className="h-6 px-2.5 rounded-full text-[10px] font-medium tracking-wide transition-colors"
              style={{
                backgroundColor: `${ERA_COLORS[key]}1A`,
                color: ERA_COLORS[key],
                border: `1px solid ${ERA_COLORS[key]}33`,
              }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => onChange([min, max])}
            className="h-6 px-2.5 rounded-full text-[10px] font-medium tracking-wide bg-slate-800/70 text-slate-300 border border-slate-700/50 hover:bg-slate-700 transition-colors"
          >
            All eras
          </button>
        </div>
      </div>
    </div>
  );
}
