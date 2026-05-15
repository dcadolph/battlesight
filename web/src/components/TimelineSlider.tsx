import { useMemo } from 'react';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';

interface TimelineSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  battleCount: number;
}

function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year} AD`;
}

export default function TimelineSlider({ min, max, value, onChange, battleCount }: TimelineSliderProps) {
  const eras = useMemo(() => Object.entries(ERA_LABELS), []);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0fdd] to-transparent pt-10 pb-5 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3 text-sm">
          <span className="text-slate-400 font-mono">{formatYear(value[0])}</span>
          <span className="text-slate-500">
            {battleCount} battle{battleCount !== 1 ? 's' : ''} in range
          </span>
          <span className="text-slate-400 font-mono">{formatYear(value[1])}</span>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="range"
            min={min}
            max={max}
            value={value[0]}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              if (v < value[1]) onChange([v, value[1]]);
            }}
            className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer"
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
            className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer"
          />
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          {eras.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                const eraRanges: Record<string, [number, number]> = {
                  'ancient': [-500, 500],
                  'medieval': [500, 1500],
                  'early-modern': [1500, 1700],
                  'napoleonic': [1700, 1820],
                  'industrial': [1820, 1914],
                  'world-war-1': [1914, 1918],
                  'world-war-2': [1939, 1945],
                  'modern': [1945, 2025],
                };
                const range = eraRanges[key];
                if (range) onChange(range);
              }}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all hover:scale-105"
              style={{
                backgroundColor: `${ERA_COLORS[key]}20`,
                color: ERA_COLORS[key],
                border: `1px solid ${ERA_COLORS[key]}40`,
              }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => onChange([min, max])}
            className="px-3 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-all"
          >
            All Eras
          </button>
        </div>
      </div>
    </div>
  );
}
