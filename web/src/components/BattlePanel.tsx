import { useEffect, useState } from 'react';
import type { Battle, Reference } from '../types/battle';
import { ERA_COLORS, ERA_LABELS, TIER_LABELS, TIER_DESCRIPTIONS } from '../types/battle';
import { themeForEra } from '../theme/era';
import { formatYear, formatBattleDate } from '../lib/format';

interface BattlePanelProps {
  battle: Battle;
  onClose: () => void;
  onWatchReplay: () => void;
  onShare?: () => void;
}

const REF_TYPE_LABELS: Record<string, string> = {
  book: 'Books',
  film: 'Films',
  documentary: 'Documentaries',
  article: 'Articles',
};

const REF_TYPE_ORDER = ['book', 'film', 'documentary', 'article'];

function groupRefs(refs: Reference[]): Map<string, Reference[]> {
  const groups = new Map<string, Reference[]>();
  for (const type of REF_TYPE_ORDER) {
    const items = refs.filter((r) => r.type === type);
    if (items.length > 0) groups.set(type, items);
  }
  return groups;
}

// firstSentence pulls the first complete sentence out of a longer prose block.
// Used to surface a "stake" line that reads like a film opening: short,
// declarative, and visually distinct from the running summary below. Falls
// back to the whole string when no terminator is found.
function firstSentence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^[^.!?]*[.!?]/);
  if (!m) return trimmed;
  return m[0].trim();
}

// stakeLine builds the dossier's hero line. Preference order: a short
// summary, the first sentence of a longer summary, the first sentence of
// significance, then a synthetic "two sides at a place" fallback. Returns
// empty string if nothing usable is available, in which case the dossier
// silently drops the section rather than rendering an empty card.
function stakeLine(b: Battle): string {
  const summary = (b.summary || '').trim();
  if (summary && summary.length <= 180) return summary;
  if (summary) return firstSentence(summary);
  const sig = (b.significance || '').trim();
  if (sig) return firstSentence(sig);
  if (b.sides && b.sides.length >= 2 && b.war) {
    const names = b.sides.slice(0, 2).map((s) => s.name).filter(Boolean);
    if (names.length === 2) {
      return `${names[0]} meets ${names[1]} in the ${b.war}.`;
    }
  }
  return '';
}

// SectionHeading is the dossier's chapter mark. Tracked small caps in the
// era accent, with a thin underline hairline that suggests an editorial
// rule without committing to one. Reused at every section break so the
// dossier reads as a single typeset spread rather than a list of cards.
function SectionHeading({ theme, children }: { theme: { accent: string }; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3
        className="text-[10px] font-semibold uppercase tracking-[0.3em]"
        style={{ color: theme.accent }}
      >
        {children}
      </h3>
      <div
        className="mt-1.5 h-px"
        style={{
          width: 36,
          background: `linear-gradient(90deg, ${theme.accent}aa 0%, transparent 100%)`,
        }}
      />
    </div>
  );
}

