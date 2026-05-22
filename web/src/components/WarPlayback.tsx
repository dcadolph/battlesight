import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS } from '../types/battle';
import { themeForYear } from '../theme/era';
import { canonBelligerentKey, canonBelligerentLabel } from '../lib/country';
import { findSnapshot, buildCountryColorMap, TERRITORY } from '../data/territory-snapshots';
import WarSummaryCard from './WarSummaryCard';
import { resolveMediaFor } from '../data/media';
import type { MediaEntry } from '../data/media';
import WarCinematicOverlay from './WarCinematicOverlay';
import CloseButton from './CloseButton';
import { usePauseOnHidden } from '../hooks/usePauseOnHidden';
import { formatYear, formatBattleDate } from '../lib/format';

interface WarPlaybackProps {
  onBattleFocus: (battle: Battle) => void;
  onBattlesLoaded: (battles: Battle[] | null) => void;
  onClose: () => void;
  // onWarSelected fires whenever the user picks a war from the war list. App
  // uses it to clear any open battle detail panel and any single-battle
  // isolation so the user can take in every battle of the chosen war on the
  // globe at once before clicking into one.
  onWarSelected?: (warName: string) => void;
  // onWarCountries fires alongside onWarSelected when the selected war's
  // top participating countries are known. App pipes the list into BattleGlobe
  // so it can shade those countries on the map and give the user a sense of
  // where the war was actually fought, beyond the pillar markers.
  onWarCountries?: (countries: string[]) => void;
  // onPlayReplay is fired in cinematic mode when the auto-step lands on a
  // battle that has a hand-crafted phase replay. App opens the replay
  // overlay. WarPlayback continues its own timer and fires onCloseReplay
  // when ready to advance to the next battle.
  onPlayReplay?: (battle: Battle) => void;
  onCloseReplay?: () => void;
  // onWarTerritory emits the per-country control map for the year of the
  // currently-focused battle. App threads it into BattleGlobe so the
  // globe re-shades as the war playhead crosses a snapshot boundary
  // (Axis red advances across Europe in 1940-42, recedes in 1943-45).
  // factions is the active owner-key list for the snapshot, in display
  // order, so App can render a faction legend mapping color to label.
  onWarTerritory?: (
    colors: Record<string, string> | null,
    label: string | null,
    factions: string[],
    anchors: Array<{ faction: string; anchor: string }>,
  ) => void;
  // initialWar optionally pre-selects a war on mount so an external action
  // (search-bar war click, deep link, etc.) can open WarPlayback already
  // pointing at the war the user named.
  initialWar?: string;
  // cinematicAdvanceTick increments when the active BattleReplay reports
  // its outro pause has elapsed. WarPlayback uses it to skip its own dwell
  // timer and advance immediately, which keeps long hand-crafted replays
  // from getting trapped on the outro card when the dwell budget is
  // shorter than the actual phase total.
  cinematicAdvanceTick?: number;
  // cinematicPrevTick increments when the user clicks "Previous battle"
  // on the cinematic outro card. WarPlayback rewinds the group index by
  // one and re-focuses that battle.
  cinematicPrevTick?: number;
}

interface WarCount {
  name: string;
  count: number;
  minYear: number;
  casualties: number;
  // humanDeaths is the curated total including civilians, famine, genocide,
  // and disease. Zero when the war has no curated override. Preferred over
  // casualties for display when present.
  humanDeaths?: number;
  parent?: string;
  rolledCount: number;
  rolledCasualties: number;
  // rolledHumanDeaths is the curated-first total summed across the war and
  // every descendant theater / campaign, falling back to descendant battle
  // sums where no curated number exists. Zero when nothing rolled up.
  rolledHumanDeaths?: number;
  countries?: string[];
}

// preferredTotalForWar returns the war's best-available casualty figure.
// Order: rolledHumanDeaths (curated + rolled), humanDeaths (curated),
// rolledCasualties (battle sum + rolled), casualties (battle sum). The
// returned number powers the war list's bloodiest-sort key and the value
// shown next to each row.
function preferredTotalForWar(w: WarCount): number {
  return w.rolledHumanDeaths || w.humanDeaths || w.rolledCasualties || w.casualties || 0;
}

