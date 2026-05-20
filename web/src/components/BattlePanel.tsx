import { useEffect, useState } from 'react';
import type { Battle, Reference } from '../types/battle';
import { ERA_COLORS, ERA_LABELS, TIER_LABELS, TIER_DESCRIPTIONS, regionalEraContext } from '../types/battle';
import { themeForEra } from '../theme/era';
import { formatYear, formatBattleDate, cleanCasualtyText, cleanProseText } from '../lib/format';
import CloseButton from './CloseButton';
import { resolveMediaFor } from '../data/media';
import type { MediaEntry } from '../data/media';

const KIND_LABEL: Record<MediaEntry['kind'], string> = {
  film: 'Film',
  series: 'Series',
  book: 'Book',
  documentary: 'Doc',
};

interface BattlePanelProps {
  battle: Battle;
  onClose: () => void;
  onWatchReplay: () => void;
  onShare?: () => void;
  // onCommanderClick lifts a commander name out of the dossier and into
  // App-level state so the user can pivot to "all battles by this person"
  // from a single click on the name in the order-of-battle.
  onCommanderClick?: (name: string) => void;
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

// parseLargestNumber pulls the biggest comma-separated integer from a
// freeform casualty string. Caps at 10M to skip page numbers and stray
// reference markers. Returns 0 when nothing parses cleanly.
function parseLargestNumber(s: string | undefined): number {
  if (!s) return 0;
  const matches = s.replace(/,/g, '').match(/\d+/g);
  if (!matches) return 0;
  let best = 0;
  for (const m of matches) {
    const n = parseInt(m, 10);
    if (n > best && n <= 10_000_000) best = n;
  }
  return best;
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

// splitTopCommander extracts the senior commander from a freeform commander
// string. Curators write these as comma-separated, top-billed first, with
// parenthetical role notes attached to the name (e.g.
// "Mikhail Kutuzov (commander-in-chief), Pyotr Bagration (2nd Army)").
// We strip the parenthetical and return just the top-billed name.
function splitTopCommander(s: string | undefined): string {
  if (!s) return '';
  const trimmed = s.trim();
  if (!trimmed) return '';
  const head = trimmed.split(',')[0].trim();
  const paren = head.indexOf('(');
  return (paren > 0 ? head.slice(0, paren).trim() : head);
}

export default function BattlePanel({ battle, onClose, onWatchReplay, onShare, onCommanderClick }: BattlePanelProps) {
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
      {/* Sticky close mark. The shared CloseButton component anchors the
          exit affordance in the same place with the same style as every
          other dismissable surface in the app, so the user always knows
          how to leave whatever they opened. */}
      <div className="sticky top-3 z-10 ml-auto mr-3 mt-3" style={{ float: 'right' }}>
        <CloseButton onClick={onClose} label="Close panel (Esc)" />
      </div>
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

        {/* Facts grid. Replaces the previous pill+date+war+link soup with a
            clean label/value table so every battle renders the same shape
            regardless of which fields happen to be populated. Empty fields
            render as the slate "—" placeholder rather than collapsing the
            row, keeping the dossier rhythm identical across battles. */}
        {(() => {
          const tier = detail.tier ?? battle.tier ?? (detail.verified ? 'documented' : 'indexed');
          const tierColor =
            tier === 'reconstructed' ? '#60a5fa' : tier === 'documented' ? '#34d399' : '#fbbf24';
          const rows: Array<[string, React.ReactNode]> = [
            ['Date', yearKnown ? dateDisplay : '—'],
            ['Era', (() => {
              const eraLabel = ERA_LABELS[battle.era] || battle.era || '—';
              const local = regionalEraContext(battle.era, battle.lat, battle.lng);
              return (
                <span style={{ color }}>
                  {eraLabel}
                  {local && (
                    <span className="text-slate-500 ml-1.5 text-[11.5px] not-italic font-normal">
                      · {local}
                    </span>
                  )}
                </span>
              );
            })()],
            ['War', battle.war || '—'],
            ['Type', battle.battleType
              ? battle.battleType.charAt(0).toUpperCase() + battle.battleType.slice(1)
              : '—'],
            ['Tier', (
              <span
                style={{ color: tierColor }}
                title={TIER_DESCRIPTIONS[tier]}
              >
                {TIER_LABELS[tier]}
              </span>
            )],
          ];
          return (
            <dl
              className="mb-5 rounded-xl border border-slate-800/70 bg-slate-900/30 divide-y divide-slate-800/50"
              style={{ overflow: 'hidden' }}
            >
              {rows.map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline gap-3 px-4 py-2"
                >
                  <dt className="text-[10px] uppercase tracking-[0.22em] text-slate-500 w-14 flex-shrink-0">
                    {k}
                  </dt>
                  <dd className="text-[13px] text-slate-200 leading-snug flex-1 min-w-0">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          );
        })()}

        {/* Actions row: one unified strip of outbound links and share. All
            buttons share the same shape, height, and rest-state styling so
            the eye reads them as a toolbar rather than three different
            kinds of object. */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <a
            href={`https://earth.google.com/web/@${battle.lat},${battle.lng},0a,30000d,35y,0h,0t,0r`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-8 px-3 rounded-md text-[11px] font-medium bg-slate-800/60 text-slate-200 border border-slate-700/60 hover:bg-slate-700/70 transition-colors"
            title="Open the battlefield in Google Earth"
          >
            Google Earth
          </a>
          {(detail.wikipediaTitle || battle.wikipediaTitle) && (
            <a
              href={`https://en.wikipedia.org/wiki/${encodeURIComponent((detail.wikipediaTitle || battle.wikipediaTitle || '').replace(/ /g, '_'))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-8 px-3 rounded-md text-[11px] font-medium bg-slate-800/60 text-slate-200 border border-slate-700/60 hover:bg-slate-700/70 transition-colors"
              title="Open this battle on Wikipedia"
            >
              Wikipedia
            </a>
          )}
          {onShare && (
            <button
              onClick={onShare}
              className="inline-flex items-center justify-center h-8 px-3 rounded-md text-[11px] font-medium bg-slate-800/60 text-slate-200 border border-slate-700/60 hover:bg-slate-700/70 transition-colors"
              title="Copy share link to clipboard"
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
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                hasReplay ? 'bg-blue-500/30 text-blue-200 ring-1 ring-blue-300/40' : 'bg-slate-700 text-slate-200 ring-1 ring-slate-600/60'
              }`}>
                <svg width="13" height="15" viewBox="0 0 13 15" fill="currentColor" className="ml-0.5">
                  <path d="M0.5 1.07v12.86a.5.5 0 0 0 .77.42l10.5-6.43a.5.5 0 0 0 0-.84L1.27.65A.5.5 0 0 0 .5 1.07z" />
                </svg>
              </div>
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
            and the cards land underneath as a clean ledger. A thin
            casualty bar runs along the bottom of each card, scaled against
            the bloodiest side, so the relative human cost is visible at
            a glance without re-reading the prose. */}
        <SectionHeading theme={theme}>Order of battle</SectionHeading>
        {(() => {
          const sides = detail.sides || [];
          const maxCas = sides.reduce(
            (m, s) => Math.max(m, parseLargestNumber(s.casualties)),
            0,
          );
          return (
            <div className="space-y-2.5 mb-7">
              {sides.map((side, i) => {
                const isVictor = side.name === detail.victor;
                const cas = parseLargestNumber(side.casualties);
                const pct = maxCas > 0 && cas > 0
                  ? Math.max(6, Math.min(100, (cas / maxCas) * 100))
                  : 0;
                return (
                  <div
                    key={i}
                    className="rounded-lg p-4"
                    style={{
                      backgroundColor: isVictor ? `${color}10` : 'rgba(30,32,44,0.8)',
                      border: isVictor ? `1px solid ${color}3a` : '1px solid rgba(51,55,76,0.5)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2.5 gap-2">
                      <span className="font-semibold text-white text-[14px] min-w-0">{side.name}</span>
                      {isVictor && (
                        <span
                          className="text-[9px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                          style={{ backgroundColor: `${color}26`, color }}
                        >
                          Victor
                        </span>
                      )}
                    </div>
                    <dl className="grid grid-cols-3 gap-3 text-[11.5px]">
                      <div>
                        <dt className="text-slate-500 mb-0.5 text-[10px] uppercase tracking-[0.14em]">Commander</dt>
                        <dd className="text-slate-200 leading-snug">
                          {(() => {
                            const top = splitTopCommander(side.commander);
                            if (!side.commander) return 'Unknown';
                            const rest = side.commander.replace(top, '').replace(/^\s*,\s*/, '');
                            return (
                              <>
                                {top && onCommanderClick ? (
                                  <button
                                    type="button"
                                    onClick={() => onCommanderClick(top)}
                                    className="text-left hover:underline transition-colors"
                                    style={{ color: '#e2e8f0' }}
                                    onMouseEnter={(e) => (e.currentTarget.style.color = color)}
                                    onMouseLeave={(e) => (e.currentTarget.style.color = '#e2e8f0')}
                                    title={`See every battle attributed to ${top}`}
                                  >
                                    {top}
                                  </button>
                                ) : (
                                  <span>{top || side.commander}</span>
                                )}
                                {rest && (
                                  <span className="text-slate-400">
                                    {top ? ', ' : ''}
                                    {rest}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500 mb-0.5 text-[10px] uppercase tracking-[0.14em]">Strength</dt>
                        <dd className="text-slate-200 leading-snug tabular-nums">{side.strength || 'Unknown'}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500 mb-0.5 text-[10px] uppercase tracking-[0.14em]">Casualties</dt>
                        <dd
                          className="leading-snug tabular-nums"
                          style={{ color: isVictor ? color : '#cbd5e1' }}
                        >
                          {cleanCasualtyText(side.casualties) || 'Unknown'}
                        </dd>
                      </div>
                    </dl>
                    {pct > 0 && (
                      <div
                        className="mt-3 h-[3px] rounded-full overflow-hidden"
                        style={{ background: 'rgba(148,163,184,0.12)' }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: isVictor
                              ? `linear-gradient(90deg, ${color}66, ${color})`
                              : 'linear-gradient(90deg, rgba(148,163,184,0.4), rgba(148,163,184,0.85))',
                            boxShadow: isVictor ? `0 0 10px ${color}66` : 'none',
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {detail.summary && !stakeReusesSummary && (
          <div className="mb-7">
            <SectionHeading theme={theme}>What happened</SectionHeading>
            <p
              className="text-[15px] leading-[1.65] text-slate-200/90"
              style={{ fontFamily: theme.titleFont }}
            >
              {cleanProseText(detail.summary)}
            </p>
          </div>
        )}

        {detail.significance && (
          <div className="mb-7">
            <SectionHeading theme={theme}>Why it mattered</SectionHeading>
            <p
              className="text-[15px] leading-[1.65] text-slate-200/90"
              style={{ fontFamily: theme.titleFont }}
            >
              {cleanProseText(detail.significance)}
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

        {(() => {
          const media = resolveMediaFor({ war: battle.war, battleId: battle.id, max: 8 });
          if (media.length === 0) return null;
          return (
            <div className="border-t border-slate-800/80 pt-6 mb-6">
              <SectionHeading theme={theme}>Watch &amp; read</SectionHeading>
              <ul className="space-y-3">
                {media.map((m, i) => (
                  <li key={`${m.title}-${m.year}-${i}`}>
                    {m.url ? (
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg bg-slate-800/40 border border-slate-700/30 p-3 hover:border-slate-600/60 transition-colors"
                      >
                        <MediaRow m={m} accent={theme.accent} />
                      </a>
                    ) : (
                      <div className="rounded-lg bg-slate-800/40 border border-slate-700/30 p-3">
                        <MediaRow m={m} accent={theme.accent} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        {groupedRefs.size > 0 && (
          <div className="border-t border-slate-800/80 pt-6">
            <SectionHeading theme={theme}>Further reading</SectionHeading>
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

// MediaRow renders one Watch & Read entry inside the BattlePanel dossier.
function MediaRow({ m, accent }: { m: MediaEntry; accent: string }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="flex items-baseline gap-2 min-w-0 flex-1">
          <span className="text-[14px] text-white font-semibold leading-snug truncate" style={{ fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" }}>
            {m.title}
          </span>
          <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0">{m.year}</span>
        </div>
        <span
          className="text-[9px] uppercase tracking-[0.20em] font-semibold flex-shrink-0"
          style={{ color: accent }}
        >
          {KIND_LABEL[m.kind]}
        </span>
      </div>
      <div className="text-[11.5px] text-slate-400 leading-snug">
        <span className="text-slate-300">{m.creator}</span> · {m.blurb}
      </div>
    </>
  );
}
