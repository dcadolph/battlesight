import { useEffect, useState } from 'react';

interface WarBattleRef {
  id: string;
  name: string;
  year: number;
  victor?: string;
}

interface VictorTally {
  name: string;
  count: number;
}

interface WarSummary {
  name: string;
  battleCount: number;
  yearStart: number;
  yearEnd: number;
  dateStart?: string;
  dateEnd?: string;
  totalCasualties: number;
  victorTallies?: VictorTally[];
  finalVictor?: string;
  endingBattle?: WarBattleRef;
  outcome?: string;
  aftermath?: string;
  keyTerms?: string;
  notable?: string[];
}

interface WarSummaryCardProps {
  warName: string;
  // emphasize prompts the card to render fully expanded with stronger framing
  // (used at end of playback). When false, the card renders collapsed and is
  // expandable on click.
  emphasize?: boolean;
  onEndingBattleClick?: (battleId: string) => void;
}

function formatYearLabel(year: number): string {
  if (year === 0) return '?';
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year}`;
}

function formatCasualties(n: number): string {
  if (n <= 0) return 'Unknown';
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `~${(n / 1000).toFixed(0)}k`;
  return `~${n.toLocaleString('en-US')}`;
}

export default function WarSummaryCard({ warName, emphasize, onEndingBattleClick }: WarSummaryCardProps) {
  const [summary, setSummary] = useState<WarSummary | null>(null);
  // Always start collapsed so the war playback panel does not blow up to fill
  // the whole screen on first open. The user opens this on demand.
  const [expanded, setExpanded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!warName) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setError(null);
    fetch(`/api/wars/summary?name=${encodeURIComponent(warName)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((s: WarSummary) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        if (!cancelled) setError('Summary unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [warName]);

  useEffect(() => {
    if (emphasize) setExpanded(true);
  }, [emphasize]);

  if (!warName) return null;
  if (error) return null;
  if (!summary) return null;

  const yearLine = summary.yearStart && summary.yearEnd
    ? `${formatYearLabel(summary.yearStart)} to ${formatYearLabel(summary.yearEnd)}`
    : '';

  const casualtyLine = formatCasualties(summary.totalCasualties);
  const finalVictor = summary.finalVictor || summary.victorTallies?.[0]?.name || '';

  return (
    <div
      className={`mt-3 rounded-xl border ${
        emphasize
          ? 'border-blue-500/50 bg-blue-500/10'
          : 'border-slate-700/40 bg-[#0e1019]'
      } overflow-hidden`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex flex-col min-w-0">
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-blue-300/80">
            How it ended
          </span>
          <span className="text-[12px] text-slate-200 truncate">
            {summary.outcome ? summary.outcome : finalVictor ? `${finalVictor} won.` : 'Outcome unrecorded.'}
          </span>
        </div>
        <span className="text-[10px] text-slate-500 flex-shrink-0">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 text-[12px] text-slate-300 leading-relaxed">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {yearLine && <span>{yearLine}</span>}
            <span>{summary.battleCount} battles</span>
            <span>{casualtyLine} casualties</span>
            {finalVictor && <span>Final victor: <span className="text-slate-200">{finalVictor}</span></span>}
          </div>

          {summary.outcome && (
            <p className="text-slate-300">{summary.outcome}</p>
          )}

          {summary.keyTerms && (
            <p>
              <span className="text-[9px] uppercase tracking-[0.18em] text-slate-500 mr-1">Terms:</span>
              <span className="text-slate-400">{summary.keyTerms}</span>
            </p>
          )}

          {summary.aftermath && (
            <p className="text-slate-400">{summary.aftermath}</p>
          )}

          {summary.notable && summary.notable.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500 mb-1">Notable</div>
              <ul className="space-y-0.5 text-slate-400 list-disc list-inside marker:text-slate-700">
                {summary.notable.map((n, i) => (
                  <li key={i} className="text-[11px] leading-snug">{n}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.endingBattle && onEndingBattleClick && (
            <button
              type="button"
              onClick={() => onEndingBattleClick(summary.endingBattle!.id)}
              className="text-[11px] text-blue-300 hover:text-blue-100 transition-colors"
            >
              Last battle: {summary.endingBattle.name} ({formatYearLabel(summary.endingBattle.year)}) →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
