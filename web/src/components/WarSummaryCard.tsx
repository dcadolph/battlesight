import { useEffect, useState } from 'react';
import { themeForYear } from '../theme/era';
import { formatYear as fmtYear, formatCountCompact } from '../lib/format';

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
  // (used at end of playback). When false, the card starts collapsed.
  emphasize?: boolean;
  onEndingBattleClick?: (battleId: string) => void;
}

// Local thin wrappers route through the shared formatters. Keeping the
// names the rest of the file already used means the refactor stays local.
const formatYearLabel = (year: number) => fmtYear(year);
const formatCasualties = (n: number) => (n <= 0 ? 'Unknown' : `~${formatCountCompact(n)}`);

// WarSummaryCard is the curated atlas entry for a single war. Reads as a
// page out of a reference book: era-themed accent, outcome as headline,
// sectioned body, notable list as a real bulleted spread. Themed by the
// midpoint year of the war so a Napoleonic war shows in Napoleonic blue
// and a WWII war shows in Pacific rose, matching what the user sees on
// the globe behind it.
export default function WarSummaryCard({ warName, emphasize, onEndingBattleClick }: WarSummaryCardProps) {
  const [summary, setSummary] = useState<WarSummary | null>(null);
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

  // Theme the card by the midpoint year of the war. A Napoleonic-era war
  // gets Napoleonic blue, a WW2 war gets WW2 rose; the card cohres with
  // the rest of the atmosphere on the globe.
  const midYear = (summary.yearStart + summary.yearEnd) / 2;
  const theme = themeForYear(midYear);

  const yearLine = summary.yearStart && summary.yearEnd
    ? `${formatYearLabel(summary.yearStart)} to ${formatYearLabel(summary.yearEnd)}`
    : '';

  const casualtyLine = formatCasualties(summary.totalCasualties);
  const finalVictor = summary.finalVictor || summary.victorTallies?.[0]?.name || '';

  return (
    <div
      className="mt-3 rounded-xl overflow-hidden transition-all"
      style={{
        background: emphasize
          ? `linear-gradient(180deg, ${theme.accent}1f 0%, rgba(15,18,28,0.85) 70%)`
          : 'rgba(15,18,28,0.85)',
        border: `1px solid ${emphasize ? `${theme.accent}55` : 'rgba(51,55,76,0.6)'}`,
      }}
    >
      {/* Header. Era stamp on the left, expand control on the right.
          Always-visible outcome line below so even the collapsed card
          carries enough info to read at a glance. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 pt-3 pb-3 hover:bg-white/[0.02] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <div
            className="text-[9px] font-semibold uppercase tracking-[0.34em]"
            style={{ color: theme.accent }}
          >
            How it ended
          </div>
          <span
            className="text-[12px] text-slate-500 flex-shrink-0 tabular-nums"
            aria-hidden="true"
          >
            {expanded ? '−' : '+'}
          </span>
        </div>
        <p
          className="text-[14px] text-slate-100/95 leading-snug"
          style={{ fontFamily: theme.titleFont }}
        >
          {summary.outcome ? summary.outcome : finalVictor ? `${finalVictor} won.` : 'Outcome unrecorded.'}
        </p>
      </button>

      {/* Compact stats strip. Always visible so the collapsed card still
          surfaces the basic shape of the war. */}
      <div
        className="px-4 pb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400 tabular-nums border-b"
        style={{ borderColor: 'rgba(51,55,76,0.45)' }}
      >
        {yearLine && <span>{yearLine}</span>}
        <span>{summary.battleCount} battles</span>
        <span>{casualtyLine} casualties</span>
        {finalVictor && (
          <span>
            Victor <span className="text-slate-200">{finalVictor}</span>
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-4 space-y-5">
          {summary.aftermath && (
            <Section theme={theme} label="Aftermath">
              <p
                className="text-[13.5px] leading-[1.65] text-slate-200/90"
                style={{ fontFamily: theme.titleFont }}
              >
                {summary.aftermath}
              </p>
            </Section>
          )}

          {summary.keyTerms && (
            <Section theme={theme} label="Terms">
              <p
                className="text-[13.5px] leading-[1.6] text-slate-300/90 italic"
                style={{ fontFamily: theme.titleFont }}
              >
                {summary.keyTerms}
              </p>
            </Section>
          )}

          {summary.notable && summary.notable.length > 0 && (
            <Section theme={theme} label="Notable">
              <ul className="space-y-1.5">
                {summary.notable.map((n, i) => {
                  // Each notable line names a person, treaty, event, or
                  // engagement. We don't have curated URLs for them, so
                  // hand the reader off to a Wikipedia article lookup —
                  // close enough for first reference and easy to override
                  // later if/when we wire authoritative URLs into the data.
                  const url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(n)}&go=Go`;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-[13px] leading-snug text-slate-200/90"
                    >
                      <span
                        className="mt-[7px] flex-shrink-0 rounded-full"
                        style={{
                          width: 4,
                          height: 4,
                          background: theme.accent,
                          boxShadow: `0 0 6px ${theme.accent}88`,
                        }}
                      />
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline transition-colors"
                        style={{ fontFamily: theme.titleFont, color: '#e2e8f0' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = theme.accent)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#e2e8f0')}
                      >
                        {n}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {summary.endingBattle && onEndingBattleClick && (
            <button
              type="button"
              onClick={() => onEndingBattleClick(summary.endingBattle!.id)}
              className="w-full text-left mt-1 px-3 py-2.5 rounded-lg text-[12px] transition-all focus:outline-none focus-visible:ring-1"
              style={{
                background: `${theme.accent}10`,
                border: `1px solid ${theme.accent}40`,
                color: theme.accent,
              }}
            >
              <span className="text-[9px] uppercase tracking-[0.22em] block mb-0.5 opacity-80">Final battle</span>
              <span className="text-slate-100">{summary.endingBattle.name}</span>
              <span className="ml-2 text-slate-500 tabular-nums">{formatYearLabel(summary.endingBattle.year)}</span>
              <span className="float-right opacity-80">→</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Section is the reusable label + content pair shared across the war
// card's expanded body. Tight tracked label in the era accent, then the
// body underneath at a comfortable reading size.
function Section({
  theme,
  label,
  children,
}: {
  theme: { accent: string };
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="text-[9px] font-semibold uppercase tracking-[0.3em] mb-2"
        style={{ color: theme.accent }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