// formatCasualtyCompact renders large casualty totals in a tight slot: 75M
// for 75,000,000, 4.5M for 4.5 million, 750k for hundreds of thousands.
// Used by the war-list value column where horizontal space is at a premium.
function formatCasualtyCompact(n: number): string {
  if (n <= 0) return '';
  if (n >= 10_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1000).toFixed(0)}k`;
}

type WarSort = 'casualties' | 'battles' | 'alpha' | 'chrono' | 'country';

// MEDIA_ICON renders a small kind-specific glyph next to each media row.
function MediaKindIcon({ kind }: { kind: MediaEntry['kind'] }) {
  if (kind === 'film') {
    return (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <path d="M5 3v10M11 3v10M2 6h3M2 10h3M11 6h3M11 10h3" />
      </svg>
    );
  }
  if (kind === 'series') {
    return (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1.5" y="3.5" width="13" height="8" rx="1" />
        <path d="M6 13.5h4" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'documentary') {
    return (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="8" cy="8" r="6.2" />
        <path d="M2 8h12M8 2c2.5 2.5 2.5 9.5 0 12M8 2c-2.5 2.5-2.5 9.5 0 12" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 2.5h7a2 2 0 0 1 2 2v9l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5V4.5a2 2 0 0 1 2-2z" strokeLinejoin="round" />
    </svg>
  );
}

// MediaShelf renders a "Watch & Read" group of curated film, series, book,
// and documentary links keyed to the current battle and its war.
function MediaShelf({ warName, battleId }: { warName: string; battleId?: string }) {
  const items = resolveMediaFor({ war: warName, battleId, max: 8 });
  if (items.length === 0) return null;
  const kindLabel: Record<MediaEntry['kind'], string> = {
    film: 'Film',
    series: 'Series',
    book: 'Book',
    documentary: 'Doc',
  };
  return (
    <div className="mt-3 rounded-xl border border-slate-800/60 bg-slate-900/30 px-4 py-3.5">
      <div className="flex items-baseline justify-between mb-2.5">
        <div className="text-[9px] font-semibold uppercase tracking-[0.32em] text-amber-300/80">
          Watch &amp; Read
        </div>
        <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">
          {items.length} pick{items.length === 1 ? '' : 's'}
        </div>
      </div>
      <ul className="space-y-2.5">
        {items.map((m, i) => {
          const wrapper = (children: React.ReactNode) =>
            m.url ? (
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="block hover:bg-white/[0.025] -mx-1.5 px-1.5 py-0.5 rounded transition-colors"
              >
                {children}
              </a>
            ) : (
              <div className="px-1.5 py-0.5">{children}</div>
            );
          return (
            <li key={`${m.title}-${m.year}-${i}`} className="text-[12px] leading-relaxed">
              {wrapper(
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-[16px] h-[16px] rounded text-slate-300/85" aria-hidden="true">
                      <MediaKindIcon kind={m.kind} />
                    </span>
                    <span className="text-slate-100 font-semibold">{m.title}</span>
                    <span className="text-slate-500 text-[10.5px] flex-shrink-0">{m.year}</span>
                    <span className="ml-auto text-[8.5px] uppercase tracking-[0.22em] text-slate-500 flex-shrink-0">
                      {kindLabel[m.kind]}
                    </span>
                  </div>
                  <div className="ml-[24px] text-[11px] text-slate-400 leading-snug">
                    {m.creator} — {m.blurb}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface BattleGroup {
  battles: Battle[];
  year: number;
  concurrent: boolean;
}


function groupConcurrentBattles(battles: Battle[]): BattleGroup[] {
  if (battles.length === 0) return [];
  const groups: BattleGroup[] = [];
  let currentGroup: Battle[] = [battles[0]];
  for (let i = 1; i < battles.length; i++) {
    if (battles[i].year === battles[i - 1].year && battles[i].date === battles[i - 1].date) {
      currentGroup.push(battles[i]);
    } else {
      groups.push({ battles: currentGroup, year: currentGroup[0].year, concurrent: currentGroup.length > 1 });
      currentGroup = [battles[i]];
    }
  }
  groups.push({ battles: currentGroup, year: currentGroup[0].year, concurrent: currentGroup.length > 1 });
  return groups;
}

export default function WarPlayback({ onBattleFocus, onBattlesLoaded, onClose, onWarSelected, onWarCountries, onPlayReplay, onCloseReplay, onWarTerritory, initialWar, cinematicAdvanceTick = 0, cinematicPrevTick = 0 }: WarPlaybackProps) {
  const [wars, setWars] = useState<WarCount[]>([]);
  const [warSearch, setWarSearch] = useState('');
  const [warSort, setWarSort] = useState<WarSort>('casualties');
  const [selectedWar, setSelectedWar] = useState(initialWar || '');
  const [battles, setBattles] = useState<Battle[]>([]);
  const [battlesLoading, setBattlesLoading] = useState(false);
  const [groupIndex, setGroupIndex] = useState(0);
  const [subIndex, setSubIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  // groups is derived from (battles, cinematic). In cinematic mode we
  // narrow to "cinematic-grade" entries (curated/verified or reconstructed)
  // so the campaign sweep does not open on a POW-camp riot or a Polish
  // micro-skirmish ahead of Westerplatte. Step-through (cinematic off)
  // still surfaces the full chronological list. Falls back to the full
  // list when the filter would leave fewer than 5 entries, so smaller wars
  // without a deep curation pass still have a watchable cinematic.
  const groups = useMemo<BattleGroup[]>(() => {
    if (battles.length === 0) return [];
    if (!cinematic) return groupConcurrentBattles(battles);
    // Cinematic playlist composition:
    //   1. ALL hand-crafted phase replays (get the full deep-dive treatment).
    //   2. ALL schematic-eligible battles (have sides data, get the short
    //      auto-replay).
    //   3. Up to 80 long-tail tooltip-only battles, sampled by even spacing
    //      across the war's timeline so the user sees movement through the
    //      whole war rather than just the 24-battle marquee highlight reel.
    // Result: WW2 goes from 24 cinematic battles to ~120-180 (still under an
    // hour of run time given short dwells on the schematic + tooltip tiers).
    const replays = battles.filter((b) => b.hasReplay);
    const schematics = battles.filter((b) => !b.hasReplay && b.hasSchematic);
    const tooltipOnly = battles.filter((b) => !b.hasReplay && !b.hasSchematic);
    // Cap each tier so even WW2 (~600 schematic battles) stays under an
    // hour of runtime. Sampling is by even chronological spacing so the
    // cinematic walks the whole war rather than clustering at the start.
    function sampleEvenly<T>(arr: T[], cap: number): T[] {
      if (arr.length <= cap) return arr;
      const step = arr.length / cap;
      const out: T[] = [];
      for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]);
      return out;
    }
    // Caps tuned so the heaviest case (WW2) stays around 50 min total at
    // the new 25-second schematic dwell. Increasing these further makes the
    // run too long for a single watch session.
    const sampledSchematics = sampleEvenly(schematics, 60);
    const sampledTooltips = sampleEvenly(tooltipOnly, 40);
    // Merge + re-sort chronologically so the cinematic walks the timeline.
    const merged = [...replays, ...sampledSchematics, ...sampledTooltips].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return (a.date || '').localeCompare(b.date || '');
    });
    return groupConcurrentBattles(merged.length >= 3 ? merged : battles);
  }, [battles, cinematic]);
  const [speed, setSpeed] = useState(4000);
  const [detail, setDetail] = useState<Battle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [warSummaryLoading, setWarSummaryLoading] = useState(false);
  // initialPaneLoaded is set true once we've successfully loaded the FIRST
  // (battles list + battle detail + war summary) round for this war. It
  // suppresses re-showing the full-pane loading on subsequent battle hops
  // — those finish in ~50-200ms and don't need a heavy overlay.
  const [initialPaneLoaded, setInitialPaneLoaded] = useState(false);
  // cinematicStage drives the full-screen war overlay: an opening title
  // card before the first battle plays, the playthrough itself, then a
  // closing aftermath card. The existing per-battle playback loop runs
  // unchanged under the 'playing' stage; the overlay is purely additive.
  const [cinematicStage, setCinematicStage] = useState<'none' | 'overture' | 'playing' | 'aftermath'>('none');
  // warSummary mirrors the data the WarSummaryCard fetches so the
  // cinematic overlay can show outcome and aftermath text on the
  // closing card without a second round trip.
  const [warSummary, setWarSummary] = useState<{ outcome?: string; aftermath?: string; notable?: string[]; yearStart: number; yearEnd: number; battleCount: number; totalCasualties: number; humanDeaths?: number; curatedStartYear?: number; curatedEndYear?: number; finalVictor?: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // openReplayBattleIdRef remembers which battle the cinematic has already
  // opened a replay overlay for. Without this, every pause/resume cycle
  // re-fires onPlayReplay for the *same* battle, App.tsx resets
  // replayPhase to 0, and the BattleReplay starts over from phase one
  // instead of picking up where it left off. With it, resuming a paused
  // cinematic leaves the replay overlay untouched and only re-arms the
  // dwell timer.
  const openReplayBattleIdRef = useRef<string | null>(null);
  // dwellEndsAtRef and dwellRemainingMsRef track the dwell budget across
  // pause/resume. On effect setup we either use the remaining time (mid-
  // dwell resume) or compute a fresh budget from the current battle.
  // On pause-driven cleanup we capture how much time is left so the next
  // resume picks up from there rather than re-arming a full 28-second
  // dwell on a battle the user already watched 25 seconds of.
  const dwellEndsAtRef = useRef<number | null>(null);
  const dwellRemainingMsRef = useRef<number | null>(null);
  // lastAdvanceTickRef holds the cinematicAdvanceTick value already
  // consumed. The advance effect only fires when the prop value moves
  // past it so a fresh mount with a non-zero tick does not auto-skip.
  const lastAdvanceTickRef = useRef(cinematicAdvanceTick);
  const lastPrevTickRef = useRef(cinematicPrevTick);

  useEffect(() => {
    fetch('/api/battles/stats')
      .then((r) => r.json())
      .then((d) => {
        // Filter out wars with too few battles. The Wikidata import sweeps in
        // a long tail of "theaters" and "campaigns" with one to three thin
        // entries, often with broken sides data left over from the infobox
        // parse ("| combatant2 = ..."). Raising the threshold to 8 cuts
        // those without losing real wars: the wars list still has hundreds
        // of substantive entries.
        setWars((d.wars || []).filter((w: WarCount) => w.count >= 8));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    onWarSelected?.(selectedWar);
    // Surface the selected war's top participating countries so App can pipe
    // them into BattleGlobe for territory shading. Falls through to an empty
    // list when nothing is selected, which clears the shading.
    if (onWarCountries) {
      if (!selectedWar) {
        onWarCountries([]);
      } else {
        const matchedWar = wars.find((w) => w.name === selectedWar);
        const inherited = matchedWar?.parent
          ? wars.find((w) => w.name === matchedWar.parent)?.countries
          : undefined;
        onWarCountries(matchedWar?.countries?.length ? matchedWar.countries : (inherited ?? []));
      }
    }
    if (!selectedWar) { setBattles([]); setBattlesLoading(false); setInitialPaneLoaded(false); onBattlesLoaded(null); return; }
    setBattlesLoading(true);
    setInitialPaneLoaded(false);
    fetch(`/api/battles?war=${encodeURIComponent(selectedWar)}&limit=2000`)
      .then((r) => r.json())
      .then((d) => {
        const b: Battle[] = d.battles || [];
        setBattles(b);
        setGroupIndex(0);
        setSubIndex(0);
        setPlaying(false);
        setDetail(null);
        onBattlesLoaded(b);
      })
      .catch(() => {})
      .finally(() => setBattlesLoading(false));
  }, [selectedWar, onBattlesLoaded, onWarSelected, onWarCountries, wars]);

  // Toggling cinematic on/off re-shapes the playable groups (different set
  // of battles), so anchor the playhead back to the first entry. Otherwise
  // a user halfway through a 600-battle step-through who switches to
  // cinematic mode would jump to whatever index the original list had at
  // that position, which is meaningless in the narrower 22-battle subset.
  // Also clears the open-replay tracker and the dwell-remaining capture so
  // a fresh mode starts cleanly.
  useEffect(() => {
    setGroupIndex(0);
    setSubIndex(0);
    openReplayBattleIdRef.current = null;
    dwellRemainingMsRef.current = null;
    dwellEndsAtRef.current = null;
  }, [cinematic]);

  // When the selected war changes the previous war's open-replay tracker
  // and dwell capture are stale. Reset.
  useEffect(() => {
    openReplayBattleIdRef.current = null;
    dwellRemainingMsRef.current = null;
    dwellEndsAtRef.current = null;
  }, [selectedWar]);

  // Stop the war auto-step when the tab is hidden or the window blurs. Same
  // motivation as the replay version: nobody wants to come back and find
  // their war scrubbed silently to the last battle.
  usePauseOnHidden(useCallback(() => setPlaying(false), []));

  // Fetch the war summary for the cinematic overlay. Same endpoint the
  // WarSummaryCard uses; keeping a local copy lets the overlay render its
  // closing aftermath card without waiting on a child re-render.
  // Flip initialPaneLoaded once all three async paths have settled for the
  // first time after a war selection. After that, intra-war transitions
  // (next/prev battle in cinematic) don't re-show the heavy overlay.
  useEffect(() => {
    if (initialPaneLoaded) return;
    if (!selectedWar) return;
    if (battlesLoading) return;
    if (battles.length === 0) return;
    if (detailLoading || !detail) return;
    if (warSummaryLoading || !warSummary) return;
    setInitialPaneLoaded(true);
  }, [initialPaneLoaded, selectedWar, battlesLoading, battles.length, detailLoading, detail, warSummaryLoading, warSummary]);

  useEffect(() => {
    if (!selectedWar) { setWarSummary(null); setWarSummaryLoading(false); return; }
    let cancelled = false;
    setWarSummaryLoading(true);
    setWarSummary(null);
    fetch(`/api/wars/summary?name=${encodeURIComponent(selectedWar)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (!cancelled && s) setWarSummary(s); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setWarSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [selectedWar]);

  // Deduplicated belligerent labels surfaced on the cinematic opening
  // card. Pulled from each battle's sides[].name set rather than from
  // war metadata because the war record does not carry sides.
  //
  // We also filter junk-looking labels and collapse semantic duplicates
  // before display. Wikipedia-infobox parsing occasionally produces
  // acronym artefacts like "UKGBI" or partial fragments like
  // "France + Britain" alongside their proper long forms, which then
  // appear on the cinematic overture next to the real names and read as
  // sloppy. The cleaner: skip uppercase-only tokens shorter than 6 chars,
  // skip labels containing "+" mid-string (those are infobox shorthand),
  // and drop a label whose first canonical country is already represented
  // by a previously kept label.
  //
  // For the American Civil War we used to see "United States · Virginia ·
  // (Union) · Union · Confederate" because the infobox sometimes lists the
  // sub-national contributor and a parenthetical shorthand alongside the
  // canonical label. The pre-pass normalises each label by stripping its
  // outer parentheses, collapsing "Confederate" → "Confederate States",
  // and dropping labels whose comparison key is the parens-stripped form
  // of a kept label. A short list of US sub-national state fragments is
  // also rejected when at least one national-level belligerent is already
  // kept; the cinematic overture is for nations and coalitions, not for
  // every state that contributed troops.
  const cinematicSides = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    // Lone US state names that crop up in the Civil War infobox combatant
    // field. None of these belong on the overture line.
    const SUBNATIONAL = new Set<string>([
      'virginia', 'tennessee', 'texas', 'georgia', 'alabama',
      'south carolina', 'north carolina', 'mississippi', 'louisiana',
      'arkansas', 'florida', 'missouri', 'kentucky', 'maryland',
      'kansas', 'iowa',
    ]);
    // displayLabel cleans a side name for the overture: strip a bare
    // outer parenthesis pair ("(Union)" → "Union"), promote "Confederate"
    // to "Confederate States" so it reads as a proper belligerent, strip
    // a trailing nationality suffix from a sub-unit ("RAF Fighter
    // Command (UK)" → "RAF Fighter Command"), and trim whitespace. Trailing
    // wikitext template residue ("Foo {{plainlist") gets cut off here.
    const displayLabel = (raw: string): string => {
      let t = raw.trim();
      // Cut off any wikitext template suffix.
      t = t.replace(/\s*\{\{.*$/, '').trim();
      // Strip leading "the ".
      t = t.replace(/^the\s+/i, '');
      const wrap = t.match(/^\(\s*(.*)\s*\)$/);
      if (wrap) t = wrap[1].trim();
      if (/^confederate$/i.test(t)) t = 'Confederate States';
      return t;
    };
    // isSubUnit detects RAF Fighter Command / Eighth Army / 4th Panzer
    // Division / 101st Airborne — formation-level fragments that the
    // overture should never display alongside actual nations. The list of
    // tokens is short; a side name that ends with one of them and has no
    // additional country word other than a parenthetical nationality is
    // treated as a sub-unit and dropped if a national entry already exists.
    const SUBUNIT_TOKENS = /\b(Command|Corps|Division|Army Group|Brigade|Regiment|Battalion|Fleet|Squadron|Wing|Group|Airborne|Panzer|Marines)\b/i;
    // normKey is the comparison key for de-dup. Strips inline parens,
    // articles, common kingdom/empire/republic prefixes, and trailing
    // "states" so "Confederate States" and "Confederate" collapse to one.
    const normKey = (raw: string): string => {
      let t = raw.toLowerCase().trim();
      t = t.replace(/\([^()]*\)/g, '').trim();
      t = t.replace(/^the\s+/, '');
      t = t.replace(/\b(?:kingdom|empire|republic|federation|union)\s+of\s+/g, '');
      t = t.replace(/\s+states?$/g, '');
      t = t.replace(/\s+/g, ' ').trim();
      return t;
    };
    const isJunk = (s: string): boolean => {
      const t = s.trim();
      if (!t) return true;
      // Pure parens or punctuation: "()" or "( )".
      if (/^[\s()\-—.,]*$/.test(t)) return true;
      // Wikitext residue: "{{plainlist", "}}", "|}", "{|", "* [[".
      if (/\{\{|\}\}|\|\}|\{\|/.test(t)) return true;
      // Any unmatched curly is also wikitext leakage.
      if (/[{}]/.test(t)) return true;
      // All-caps acronym below 6 chars: "UKGBI", "ANZAC" is OK at 5 but
      // typically appears as "ANZACs" or "British Empire" elsewhere.
      if (/^[A-Z0-9.]{2,6}$/.test(t) && t.length < 6) return true;
      // Side names with a bare "+" are infobox shorthand for a coalition
      // (e.g. "France + Britain") that we already render via the proper
      // belligerent labels.
      if (/\s\+\s/.test(t)) return true;
      // Lone country codes glued together with no separator.
      if (/^[A-Z]{4,}[A-Z0-9]{0,}$/.test(t)) return true;
      return false;
    };
    // First pass: walk every battle, collect (key, label, count) buckets.
    // Counting matters for big multi-front wars: WW2 picked up in battle
    // order shows Spanish Civil War belligerents first ("Nazi Germany,
    // Second Polish Republic, Spanish Republic, Nationalist Spain,
    // Second Czechoslovak Republic") and never gets to USA / USSR /
    // UK / Japan, because the cap is 5. Counting + sorting fixes it: the
    // belligerents that actually fought the most battles in the war win
    // the slots regardless of where their first battle falls in time.
    interface Bucket { key: string; label: string; count: number; firstSeen: number; }
    const buckets: Map<string, Bucket> = new Map();
    let order = 0;
    for (const b of battles) {
      // Per-battle dedupe: a battle with two sides both keyed to "us"
      // shouldn't double-count. Reset per battle.
      const seenInBattle = new Set<string>();
      for (const s of b.sides || []) {
        const name = (s.name || '').trim();
        if (!name) continue;
        if (isJunk(name)) continue;
        const label = displayLabel(name);
        if (!label || isJunk(label)) continue;
        // Drop US sub-national state fragments and formation sub-units
        // (RAF Fighter Command etc.) before they get a slot. We still
        // count canon-keyed entries for those sides, but the *display
        // label* must be a national level entity. Pick the cleanest
        // label seen so far for this key.
        const key = canonBelligerentKey(label) || normKey(label);
        if (!key) continue;
        if (seenInBattle.has(key)) continue;
        seenInBattle.add(key);
        const subnational = SUBNATIONAL.has(normKey(label));
        const subUnit = SUBUNIT_TOKENS.test(label) && !canonBelligerentKey(label);
        // Skip fragments outright. They never display, and they don't
        // count toward the frequency rank.
        if (subnational || subUnit) continue;
        // Prefer the canonical publication-grade label when the key has
        // one registered (e.g. canon key "us" → "United States" instead of
        // the raw side string "United States and allies (Australia, New
        // Zealand)"). Falls back to the cleaned display label for keys we
        // haven't canonicalised.
        const canonLabel = canonBelligerentLabel(key);
        const finalLabel = canonLabel || label;
        const existing = buckets.get(key);
        if (existing) {
          existing.count += 1;
          // If a canonical label is now available, lock to it.
          if (canonLabel) existing.label = canonLabel;
        } else {
          buckets.set(key, { key, label: finalLabel, count: 1, firstSeen: order++ });
        }
      }
    }
    // Sort by count descending; firstSeen ascending breaks ties so the
    // historically earlier participant wins when two belligerents appear
    // in the same number of battles. Cap at 5 — the overture is a chip
    // strip, not a table.
    const ranked = [...buckets.values()].sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.firstSeen - b.firstSeen;
    });
    for (const b of ranked) {
      if (seen.has(b.key)) continue;
      seen.add(b.key);
      out.push(b.label);
      if (out.length >= 5) break;
    }
    return out;
  }, [battles]);

  // cinematicSidesTotal is the actual distinct belligerent count across
  // the war's battles, before the top-5 cap. Used for the "Belligerents"
  // stat cell on the overture so a war that pulled in 40 nations doesn't
  // read as "5" just because the chip strip only shows the top five.
  const cinematicSidesTotal = useMemo(() => {
    const keys = new Set<string>();
    const SUBNATIONAL = new Set<string>([
      'virginia', 'tennessee', 'texas', 'georgia', 'alabama',
      'south carolina', 'north carolina', 'mississippi', 'louisiana',
      'arkansas', 'florida', 'missouri', 'kentucky', 'maryland',
      'kansas', 'iowa',
    ]);
    const SUBUNIT = /\b(Command|Corps|Division|Army Group|Brigade|Regiment|Battalion|Fleet|Squadron|Wing|Group|Airborne|Panzer|Marines)\b/i;
    const norm = (raw: string): string => {
      let t = raw.toLowerCase().trim();
      t = t.replace(/\([^()]*\)/g, '').trim();
      t = t.replace(/^the\s+/, '');
      t = t.replace(/\b(?:kingdom|empire|republic|federation|union)\s+of\s+/g, '');
      t = t.replace(/\s+states?$/g, '');
      t = t.replace(/\s+/g, ' ').trim();
      return t;
    };
    for (const b of battles) {
      for (const s of b.sides || []) {
        const name = (s.name || '').trim();
        if (!name) continue;
        if (/^[\s()\-—.,]*$/.test(name)) continue;
        if (/\{\{|\}\}|\|\}|\{\||[{}]/.test(name)) continue;
        const n = norm(name);
        if (SUBNATIONAL.has(n)) continue;
        const key = canonBelligerentKey(name) || n;
        if (!key) continue;
        if (SUBUNIT.test(name) && !canonBelligerentKey(name)) continue;
        keys.add(key);
      }
    }
    return keys.size;
  }, [battles]);

  // detailCacheRef holds per-battle dossier data fetched on demand. Once a
  // battle's detail is in the cache, subsequent focusBattle calls hit it
  // synchronously — no network, no loading flash, no per-step latency.
  // Cleared when the war changes (different battle set, different IDs).
  const detailCacheRef = useRef<Map<string, Battle>>(new Map());

  // Clear the dossier cache whenever the war changes — the battle ID set
  // is different and the old cache is no longer relevant.
  useEffect(() => {
    detailCacheRef.current = new Map();
  }, [selectedWar]);

  const focusBattle = useCallback((battle: Battle) => {
    onBattleFocus(battle);
    const cached = detailCacheRef.current.get(battle.id);
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    fetch(`/api/battles/${battle.id}`)
      .then((r) => r.json())
      .then((d) => {
        detailCacheRef.current.set(battle.id, d);
        setDetail(d);
      })
      .catch(() => setDetail(battle))
      .finally(() => setDetailLoading(false));
  }, [onBattleFocus, selectedWar]);

  const goTo = useCallback((gi: number, si: number = 0) => {
    if (gi < 0 || gi >= groups.length) return;
    const s = Math.min(si, groups[gi].battles.length - 1);
    setGroupIndex(gi);
    setSubIndex(s);
    focusBattle(groups[gi].battles[s]);
  }, [groups, focusBattle]);

  // Do NOT auto-focus the first battle when a war is freshly selected. The
  // user wants a beat to take in every battle of the war on the globe before
  // diving into one. We only auto-focus once the user advances the timeline
  // manually (groupIndex > 0 or subIndex > 0) or hits Play (handled in the
  // playback effect below).
  useEffect(() => {
    if (groups.length === 0) return;
    // Always fetch detail for the current battle, including the initial
    // (0,0) position. The previous early-return left detail null forever
    // on initial load, which deadlocked the right-pane loading state
    // because it waits for detail to arrive. Globe camera focus is still
    // managed by the dedicated framing effect below, so this only fires
    // the dossier fetch.
    focusBattle(groups[groupIndex].battles[subIndex]);
  }, [groups, groupIndex, subIndex, focusBattle]);

  useEffect(() => {
    if (!playing || groups.length === 0) return;
    const group = groups[groupIndex];
    const battle = group.battles[subIndex];

    // Focus the current battle when the cinematic is running. Without this
    // the camera stays parked at the war centroid until the first dwell
    // timer fires, which reads as "playback is broken".
    focusBattle(battle);

    // Open the replay overlay only when we have NOT already opened one
    // for this same battle. Otherwise pause/resume re-fires onPlayReplay,
    // which resets the inner replay to phase 0 and feels like the
    // cinematic restarted instead of resumed.
    const isCinematic = cinematic && !!onPlayReplay && (battle?.hasReplay || battle?.hasSchematic);
    if (isCinematic && onPlayReplay && openReplayBattleIdRef.current !== battle.id) {
      onPlayReplay(battle);
      openReplayBattleIdRef.current = battle.id;
    }
    // Per-battle dwell budget. Hand-crafted replays vary 22-40s depending
    // on phase count; we now wait for the BattleReplay-driven onEnded
    // signal to advance and treat this dwell as a safety backstop, so the
    // budget is generously oversized rather than tuned to a typical phase
    // total. Schematic auto-replays run 3 phases (~17s); tooltip-only
    // battles get a brief 14s read. Concurrent siblings on the same date
    // get half the manual speed so the cluster pulses rather than crawls.
    let fullDwellMs: number;
    if (isCinematic) {
      // The dwell is a backstop now — onEnded fires when the inner
      // BattleReplay actually finishes its phases. Generous so even the
      // longest hand-crafted replays (Stalingrad: 10 phases, 83s) don't
      // get cut off when onEnded somehow fails to propagate.
      // Tiered dwells for the broader cinematic playlist. These are BACKSTOPS
      // — replay-bearing battles advance when BattleReplay's onEnded fires
      // after its full phase set + outro. The dwell only triggers if onEnded
      // somehow doesn't propagate.
      //   - hasReplay: 120s backstop (real dwell 30-90s from curated phases).
      //   - hasSchematic: 25s backstop (3 auto-generated phases × 5.5s each
      //     + 1.2s cinematic outro = ~18s real, with margin for the trace
      //     arc + arrival to settle). Earlier 9s dwell cut schematics short
      //     at the deployment phase — user saw the same opening over and
      //     over because every schematic battle started fresh at phase 0
      //     before the next ones could play.
      //   - tooltip-only: 4s — no replay; just the ignition burst, focus
      //     rings, and trace arc to the next battle.
      if (battle?.hasReplay) fullDwellMs = 120000;
      else if (battle?.hasSchematic) fullDwellMs = 14000;
      else fullDwellMs = 4000;
    } else if (group.concurrent && subIndex < group.battles.length - 1) {
      fullDwellMs = Math.max(speed / 2, 1500);
    } else {
      fullDwellMs = speed;
    }

    // Resume from where the user paused, if we paused mid-battle. The
    // captured remaining time is consumed once; subsequent re-runs of the
    // effect (advance to next battle, etc.) use the full dwell again.
    const dwellMs = dwellRemainingMsRef.current ?? fullDwellMs;
    dwellRemainingMsRef.current = null;
    dwellEndsAtRef.current = Date.now() + dwellMs;

    timerRef.current = setTimeout(() => {
      dwellEndsAtRef.current = null;
      if (isCinematic && onCloseReplay) onCloseReplay();
      // Clear the open-replay tracker so the *next* battle's effect run
      // opens its own replay.
      openReplayBattleIdRef.current = null;
      if (group.concurrent && subIndex < group.battles.length - 1) {
        const next = subIndex + 1;
        setSubIndex(next);
        focusBattle(group.battles[next]);
      } else if (groupIndex < groups.length - 1) {
        goTo(groupIndex + 1, 0);
      } else {
        setPlaying(false);
        // End of the campaign. If the user entered this run via the
        // cinematic overture, land on the aftermath card so the war has
        // a proper closing beat.
        if (cinematicStage === 'playing') {
          setCinematicStage('aftermath');
        }
      }
    }, dwellMs);
    return () => {
      clearTimeout(timerRef.current);
      // If the cleanup is firing because the user paused (rather than
      // because the timer fired and we transitioned), capture the
      // remaining dwell so the next resume picks up from here. We can
      // distinguish: timer-fired cleanup zeroes dwellEndsAtRef inside
      // its callback before this cleanup runs, so a non-null value here
      // means the dwell was interrupted.
      if (dwellEndsAtRef.current !== null) {
        const remaining = dwellEndsAtRef.current - Date.now();
        if (remaining > 250) dwellRemainingMsRef.current = remaining;
        dwellEndsAtRef.current = null;
      }
    };
    // focusBattle and goTo are intentionally omitted from deps. They are
    // stable callbacks built from props, but adding them re-runs this effect
    // on every render and breaks the dwell timer mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, groupIndex, subIndex, groups, speed, cinematic, onPlayReplay, onCloseReplay]);

  // Cinematic short-circuit: when the active BattleReplay reports its
  // outro pause has finished (cinematicAdvanceTick increments), close the
  // overlay and jump to the next battle right now. The wall-clock dwell
  // timer stays armed as a backstop in case the inner replay never fires
  // ended (broken phases, missing replay, etc.).
  useEffect(() => {
    if (cinematicAdvanceTick === lastAdvanceTickRef.current) return;
    // Cinematic must be active and groups must be loaded, but we no
    // longer gate on `playing`. The tick is incremented either by the
    // inner BattleReplay's natural end (which only happens during active
    // playback) or by the user explicitly clicking "Next battle" on the
    // outro card, in which case "stuck on outro, paused" is exactly when
    // they need the jump to fire. Forcing play resumption alongside the
    // advance rescues both paths in one shot.
    if (!cinematic || groups.length === 0) return;
    const group = groups[groupIndex];
    if (!group) return;
    lastAdvanceTickRef.current = cinematicAdvanceTick;
    clearTimeout(timerRef.current);
    dwellEndsAtRef.current = null;
    dwellRemainingMsRef.current = null;
    if (onCloseReplay) onCloseReplay();
    openReplayBattleIdRef.current = null;
    if (group.concurrent && subIndex < group.battles.length - 1) {
      const next = subIndex + 1;
      setSubIndex(next);
      focusBattle(group.battles[next]);
      setPlaying(true);
    } else if (groupIndex < groups.length - 1) {
      goTo(groupIndex + 1, 0);
      setPlaying(true);
    } else {
      setPlaying(false);
      if (cinematicStage === 'playing') setCinematicStage('aftermath');
    }
    // focusBattle and goTo are stable; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cinematicAdvanceTick, cinematic, groupIndex, subIndex, groups, onCloseReplay, cinematicStage]);

  // Manual previous-battle handler. Same propagation pattern as the
  // advance tick: the user clicks "Previous battle" on the outro, App
  // increments cinematicPrevTick, this effect catches the change and
  // rewinds one group. Cinematic mode is required so the prev button
  // only ever fires during a cinematic playthrough.
  useEffect(() => {
    if (cinematicPrevTick === lastPrevTickRef.current) return;
    if (!cinematic || groups.length === 0) return;
    lastPrevTickRef.current = cinematicPrevTick;
    clearTimeout(timerRef.current);
    dwellEndsAtRef.current = null;
    dwellRemainingMsRef.current = null;
    if (onCloseReplay) onCloseReplay();
    openReplayBattleIdRef.current = null;
    if (subIndex > 0) {
      const next = subIndex - 1;
      setSubIndex(next);
      focusBattle(groups[groupIndex].battles[next]);
    } else if (groupIndex > 0) {
      goTo(groupIndex - 1, 0);
    }
    setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cinematicPrevTick, cinematic, groupIndex, subIndex, groups, onCloseReplay]);

  // Build a hierarchical tree: top-level wars at depth 0, child theaters and
  // campaigns nested below their parent. The "Bloodiest" and "Most Battles"
  // sorts use the rolled totals so parents always rank above their children.
  const sortKey = (w: WarCount): number => {
    if (warSort === 'casualties') return -preferredTotalForWar(w);
    if (warSort === 'battles') return -(w.rolledCount || w.count);
    if (warSort === 'chrono') return w.minYear;
    return 0;
  };

  // A row in the war list is either a war (clickable) or a country header
  // (groups several wars). Country headers only appear under the "By Country"
  // sort and are not selectable.
  type Row =
    | { kind: 'country'; name: string; warCount: number; casualties: number; depth: 0 }
    | (WarCount & { kind: 'war'; depth: 0 | 1 });

  const tree: Row[] = (() => {
    if (warSort === 'country') {
      // Build country buckets. Each war is filed under every country it had
      // a recognized belligerent in, so a multi-belligerent war like World
      // War II appears under United States, Germany, Russia, etc. Children
      // (theaters and campaigns) inherit their parent's country set when the
      // child itself has none; otherwise they file under their own.
      const parents = new Map(wars.filter((w) => !w.parent).map((w) => [w.name, w]));
      const byCountry = new Map<string, WarCount[]>();
      for (const w of wars) {
        let countries = w.countries && w.countries.length ? w.countries : undefined;
        if (!countries && w.parent) {
          const parent = parents.get(w.parent);
          countries = parent?.countries;
        }
        if (!countries || countries.length === 0) continue;
        for (const c of countries) {
          const list = byCountry.get(c) ?? [];
          list.push(w);
          byCountry.set(c, list);
        }
      }
      const countryNames = [...byCountry.keys()].sort((a, b) =>
        a.localeCompare(b),
      );
      const flat: Row[] = [];
      for (const country of countryNames) {
        const warsInCountry = (byCountry.get(country) ?? [])
          .slice()
          .sort((a, b) => {
            const ca = preferredTotalForWar(a);
            const cb = preferredTotalForWar(b);
            if (ca !== cb) return cb - ca;
            return a.name.localeCompare(b.name);
          });
        const totalCas = warsInCountry.reduce(
          (s, w) => s + preferredTotalForWar(w),
          0,
        );
        flat.push({
          kind: 'country',
          name: country,
          warCount: warsInCountry.length,
          casualties: totalCas,
          depth: 0,
        });
        for (const w of warsInCountry) {
          flat.push({ ...w, kind: 'war', depth: 1 });
        }
      }
      return flat;
    }

    const parents = wars.filter((w) => !w.parent);
    const childrenByParent = new Map<string, WarCount[]>();
    for (const w of wars) {
      if (!w.parent) continue;
      const list = childrenByParent.get(w.parent) ?? [];
      list.push(w);
      childrenByParent.set(w.parent, list);
    }
    // Sort top-level wars by the chosen mode.
    const topSorted = [...parents].sort((a, b) => {
      if (warSort === 'alpha') return a.name.localeCompare(b.name);
      return sortKey(a) - sortKey(b);
    });
    // Sort children alphabetically inside each parent group to keep the tree
    // stable regardless of which sort the user picked at the top level.
    const flat: Row[] = [];
    for (const p of topSorted) {
      flat.push({ ...p, kind: 'war', depth: 0 });
      const kids = (childrenByParent.get(p.name) ?? []).slice().sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const k of kids) flat.push({ ...k, kind: 'war', depth: 1 });
    }
    return flat;
  })();

  // Under the Bloodiest sort, drop rows whose rolled casualty total is zero.
  // A "0k" badge under a sort named Bloodiest reads as "this war was bloodless"
  // when it really means "we have no casualty figures for the battles in our
  // index". Hiding those rows keeps the ranking truthful. Other sorts keep
  // every row so a user looking by name or chronology still finds them.
  const bloodFiltered =
    warSort === 'casualties'
      ? tree.filter((w) => {
          if (w.kind !== 'war') return true;
          const v = w.depth === 0 ? preferredTotalForWar(w) : (w.humanDeaths || w.casualties);
          return v > 0;
        })
      : tree;
  // Search applies to war names only. When in country mode, also keep a
  // country header if any of its wars survive the filter.
  const filteredWars = (() => {
    if (!warSearch) return bloodFiltered;
    const q = warSearch.toLowerCase();
    if (warSort !== 'country') {
      return bloodFiltered.filter(
        (w) => w.kind === 'war' && w.name.toLowerCase().includes(q),
      );
    }
    const out: Row[] = [];
    let pendingHeader: Row | null = null;
    let headerEmitted = false;
    for (const row of bloodFiltered) {
      if (row.kind === 'country') {
        pendingHeader = row;
        headerEmitted = false;
        continue;
      }
      if (!row.name.toLowerCase().includes(q)) continue;
      if (pendingHeader && !headerEmitted) {
        out.push(pendingHeader);
        headerEmitted = true;
      }
      out.push(row);
    }
    return out;
  })();

  const currentGroup = groups[groupIndex];
  const currentBattle = currentGroup?.battles[subIndex];
  const totalIdx = groups.slice(0, groupIndex).reduce((s, g) => s + g.battles.length, 0) + subIndex;

  // lastSnapshotKeyRef remembers which (war, snapshot.year) tuple is
  // currently painted. The territory effect re-runs on every phase
  // advance, but the snapshot itself only changes at a few calendar
  // boundaries — so the cheap dedupe here stops the polygon transition
  // from restarting (and visually flickering) every time the playhead
  // ticks to the next battle inside the same year.
  const lastSnapshotKeyRef = useRef<string>('');

  // Time-shifting territory: when the playhead moves to a new battle,
  // resolve the snapshot for the current war + battle year and emit it
  // upward so BattleGlobe re-paints. Once the campaign reaches its
  // aftermath stage, pin the final (latest) snapshot so the post-war
  // ownership stays visible behind the aftermath card and after the user
  // dismisses it. Cleared only when no war is selected so the globe falls
  // back to its idle state.
  useEffect(() => {
    if (!onWarTerritory) return;
    // anchorsFor returns one { faction, anchor } per controller in a
    // snapshot. The anchor is the first country listed in the control
    // array, which by convention is the faction's home country (Germany
    // for nazi-germany, Russia for ussr, United Kingdom for uk, etc.).
    const anchorsFor = (control: Record<string, string[]>) =>
      Object.entries(control)
        .filter(([, list]) => list.length > 0)
        .map(([faction, list]) => ({ faction, anchor: list[0] }));
    if (!selectedWar) {
      if (lastSnapshotKeyRef.current !== '') {
        lastSnapshotKeyRef.current = '';
        onWarTerritory(null, null, [], []);
      }
      return;
    }
    // Aftermath path: emit the latest snapshot we have for this war,
    // regardless of which battle the playhead is parked on.
    if (cinematicStage === 'aftermath') {
      const entry = TERRITORY.find((t) => t.war === selectedWar);
      const finalSnap = entry?.snapshots[entry.snapshots.length - 1];
      if (finalSnap) {
        const key = `${selectedWar}|aftermath|${finalSnap.year}`;
        if (lastSnapshotKeyRef.current !== key) {
          lastSnapshotKeyRef.current = key;
          onWarTerritory(buildCountryColorMap(finalSnap), finalSnap.label, Object.keys(finalSnap.control), anchorsFor(finalSnap.control));
        }
        return;
      }
    }
    if (!currentBattle) {
      // No battle focused but we still want shading: fall back to the most
      // recent snapshot so the globe holds the post-war state rather than
      // collapsing to bare.
      const entry = TERRITORY.find((t) => t.war === selectedWar);
      const fallback = entry?.snapshots[entry.snapshots.length - 1];
      const key = fallback ? `${selectedWar}|fallback|${fallback.year}` : `${selectedWar}|empty`;
      if (lastSnapshotKeyRef.current === key) return;
      lastSnapshotKeyRef.current = key;
      if (fallback) {
        onWarTerritory(buildCountryColorMap(fallback), fallback.label, Object.keys(fallback.control), anchorsFor(fallback.control));
      } else {
        onWarTerritory(null, null, [], []);
      }
      return;
    }
    const snap = findSnapshot(selectedWar, currentBattle.year);
    if (!snap) {
      const key = `${selectedWar}|nosnap`;
      if (lastSnapshotKeyRef.current === key) return;
      lastSnapshotKeyRef.current = key;
      onWarTerritory(null, null, [], []);
      return;
    }
    // Snapshot dedupe: every advance whose year falls into the same snapshot
    // window emits nothing new, so the polygon transition doesn't restart
    // and the territory shading stays put across same-snapshot battles.
    const key = `${selectedWar}|${snap.year}`;
    if (lastSnapshotKeyRef.current === key) return;
    lastSnapshotKeyRef.current = key;
    onWarTerritory(buildCountryColorMap(snap), snap.label, Object.keys(snap.control), anchorsFor(snap.control));
  }, [selectedWar, currentBattle, onWarTerritory, cinematicStage]);

  // Two distinct shells: a centered modal while the user is browsing the war
  // list (the globe doesn't help here, the list is what matters), and a slim
  // right-side pane once a war is chosen (the globe takes the stage and the
  // pane carries the controls and metadata out of the way).
  if (!selectedWar) {
    return (
      <div
        className="fixed inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-sm p-6"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="w-[620px] max-w-[94vw] bg-[#0a0c14]/97 border border-slate-800/80 rounded-2xl shadow-2xl flex flex-col max-h-[82vh]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/70 flex-shrink-0">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-amber-200/90 mb-1">
                The Atlas of War
              </div>
              <h3 className="text-[20px] font-semibold text-white tracking-tight" style={{ fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" }}>
                Choose a conflict
              </h3>
            </div>
            <CloseButton onClick={onClose} label="Back to the globe (Esc)" />
          </div>
          <div className="px-6 pt-4 pb-2 flex-shrink-0 border-b border-slate-800/40">
            <input
              type="text"
              value={warSearch}
              onChange={(e) => setWarSearch(e.target.value)}
              placeholder="Search wars..."
              className="w-full h-10 px-3 bg-transparent border border-slate-700/50 rounded-lg text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-amber-300/40 transition-colors"
            />
            <div className="flex items-baseline gap-4 mt-3 flex-wrap">
              {([
                ['casualties', 'Bloodiest'],
                ['battles', 'Most battles'],
                ['chrono', 'Oldest first'],
                ['alpha', 'A → Z'],
                ['country', 'By country'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setWarSort(key)}
                  className="text-[10px] font-semibold uppercase tracking-[0.28em] transition-colors focus:outline-none"
                  style={{
                    color: warSort === key ? '#fbbf24' : '#94a3b8',
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="p-4 overflow-y-auto flex-1">
            <div className="space-y-0.5 pr-1">
              {filteredWars.map((row) => {
                if (row.kind === 'country') {
                  return (
                    <div
                      key={`country:${row.name}`}
                      className="px-3 pt-3 pb-1.5 flex items-baseline justify-between text-[11px] uppercase tracking-[0.18em] font-semibold text-blue-300/80 border-b border-slate-800/60 first:border-t-0"
                    >
                      <span>{row.name}</span>
                      <span className="text-[10px] text-slate-600 tabular-nums normal-case tracking-normal font-normal">
                        {row.warCount} {row.warCount === 1 ? 'war' : 'wars'}
                      </span>
                    </div>
                  );
                }
                const w = row;
                const showVal =
                  warSort === 'casualties'
                    ? (w.depth === 0 ? preferredTotalForWar(w) : (w.humanDeaths || w.casualties))
                    : warSort === 'chrono'
                    ? w.minYear
                    : warSort === 'country'
                    ? preferredTotalForWar(w)
                    : (w.depth === 0 ? w.rolledCount : w.count);
                const eraTheme = themeForYear(w.minYear || 1900);
                const stripeColor = eraTheme.accent;
                // Country chips: surface up to two top participants on each
                // war row so the reader can place the war geographically
                // without opening it. Suppressed on the "By Country" view to
                // avoid redundancy with the country header above.
                const chipCountries =
                  warSort === 'country' || !w.countries ? [] : w.countries.slice(0, 2);
                return (
                  <button
                    key={`war:${w.name}:${w.depth}`}
                    onClick={() => setSelectedWar(w.name)}
                    className={`relative w-full text-left rounded-lg text-[13px] hover:bg-slate-800/50 hover:text-white transition-colors overflow-hidden ${
                      warSort === 'country'
                        ? 'pl-3 pr-3 py-1.5 text-slate-300'
                        : w.depth === 0
                        ? 'pl-3 pr-3 py-2 text-slate-300 font-medium'
                        : 'pl-7 pr-3 py-1.5 text-slate-400 text-[12px]'
                    }`}
                  >
                    {/* Era stripe on the leading edge — kept narrow and
                        muted so it reads as a chronological hint, not a
                        rainbow column. */}
                    {warSort !== 'country' && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r"
                        style={{ background: `${stripeColor}55` }}
                      />
                    )}
                    <div className="flex justify-between items-center gap-3">
                      <span className="truncate min-w-0">
                        {warSort !== 'country' && w.depth > 0 && (
                          <span className="text-slate-700 mr-1" aria-hidden="true">└</span>
                        )}
                        {w.name}
                      </span>
                      <span className="text-[10px] text-slate-600 flex-shrink-0 tabular-nums">
                        {warSort === 'casualties' && showVal > 0
                          ? formatCasualtyCompact(showVal)
                          : warSort === 'chrono'
                          ? formatYear(showVal)
                          : warSort === 'country' && showVal > 0
                          ? formatCasualtyCompact(showVal)
                          : warSort === 'country'
                          ? `${w.rolledCount || w.count}`
                          : `${showVal}`}
                      </span>
                    </div>
                    {(chipCountries.length > 0 || w.minYear !== 0) && (
                      <div className="mt-0.5 flex items-baseline gap-2 text-[10px] text-slate-500 tracking-wide">
                        {chipCountries.length > 0 && (
                          <span className="truncate">
                            {chipCountries.join(' · ')}
                            {w.countries && w.countries.length > chipCountries.length && (
                              <span className="text-slate-600 ml-1">+{w.countries.length - chipCountries.length}</span>
                            )}
                          </span>
                        )}
                        {w.minYear !== 0 && (
                          <span className="ml-auto text-slate-600 tabular-nums flex-shrink-0">
                            from {formatYear(w.minYear)}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
              {filteredWars.length === 0 && (
                <p className="text-center text-[12px] text-slate-600 py-4">No wars match</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] max-w-[92vw] z-30 bg-[#0f1019]/95 backdrop-blur-xl border-l border-slate-800 flex flex-col">
      {/* Header carries a single, unambiguous exit (top-right X) that
          drops the user straight back to the globe. The previous version
          also had a back arrow that returned to the war picker, but the
          picker is itself a mid-flow state, not a destination, so giving
          it a top-bar slot suggested it was the default exit when the
          user actually wanted out. To pick a different war the user re-
          opens war mode from the main page; the "pick another war" link
          below is preserved for in-flow swapping. */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800/60 flex-shrink-0 gap-2">
        <h3 className="text-xs font-semibold text-white tracking-wide uppercase truncate flex-1 min-w-0 text-left">
          {selectedWar}
        </h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!battlesLoading && battles.length > 0 && (
            <span className="text-[10px] text-slate-500 tabular-nums">{battles.length}</span>
          )}
          <CloseButton onClick={onClose} label="Back to the globe (Esc)" />
        </div>
      </div>

      <div className="p-4 overflow-y-auto flex-1">
        {/* Single unified loading overlay. Stays mounted until ALL three
            async paths (battles list + current-battle detail + war summary)
            have settled for the FIRST time after a war selection. After
            that, intra-war battle hops are fast enough not to need a heavy
            overlay — the existing per-section state handles those quietly. */}
        {!initialPaneLoaded && (
          <div className="mb-3 rounded-xl border border-amber-400/25 bg-slate-900/55 px-4 py-5">
            <div className="flex items-center gap-3 mb-4">
              <span className="h-9 w-9 rounded-full bg-amber-500/20 flex items-center justify-center ring-1 ring-amber-400/40">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-amber-200 animate-spin" style={{ animationDuration: '1.4s' }}>
                  <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-slate-100 tracking-wide">
                  Loading {selectedWar}…
                </div>
                <div className="text-[10.5px] text-slate-400 mt-0.5">
                  {battlesLoading
                    ? 'Fetching the campaign'
                    : (detailLoading || !detail)
                      ? 'Loading the first battle dossier'
                      : (warSummaryLoading || !warSummary)
                        ? 'Loading the war narrative'
                        : 'Almost ready'}
                </div>
              </div>
            </div>
            <div className="space-y-2.5">
              <div className="h-3 w-3/4 rounded bg-slate-800/70 animate-pulse" />
              <div className="h-2 w-1/2 rounded bg-slate-800/55 animate-pulse" />
              <div className="h-2 w-2/3 rounded bg-slate-800/40 animate-pulse" />
              <div className="h-2 w-3/5 rounded bg-slate-800/40 animate-pulse" style={{ animationDelay: '0.2s' }} />
            </div>
          </div>
        )}

        {currentBattle && initialPaneLoaded && (
          <div className="mb-3 rounded-xl border border-slate-800/60 bg-slate-900/30 px-4 py-3.5">
            <div className="text-[9px] font-semibold uppercase tracking-[0.32em] text-amber-300/80 mb-1.5">
              About this battle
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ERA_COLORS[currentBattle.era] || '#fff' }} />
              <span className="text-[15px] font-semibold text-white">{currentBattle.name}</span>
            </div>
            <p className="text-[12px] text-slate-400 mb-2">{formatBattleDate(currentBattle.date, currentBattle.year)}</p>

            {currentGroup?.concurrent && (
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                  {currentGroup.battles.length} simultaneous
                </span>
                <div className="flex gap-1">
                  {currentGroup.battles.map((b, i) => (
                    <button key={b.id} onClick={() => { setSubIndex(i); focusBattle(b); }}
                      className={`w-2 h-2 rounded-full transition-all ${i === subIndex ? 'bg-amber-400 scale-125' : 'bg-slate-600'}`} />
                  ))}
                </div>
              </div>
            )}

            {detail?.victor && (
              <div className="mt-2 mb-2.5 flex items-baseline gap-2 text-[11.5px]">
                <span className="text-[9px] uppercase tracking-[0.28em] text-slate-500">Victor</span>
                <span className="text-slate-100 font-medium">{detail.victor}</span>
              </div>
            )}
            {detail?.summary && (
              <div className="mt-3">
                <div className="text-[9px] uppercase tracking-[0.28em] text-slate-500 mb-1">What happened</div>
                <p className="text-[12.5px] text-slate-200/95 leading-relaxed">{detail.summary}</p>
              </div>
            )}
            {detail?.significance && (
              <div className="mt-3">
                <div className="text-[9px] uppercase tracking-[0.28em] text-slate-500 mb-1">Why this battle mattered</div>
                <p className="text-[12.5px] text-slate-300 leading-relaxed italic">{detail.significance}</p>
              </div>
            )}
          </div>
        )}

        {/* Hero: "Play the war" — the ONE big play button. Owns the full
            cinematic flow. Separated visually from the secondary "browse
            one battle at a time" controls below so the two never compete. */}
        {initialPaneLoaded && groups.length > 0 && (() => {
          const totalBattles = groups.reduce((s, g) => s + g.battles.length, 0);
          if (totalBattles < 2) return null;
          return (
            <button
              onClick={() => {
                setCinematic(true);
                setCinematicStage('overture');
                setGroupIndex(0);
                setSubIndex(0);
                setPlaying(false);
              }}
              className="w-full mb-4 group relative px-4 py-3.5 text-left flex items-center gap-3.5 rounded-xl overflow-hidden border border-blue-400/40 bg-gradient-to-br from-blue-500/[0.16] via-blue-500/[0.06] to-transparent hover:from-blue-500/[0.24] hover:via-blue-500/[0.10] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
              style={{ boxShadow: '0 8px 28px -12px rgba(96,165,250,0.40)' }}
              title="Auto-plays the full war end-to-end with phase replays."
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-400/25 ring-1 ring-blue-300/60 group-hover:bg-blue-400/35 group-hover:ring-blue-200/80 transition-colors flex-shrink-0">
                <svg width="13" height="15" viewBox="0 0 11 13" fill="currentColor" className="ml-0.5 text-blue-100">
                  <path d="M0.5 0.93v11.14a.5.5 0 0 0 .77.42l9.07-5.57a.5.5 0 0 0 0-.84L1.27.51A.5.5 0 0 0 .5.93z" />
                </svg>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold text-white leading-tight tracking-tight">
                  Play the war
                </span>
                <span className="block text-[10.5px] text-slate-300/85 mt-1 leading-tight">
                  Auto-cinematic · {totalBattles} battles · phase replays
                </span>
              </span>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-blue-300/80 group-hover:text-blue-200 flex-shrink-0">
                <path d="M4 2 L8 6 L4 10" />
              </svg>
            </button>
          );
        })()}

        {/* Secondary: browse one battle at a time. Prev / next / scrubber
            only — NO play button. The hero above is the sole "play" entry
            point, so this row reads unambiguously as "manual stepping
            through individual battles" instead of competing with it. */}
        {initialPaneLoaded && groups.length > 0 && (() => {
          const totalBattles = groups.reduce((s, g) => s + g.battles.length, 0);
          return (
            <div className="mb-4 rounded-xl border border-slate-800/60 bg-slate-900/30 px-3 py-2.5">
              <div className="flex items-baseline justify-between mb-1.5 px-1">
                <span className="text-[9px] font-semibold uppercase tracking-[0.30em] text-slate-500">
                  Browse battle by battle
                </span>
                <span className="text-[9.5px] text-slate-500 tabular-nums">
                  {totalIdx + 1} of {totalBattles}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => goTo(groupIndex - 1)} disabled={groupIndex === 0}
                  className="h-7 w-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-700/60 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent transition-colors flex-shrink-0"
                  title="Previous battle"
                  aria-label="Previous battle">
                  <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                    <path d="M7.5 1.5L3 5.5l4.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <input type="range" min={0} max={Math.max(0, groups.length - 1)} value={groupIndex}
                  onChange={(e) => { setPlaying(false); goTo(parseInt(e.target.value)); }}
                  className="flex-1 accent-slate-400 h-1 bg-slate-800/60 rounded-full appearance-none cursor-pointer"
                  aria-label="Scrub through battles" />
                <button onClick={() => goTo(groupIndex + 1)} disabled={groupIndex >= groups.length - 1}
                  className="h-7 w-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-700/60 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent transition-colors flex-shrink-0"
                  title="Next battle"
                  aria-label="Next battle">
                  <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                    <path d="M3.5 1.5L8 5.5l-4.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })()}

        {/* How-it-ended card + Watch & Read shelf. Both gated on the same
            initialPaneLoaded flag as the rest of the right pane so nothing
            paints until the loading state has cleared. */}
        {initialPaneLoaded && (
          <>
            <WarSummaryCard
              warName={selectedWar}
              emphasize={
                groupIndex >= groups.length - 1 &&
                subIndex >= (groups[groupIndex]?.battles.length ?? 1) - 1
              }
              onEndingBattleClick={(id) => {
                const battle = battles.find((b) => b.id === id);
                if (battle) focusBattle(battle);
              }}
            />
            <MediaShelf
              warName={selectedWar}
              battleId={currentBattle?.id}
            />
          </>
        )}
      </div>
      {/* Cinematic full-screen overlay. Mounted via portal-style fixed
          positioning rather than inside the side panel so the title
          card owns the whole viewport, not just a 420px column. */}
      <WarCinematicOverlay
        stage={cinematicStage === 'overture' ? 'overture' : cinematicStage === 'aftermath' ? 'aftermath' : 'none'}
        warName={selectedWar}
        summary={warSummary}
        sides={cinematicSides}
        sidesTotal={cinematicSidesTotal}
        onDismiss={() => {
          // Overture dismiss is a "skip the title card and start watching"
          // gesture, not an exit. Aftermath dismiss is an "I'm done with
          // this war" gesture: route the user all the way back to the
          // globe rather than dumping them on the war detail panel, which
          // is itself a mid-flow state not a destination.
          if (cinematicStage === 'overture') {
            setCinematicStage('playing');
            setPlaying(true);
          } else if (cinematicStage === 'aftermath') {
            setCinematicStage('none');
            onClose();
          }
        }}
        onBegin={() => {
          setCinematicStage('playing');
          setPlaying(true);
        }}
      />

      {/* Cinematic HUD. Floats at the bottom-centre of the screen whenever a
          war cinematic is in the playing stage, so the user has an always-
          visible Pause / Resume / Stop pair instead of hunting for the tiny
          controls inside the right pane. Without this, pausing mid-flow felt
          like the app had stalled and there was no obvious resume path. */}
      {cinematicStage === 'playing' && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 pointer-events-auto"
          style={{ animation: 'cinhud-rise 280ms ease-out both' }}
        >
          <div
            className="flex items-center gap-3 px-3 py-2 rounded-full backdrop-blur-md border shadow-2xl"
            style={{
              background: 'rgba(8,10,18,0.78)',
              borderColor: 'rgba(96,165,250,0.45)',
              boxShadow: '0 12px 40px -10px rgba(0,0,0,0.6), 0 0 0 1px rgba(96,165,250,0.1) inset',
            }}
          >
            <div className="flex items-center gap-2 pl-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: playing ? '#60a5fa' : '#fbbf24',
                  boxShadow: playing
                    ? '0 0 10px rgba(96,165,250,0.8)'
                    : '0 0 10px rgba(251,191,36,0.8)',
                  animation: playing ? 'cinhud-pulse 1400ms ease-in-out infinite' : 'none',
                }}
              />
              <span className="text-[10px] uppercase tracking-[0.32em] font-semibold text-slate-200">
                {playing ? 'Cinematic playing' : 'Cinematic paused'}
              </span>
              {currentBattle && (
                <span className="text-[10px] text-slate-500 ml-1 hidden sm:inline">
                  · {currentBattle.name}
                </span>
              )}
            </div>
            <button
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? 'Pause cinematic' : 'Resume cinematic'}
              title={playing ? 'Pause cinematic' : 'Resume cinematic'}
              className="w-9 h-9 inline-flex items-center justify-center rounded-full bg-white text-slate-900 hover:scale-[1.05] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="2" width="3" height="10" rx="1" /><rect x="8" y="2" width="3" height="10" rx="1" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5 L12 7 L3 12.5 Z" /></svg>
              )}
            </button>
            <button
              onClick={() => {
                setCinematic(false);
                setCinematicStage('none');
                setPlaying(false);
                if (onCloseReplay) onCloseReplay();
              }}
              aria-label="Stop cinematic"
              title="Stop the cinematic and return to the war detail pane"
              className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-slate-800/80 text-slate-200 hover:bg-slate-700 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/70"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1.5" y="1.5" width="7" height="7" rx="1" /></svg>
            </button>
          </div>
          <style>{`
            @keyframes cinhud-rise {
              from { opacity: 0; transform: translate(-50%, 8px); }
              to   { opacity: 1; transform: translate(-50%, 0); }
            }
            @keyframes cinhud-pulse {
              0%, 100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.4); opacity: 0.7; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