export default function BattlePanel({ battle, onClose, onWatchReplay, onShare }: BattlePanelProps) {
  const color = ERA_COLORS[battle.era] || '#ffffff';
  const theme = themeForEra(battle.era);
  const [detail, setDetail] = useState<Battle>(battle);

  useEffect(() => {
    setDetail(battle);
    fetch(`/api/battles/${battle.id}`)
      .then((res) => res.json())
      .then(setDetail)
      .catch(() => {});
    // Warm the replay cache as soon as the dossier opens. Clicking "Watch
    // the battle" then hits the browser cache and the overlay opens with no
    // loading spinner, no perceptible delay.
    if (battle.hasReplay || battle.hasSchematic) {
      fetch(`/api/battles/${battle.id}/replay`).catch(() => {});
    }
  }, [battle]);

  const refs = detail.references || [];
  const groupedRefs = groupRefs(refs);
  const hasReplay = detail.hasReplay ?? battle.hasReplay;
  const hasSchematic = (detail.hasSchematic ?? battle.hasSchematic) && !hasReplay;
  const yearKnown = battle.year !== 0;
  const dateDisplay = formatBattleDate(battle.date, battle.year);
  const stake = stakeLine(detail);
  // Summary repeats if it's already shorter than the stake threshold (stakeLine
  // would have returned the whole summary verbatim). Suppress the dedicated
  // summary section in that case so the dossier doesn't read twice.
  const stakeReusesSummary = !!stake && !!detail.summary && stake.trim() === detail.summary.trim();

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] max-w-[90vw] z-30 bg-[#0f1019]/95 backdrop-blur-xl border-l border-slate-800 overflow-y-auto">
      {/* Sticky close button. Lives in a fixed-position layer rather than
          inside the scrolling body so it never disappears under a long
          dossier. Larger and higher-contrast than the previous version so
          the eye finds it the first time, every time. */}
      <button
        onClick={onClose}
        className="sticky top-3 ml-auto mr-3 mt-3 z-10 inline-flex items-center gap-1.5 h-9 pl-2.5 pr-3.5 rounded-full bg-white text-slate-900 shadow-[0_8px_18px_-8px_rgba(0,0,0,0.7)] hover:bg-slate-100 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1019]"
        aria-label="Close panel (Esc)"
        title="Close (Esc)"
        style={{ float: 'right' }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M1 1 L10 10 M10 1 L1 10" />
        </svg>
        <span className="text-[12px] font-semibold tracking-wide">Close</span>
      </button>
      <div className="p-6 pt-2 clear-both">

        {/* Era stamp: tracked small caps in the era accent. Sits above the
            hero title like a chapter mark. */}
        <div
          className="text-[11px] font-semibold uppercase tracking-[0.32em] mb-4"
          style={{ color: theme.accent }}
        >
          {theme.mood}
          {yearKnown && <span className="opacity-75"> · {formatYear(battle.year)}</span>}
        </div>

        {/* Hero title. Much larger than a standard panel heading so the
            dossier reads as the opening of a story, not a sidebar header.
            Era font (serif for antiquity through Napoleon, condensed sans
            for industrial onward) carries period feel without changing
            layout per battle. */}
        <h2
          className="text-white mb-3 tracking-tight"
          style={{
            fontFamily: theme.titleFont,
            fontWeight: 600,
            fontSize: '42px',
            lineHeight: 1.02,
            letterSpacing: '-0.01em',
          }}
        >
          {battle.name}
        </h2>

        {/* Accent rule under the hero so the title visually owns its own
            column. Subtle. Same gradient idea as the title card. */}
        <div
          className="mb-4 h-px"
          style={{
            width: 64,
            background: `linear-gradient(90deg, ${theme.accent} 0%, transparent 100%)`,
            opacity: 0.7,
          }}
        />

        {/* Aliases. Alternative names for the battle attributed to the
            belligerent or tradition that used them. Sharpsburg was the
            Confederate name for Antietam; the Field of Blackbirds was the
            Serbian name for Kosovo Polje. Drops silently when the curator
            has not entered any. */}
        {(detail.aliases ?? battle.aliases ?? []).length > 0 && (
          <div className="mb-4 -mt-1">
            <div className="text-[10px] uppercase tracking-[0.28em] text-slate-500 mb-1.5">
              Also known as
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
              {(detail.aliases ?? battle.aliases ?? []).map((a, i) => (
                <li
                  key={`${i}-${a.name}`}
                  className="text-[12.5px] leading-snug"
                  style={{ fontFamily: theme.titleFont, color: 'rgba(226,232,240,0.9)' }}
                >
                  <span style={{ fontStyle: 'italic' }}>{a.name}</span>
                  {a.by && (
                    <span className="text-slate-500 not-italic ml-1.5 text-[10.5px] tracking-wide">
                      · {a.by}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Stake line: the one-sentence punch that frames why this battle
            matters. Drops cleanly when no usable prose is available. */}
        {stake && (
          <p
            className="mb-5 text-[16px] leading-[1.55] text-slate-200/95"
            style={{ fontFamily: theme.titleFont, fontStyle: 'italic' }}
          >
            {stake}
          </p>
        )}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {battle.era && (
            <span
              className="inline-block px-3 py-1 rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {ERA_LABELS[battle.era] || battle.era}
            </span>
          )}
          {(() => {
            const tier = detail.tier ?? battle.tier ?? (detail.verified ? 'documented' : 'indexed');
            const tone =
              tier === 'reconstructed'
                ? 'bg-blue-500/15 text-blue-300 border-blue-500/25'
                : tier === 'documented'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/25';
            return (
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border ${tone}`}
                title={TIER_DESCRIPTIONS[tier]}
              >
                {TIER_LABELS[tier]}
              </span>
            );
          })()}
        </div>

        {/* Compact metadata strip: date + war + outbound links. Lives under the
            hero so the dossier opens cinematically and the chrome stays out
            of the way until the reader wants it. */}
        <p className="text-slate-400 text-sm mb-1">
          {yearKnown ? dateDisplay : 'Date unknown'}
        </p>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {battle.war && <span className="text-slate-500 text-sm">{battle.war}</span>}
          <a
            href={`https://earth.google.com/web/@${battle.lat},${battle.lng},0a,30000d,35y,0h,0t,0r`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
          >
            Google Earth
          </a>
          {(detail.wikipediaTitle || battle.wikipediaTitle) && (
            <a
              href={`https://en.wikipedia.org/wiki/${encodeURIComponent((detail.wikipediaTitle || battle.wikipediaTitle || '').replace(/ /g, '_'))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/15 text-sky-300 border border-sky-500/25 hover:bg-sky-500/25 transition-colors"
              title="Open this battle on Wikipedia to cross-check"
            >
              Wikipedia
            </a>
          )}
          {onShare && (
            <button
              onClick={onShare}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700/40 text-slate-300 border border-slate-600/40 hover:bg-slate-700/60 transition-colors"
              title="Copy share link"
            >
              Share
            </button>
          )}
        </div>

        {(() => {
          const tier = detail.tier ?? battle.tier ?? (detail.verified ? 'documented' : 'indexed');
          if (tier === 'indexed') {
            return (
              <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/90 leading-relaxed">
                <span className="font-semibold">Indexed record.</span> Imported from Wikidata with
                only a name and location. We have not verified sides, commanders, or casualties for
                this battle yet. Open Wikipedia for the actual story.
              </div>
            );
          }
          if (tier === 'documented' && !detail.verified) {
            return (
              <div className="mb-4 rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2 text-[11px] text-slate-400 leading-relaxed">
                <span className="font-semibold text-slate-300">Imported from Wikipedia.</span> Sides
                and casualty figures come from the Wikipedia infobox and have not yet been
                hand-checked. Cross-check with the references if accuracy matters.
              </div>
            );
          }
          return null;
        })()}

        {(hasReplay || hasSchematic) && (
          <button
            onClick={onWatchReplay}
            className={`w-full mb-5 group relative overflow-hidden rounded-xl border px-4 py-3 text-left transition-all ${
              hasReplay
                ? 'bg-gradient-to-r from-blue-500/20 via-blue-500/15 to-blue-500/10 border-blue-500/40 hover:from-blue-500/30 hover:via-blue-500/25 hover:to-blue-500/15'
                : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/60'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${
                hasReplay ? 'bg-blue-500/30 text-blue-200' : 'bg-slate-700 text-slate-300'
              }`}>▶</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">
                  {hasReplay ? 'Watch the battle' : 'Open schematic replay'}
                </div>
                <div className={`text-[11px] ${hasReplay ? 'text-blue-300/80' : 'text-slate-500'}`}>
                  {hasReplay
                    ? 'Hand-crafted, phase-by-phase tactical replay'
                    : 'Auto-generated from sides, commanders, and outcome'}
                </div>
              </div>
            </div>
          </button>
        )}

        {/* Order of battle. Side cards keep sans-serif for data density
            (tabular numbers, commander names, casualty figures) but the
            headline is reset as serif so the section opens cinematically
            and the cards land underneath as a clean ledger. */}
        <SectionHeading theme={theme}>Order of battle</SectionHeading>
        <div className="space-y-2.5 mb-7">
          {(detail.sides || []).map((side, i) => {
            const isVictor = side.name === detail.victor;
            return (
              <div
                key={i}
                className="rounded-lg p-4"
                style={{
                  backgroundColor: isVictor ? `${color}10` : 'rgba(30,32,44,0.8)',
                  border: isVictor ? `1px solid ${color}3a` : '1px solid rgba(51,55,76,0.5)',
                }}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <span className="font-semibold text-white text-[14px]">{side.name}</span>
                  {isVictor && (
                    <span
                      className="text-[9px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: `${color}26`, color }}
                    >
                      Victor
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-3 text-[11.5px]">
                  <div>
                    <dt className="text-slate-500 mb-0.5 text-[10px] uppercase tracking-[0.14em]">Commander</dt>
                    <dd className="text-slate-200 leading-snug">{side.commander || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-0.5 text-[10px] uppercase tracking-[0.14em]">Strength</dt>
                    <dd className="text-slate-200 leading-snug tabular-nums">{side.strength || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-0.5 text-[10px] uppercase tracking-[0.14em]">Casualties</dt>
                    <dd className="text-slate-200 leading-snug tabular-nums">{side.casualties || 'Unknown'}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>

        {detail.summary && !stakeReusesSummary && (
          <div className="mb-7">
            <SectionHeading theme={theme}>Summary</SectionHeading>
            <p
              className="text-[15px] leading-[1.65] text-slate-200/90"
              style={{ fontFamily: theme.titleFont }}
            >
              {detail.summary}
            </p>
          </div>
        )}

        {detail.significance && (
          <div className="mb-7">
            <SectionHeading theme={theme}>Significance</SectionHeading>
            <p
              className="text-[15px] leading-[1.65] text-slate-200/90"
              style={{ fontFamily: theme.titleFont }}
            >
              {detail.significance}
            </p>
          </div>
        )}

        {!detail.summary && !detail.significance && (
          <div className="mb-6 rounded-lg border border-slate-800/60 bg-slate-900/40 px-4 py-5 text-center">
            <p
              className="text-[13px] text-slate-500 italic"
              style={{ fontFamily: theme.titleFont }}
            >
              Detailed information not yet available for this battle.
            </p>
          </div>
        )}

        {groupedRefs.size > 0 && (
          <div className="border-t border-slate-800/80 pt-6">
            <SectionHeading theme={theme}>References</SectionHeading>
            {Array.from(groupedRefs.entries()).map(([type, items]) => (
              <div key={type} className="mb-4">
                <h4 className="text-[10px] text-slate-500 font-semibold uppercase tracking-[0.18em] mb-2">
                  {REF_TYPE_LABELS[type] || type}
                </h4>
                <div className="space-y-2">
                  {items.map((ref, i) => (
                    <div key={i} className="rounded-lg bg-slate-800/40 border border-slate-700/30 p-3 transition-colors hover:border-slate-600/50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div
                            className="text-[14px] text-white leading-snug"
                            style={{ fontFamily: theme.titleFont, fontWeight: 600 }}
                          >
                            {ref.url ? (
                              <a
                                href={ref.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline transition-colors"
                                style={{ color: '#fff' }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = theme.accent)}
                                onMouseLeave={(e) => (e.currentTarget.style.color = '#fff')}
                              >
                                {ref.title}
                              </a>
                            ) : (
                              ref.title
                            )}
                          </div>
                          {ref.author && (
                            <div className="text-[11.5px] text-slate-400 mt-0.5">{ref.author}</div>
                          )}
                        </div>
                        {ref.year !== undefined && ref.year > 0 && (
                          <span className="text-[10px] text-slate-500 font-mono flex-shrink-0 tabular-nums pt-0.5">
                            {ref.year}
                          </span>
                        )}
                      </div>
                      {ref.note && (
                        <div
                          className="text-[12px] text-slate-400/90 mt-1.5 leading-relaxed italic"
                          style={{ fontFamily: theme.titleFont }}
                        >
                          {ref.note}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
