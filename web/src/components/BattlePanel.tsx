import { useEffect, useState } from 'react';
import type { Battle, Reference } from '../types/battle';
import { ERA_COLORS, ERA_LABELS, TIER_LABELS, TIER_DESCRIPTIONS } from '../types/battle';
import { themeForEra } from '../theme/era';

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

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BC` : `${year}`;
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
  }, [battle]);

  const refs = detail.references || [];
  const groupedRefs = groupRefs(refs);
  const hasReplay = detail.hasReplay ?? battle.hasReplay;
  const hasSchematic = (detail.hasSchematic ?? battle.hasSchematic) && !hasReplay;
  const showDate = battle.date && battle.date !== '0';
  const yearKnown = battle.year !== 0;
  const stake = stakeLine(detail);
  // Summary repeats if it's already shorter than the stake threshold (stakeLine
  // would have returned the whole summary verbatim). Suppress the dedicated
  // summary section in that case so the dossier doesn't read twice.
  const stakeReusesSummary = !!stake && !!detail.summary && stake.trim() === detail.summary.trim();

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] max-w-[90vw] z-30 bg-[#0f1019]/95 backdrop-blur-xl border-l border-slate-800 overflow-y-auto">
      <div className="p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
          aria-label="Close panel"
        >
          &times;
        </button>

        {/* Era stamp: a single line of "Mood · Year" set in tracked small caps,
            colored by the era. Reads as a movie title card opener. */}
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.28em] mb-3"
          style={{ color: theme.accent }}
        >
          {theme.mood}
          {yearKnown && <span className="opacity-70"> · {formatYear(battle.year)}</span>}
        </div>

        {/* Hero title in the era's display font. Serif for antiquity through
            Napoleon, condensed sans for industrial onward. */}
        <h2
          className="text-[28px] leading-[1.1] text-white mb-2 tracking-tight"
          style={{ fontFamily: theme.titleFont, fontWeight: 600 }}
        >
          {battle.name}
        </h2>

        {/* Stake line: the one-sentence punch that frames why this battle
            matters. Drops cleanly when no usable prose is available. */}
        {stake && (
          <p
            className="mb-4 text-[15px] leading-relaxed text-slate-200/95"
            style={{ fontFamily: theme.titleFont }}
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
          {showDate ? battle.date : yearKnown ? formatYear(battle.year) : 'Date unknown'}
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

        {battle.battleType && (
          <div className="mb-5">
            <div className="text-center">
              <span className="inline-block px-3 py-1 rounded-full text-sm bg-slate-800 text-slate-300 capitalize">
                {battle.battleType}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-3 mb-6">
          {(detail.sides || []).map((side, i) => {
            const isVictor = side.name === detail.victor;
            return (
              <div
                key={i}
                className="rounded-lg p-4"
                style={{
                  backgroundColor: isVictor ? `${color}10` : 'rgba(30,32,44,0.8)',
                  border: isVictor ? `1px solid ${color}30` : '1px solid rgba(51,55,76,0.5)',
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-white text-sm">{side.name}</span>
                  {isVictor && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${color}25`, color }}>
                      Victor
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500 mb-0.5">Commander</div>
                    <div className="text-slate-300">{side.commander || '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-0.5">Strength</div>
                    <div className="text-slate-300">{side.strength || '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-0.5">Casualties</div>
                    <div className="text-slate-300">{side.casualties || '—'}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {detail.summary && !stakeReusesSummary && (
          <div className="mb-5">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Summary</h3>
            <p className="text-slate-300 text-sm leading-relaxed">{detail.summary}</p>
          </div>
        )}

        {detail.significance && (
          <div className="mb-5">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Significance</h3>
            <p className="text-slate-300 text-sm leading-relaxed">{detail.significance}</p>
          </div>
        )}

        {!detail.summary && !detail.significance && (
          <div className="mb-5 text-center py-4">
            <p className="text-slate-500 text-sm">Detailed information not yet available for this battle.</p>
          </div>
        )}

        {groupedRefs.size > 0 && (
          <div className="border-t border-slate-800 pt-5">
            <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">References</h3>
            {Array.from(groupedRefs.entries()).map(([type, items]) => (
              <div key={type} className="mb-4">
                <h4 className="text-[11px] text-slate-400 font-semibold mb-2">
                  {REF_TYPE_LABELS[type] || type}
                </h4>
                <div className="space-y-2">
                  {items.map((ref, i) => (
                    <div key={i} className="rounded-lg bg-slate-800/40 border border-slate-700/30 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm text-white font-medium leading-tight">
                            {ref.url ? (
                              <a href={ref.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">
                                {ref.title}
                              </a>
                            ) : (
                              ref.title
                            )}
                          </div>
                          {ref.author && (
                            <div className="text-xs text-slate-400 mt-0.5">{ref.author}</div>
                          )}
                        </div>
                        {ref.year !== undefined && ref.year > 0 && (
                          <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">{ref.year}</span>
                        )}
                      </div>
                      {ref.note && (
                        <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">{ref.note}</div>
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
