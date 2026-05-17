import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS } from '../types/battle';
import WarSummaryCard from './WarSummaryCard';
import WarCinematicOverlay from './WarCinematicOverlay';
import CloseButton from './CloseButton';
import { usePauseOnHidden } from '../hooks/usePauseOnHidden';
import { formatYear } from '../lib/format';

interface WarPlaybackProps {
  onBattleFocus: (battle: Battle) => void;
  onBattlesLoaded: (battles: Battle[] | null) => void;
  onClose: () => void;
  // onWarSelected fires whenever the user picks a war from the war list. App
  // uses it to clear any open battle detail panel and any single-battle
  // isolation so the user can take in every battle of the chosen war on the
  // globe at once before clicking into one.
  onWarSelected?: (warName: string) => void;
  // onPlayReplay is fired in cinematic mode when the auto-step lands on a
  // battle that has a hand-crafted phase replay. App opens the replay
  // overlay. WarPlayback continues its own timer and fires onCloseReplay
  // when ready to advance to the next battle.
  onPlayReplay?: (battle: Battle) => void;
  onCloseReplay?: () => void;
  // initialWar optionally pre-selects a war on mount so an external action
  // (search-bar war click, deep link, etc.) can open WarPlayback already
  // pointing at the war the user named.
  initialWar?: string;
}

interface WarCount {
  name: string;
  count: number;
  minYear: number;
  casualties: number;
  parent?: string;
  rolledCount: number;
  rolledCasualties: number;
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

export default function WarPlayback({ onBattleFocus, onBattlesLoaded, onClose, onWarSelected, onPlayReplay, onCloseReplay, initialWar }: WarPlaybackProps) {
  const [wars, setWars] = useState<WarCount[]>([]);
  const [warSearch, setWarSearch] = useState('');
  const [warSort, setWarSort] = useState<'casualties' | 'battles' | 'alpha' | 'chrono'>('casualties');
  const [selectedWar, setSelectedWar] = useState(initialWar || '');
  const [battles, setBattles] = useState<Battle[]>([]);
  const [groups, setGroups] = useState<BattleGroup[]>([]);
  const [groupIndex, setGroupIndex] = useState(0);
  const [subIndex, setSubIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const [speed, setSpeed] = useState(4000);
  const [detail, setDetail] = useState<Battle | null>(null);
  // cinematicStage drives the full-screen war overlay: an opening title
  // card before the first battle plays, the playthrough itself, then a
  // closing aftermath card. The existing per-battle playback loop runs
  // unchanged under the 'playing' stage; the overlay is purely additive.
  const [cinematicStage, setCinematicStage] = useState<'none' | 'overture' | 'playing' | 'aftermath'>('none');
  // warSummary mirrors the data the WarSummaryCard fetches so the
  // cinematic overlay can show outcome and aftermath text on the
  // closing card without a second round trip.
  const [warSummary, setWarSummary] = useState<{ outcome?: string; aftermath?: string; notable?: string[]; yearStart: number; yearEnd: number; battleCount: number; totalCasualties: number; finalVictor?: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
    if (!selectedWar) { setBattles([]); setGroups([]); onBattlesLoaded(null); return; }
    fetch(`/api/battles?war=${encodeURIComponent(selectedWar)}&limit=2000`)
      .then((r) => r.json())
      .then((d) => {
        // The backend now orders by (year, date_start) so any consumer of
        // the battles API receives chronological order. Trust it; do not
        // re-sort here.
        const b: Battle[] = d.battles || [];
        setBattles(b);
        setGroups(groupConcurrentBattles(b));
        setGroupIndex(0);
        setSubIndex(0);
        setPlaying(false);
        setDetail(null);
        onBattlesLoaded(b);
      })
      .catch(() => {});
  }, [selectedWar, onBattlesLoaded, onWarSelected]);

  // Stop the war auto-step when the tab is hidden or the window blurs. Same
  // motivation as the replay version: nobody wants to come back and find
  // their war scrubbed silently to the last battle.
  usePauseOnHidden(useCallback(() => setPlaying(false), []));

  // Fetch the war summary for the cinematic overlay. Same endpoint the
  // WarSummaryCard uses; keeping a local copy lets the overlay render its
  // closing aftermath card without waiting on a child re-render.
  useEffect(() => {
    if (!selectedWar) { setWarSummary(null); return; }
    let cancelled = false;
    fetch(`/api/wars/summary?name=${encodeURIComponent(selectedWar)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (!cancelled && s) setWarSummary(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedWar]);

  // Deduplicated belligerent labels surfaced on the cinematic opening
  // card. Pulled from each battle's sides[].name set rather than from
  // war metadata because the war record does not carry sides.
  const cinematicSides = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const b of battles) {
      for (const s of b.sides || []) {
        const name = (s.name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
        if (out.length >= 6) return out;
      }
    }
    return out;
  }, [battles]);

  const focusBattle = useCallback((battle: Battle) => {
    onBattleFocus(battle);
    fetch(`/api/battles/${battle.id}`).then((r) => r.json()).then(setDetail).catch(() => setDetail(battle));
  }, [onBattleFocus]);

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
    if (groupIndex === 0 && subIndex === 0) return;
    focusBattle(groups[groupIndex].battles[subIndex]);
  }, [groups, groupIndex, subIndex, focusBattle]);

  useEffect(() => {
    if (!playing || groups.length === 0) return;
    const group = groups[groupIndex];
    const battle = group.battles[subIndex];

    // Focus the current battle the moment Play starts. Without this the user
    // hits Play, the globe stays parked at the war centroid, and nothing
    // visibly happens until the first dwell timer expires, which reads as
    // "playback is broken". Focusing here means the camera flies to the
    // first battle immediately and the panel opens.
    focusBattle(battle);

    // Cinematic mode: open the replay (hand-crafted OR auto-generated
    // schematic) for the current battle and dwell long enough for the phases
    // to play. Without hasSchematic in the check, cinematic only fired for
    // the ~46 hand-crafted replays out of 12k battles — so every war except
    // a handful made cinematic look broken.
    const isCinematic = cinematic && !!onPlayReplay && (battle?.hasReplay || battle?.hasSchematic);
    if (isCinematic && onPlayReplay) {
      onPlayReplay(battle);
    }
    // ~7s per phase is what BattleReplay plays at the default speed.
    // Approximate replay length without round-tripping for the phases JSON:
    // most replays we hand-craft run 4-5 phases, so ~30s gives a full pass.
    const dwellMs = isCinematic
      ? 32000
      : group.concurrent && subIndex < group.battles.length - 1
      ? Math.max(speed / 2, 1500)
      : speed;

    timerRef.current = setTimeout(() => {
      if (isCinematic && onCloseReplay) onCloseReplay();
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
        // a proper closing beat. Falls through silently for a non-
        // cinematic run; the WarSummaryCard already emphasizes itself.
        if (cinematicStage === 'playing') {
          setCinematicStage('aftermath');
        }
      }
    }, dwellMs);
    return () => clearTimeout(timerRef.current);
    // focusBattle and goTo are intentionally omitted from deps. They are
    // stable callbacks built from props, but adding them re-runs this effect
    // on every render and breaks the dwell timer mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, groupIndex, subIndex, groups, speed, cinematic, onPlayReplay, onCloseReplay]);

  // Build a hierarchical tree: top-level wars at depth 0, child theaters and
  // campaigns nested below their parent. The "Bloodiest" and "Most Battles"
  // sorts use the rolled totals so parents always rank above their children.
  const sortKey = (w: WarCount): number => {
    if (warSort === 'casualties') return -(w.rolledCasualties || w.casualties);
    if (warSort === 'battles') return -(w.rolledCount || w.count);
    if (warSort === 'chrono') return w.minYear;
    return 0;
  };

  const tree = (() => {
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
    const flat: Array<WarCount & { depth: number }> = [];
    for (const p of topSorted) {
      flat.push({ ...p, depth: 0 });
      const kids = (childrenByParent.get(p.name) ?? []).slice().sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const k of kids) flat.push({ ...k, depth: 1 });
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
          const v = w.depth === 0 ? w.rolledCasualties || w.casualties : w.casualties;
          return v > 0;
        })
      : tree;
  const filteredWars = warSearch
    ? bloodFiltered.filter((w) => w.name.toLowerCase().includes(warSearch.toLowerCase()))
    : bloodFiltered;

  const currentGroup = groups[groupIndex];
  const currentBattle = currentGroup?.battles[subIndex];
  const totalIdx = groups.slice(0, groupIndex).reduce((s, g) => s + g.battles.length, 0) + subIndex;

  // Two distinct shells: a centered modal while the user is browsing the war
  // list (the globe doesn't help here, the list is what matters), and a slim
  // right-side pane once a war is chosen (the globe takes the stage and the
  // pane carries the controls and metadata out of the way).
  if (!selectedWar) {
    return (
      <div
        className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-sm p-6"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="w-[480px] max-w-[92vw] bg-[#0f1019]/95 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[78vh]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 flex-shrink-0">
            <h3 className="text-xs font-semibold text-white tracking-wide uppercase">Choose a war</h3>
            <CloseButton onClick={onClose} label="Back to the globe (Esc)" />
          </div>
          <div className="p-4 overflow-y-auto flex-1">
            <input
              type="text"
              value={warSearch}
              onChange={(e) => setWarSearch(e.target.value)}
              placeholder="Find a war..."
              className="w-full h-9 px-3 mb-2 bg-[#1e2030] border border-slate-600/40 rounded-lg text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-blue-400/60"
            />
            <div className="flex gap-1 mb-2">
              {([['casualties', 'Bloodiest'], ['battles', 'Most Battles'], ['chrono', 'Oldest First'], ['alpha', 'A-Z']] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setWarSort(key)}
                  className={`h-6 px-2 rounded text-[10px] font-medium transition-colors ${
                    warSort === key
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-[#1e2030] text-slate-500 border border-slate-700/30 hover:text-slate-300'
                  }`}
                >{label}</button>
              ))}
            </div>
            <div className="space-y-0.5 pr-1">
              {filteredWars.map((w) => {
                const showVal =
                  warSort === 'casualties'
                    ? (w.depth === 0 ? w.rolledCasualties : w.casualties)
                    : warSort === 'chrono'
                    ? w.minYear
                    : (w.depth === 0 ? w.rolledCount : w.count);
                return (
                  <button
                    key={w.name}
                    onClick={() => setSelectedWar(w.name)}
                    className={`w-full text-left rounded-lg text-[13px] hover:bg-slate-800/50 hover:text-white transition-colors flex justify-between items-center ${
                      w.depth === 0
                        ? 'px-3 py-2 text-slate-300 font-medium'
                        : 'pl-7 pr-3 py-1.5 text-slate-400 text-[12px]'
                    }`}
                  >
                    <span className="truncate pr-2">
                      {w.depth > 0 && (
                        <span className="text-slate-700 mr-1" aria-hidden="true">└</span>
                      )}
                      {w.name}
                    </span>
                    <span className="text-[10px] text-slate-600 flex-shrink-0 tabular-nums">
                      {warSort === 'casualties' && showVal > 0
                        ? `${(showVal / 1000).toFixed(0)}k`
                        : warSort === 'chrono'
                        ? formatYear(showVal)
                        : `${showVal}`}
                    </span>
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
      {/* Header gives the user two unambiguous exits in fixed positions:
          a back arrow on the left that returns to the war picker (one
          level up), and the standard X close on the right that exits the
          mode entirely back to the globe. Previously the back affordance
          was a near-invisible slate-500 text link buried inside the
          scroll area, which made the level-up gesture undiscoverable. */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800/60 flex-shrink-0 gap-2">
        <button
          onClick={() => { setSelectedWar(''); setPlaying(false); setDetail(null); }}
          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-slate-900/55 backdrop-blur border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-slate-500/80 transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-300/70"
          aria-label="Back to wars list"
          title="Back to wars list"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" aria-hidden="true">
            <path d="M9 2 L4 7 L9 12" />
          </svg>
        </button>
        <h3 className="text-xs font-semibold text-white tracking-wide uppercase truncate flex-1 min-w-0 text-center">
          {selectedWar}
        </h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-slate-500">{battles.length}</span>
          <CloseButton onClick={onClose} label="Back to the globe (Esc)" />
        </div>
      </div>

      <div className="p-4 overflow-y-auto flex-1">
        {currentBattle && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ERA_COLORS[currentBattle.era] || '#fff' }} />
              <span className="text-[15px] font-semibold text-white">{currentBattle.name}</span>
            </div>
            <p className="text-[12px] text-slate-400 mb-2">{currentBattle.date} &middot; {formatYear(currentBattle.year)}</p>

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

            {detail?.summary && (
              <p className="text-[12px] text-slate-400 leading-relaxed line-clamp-3">{detail.summary}</p>
            )}
          </div>
        )}

        {/* The "Trace this war" button is the cinematic entry point. Lifts
            the user out of the per-battle stepper into a full-screen
            overtüre, then plays the campaign end-to-end and lands on an
            aftermath card. Reserved for wars with at least two battles
            so it does not pretend a single-battle war has a campaign
            arc to it. */}
        {battles.length >= 2 && (
          <button
            onClick={() => {
              setCinematic(true);
              setCinematicStage('overture');
              setGroupIndex(0);
              setSubIndex(0);
              setPlaying(false);
            }}
            className="w-full mb-3 group relative overflow-hidden rounded-lg border border-blue-500/40 bg-gradient-to-r from-blue-500/15 to-blue-500/5 hover:from-blue-500/25 hover:to-blue-500/10 transition-colors px-3 py-2.5 text-left"
            title="Begin a cinematic trace of the whole war: opening title, every battle in sequence, closing aftermath."
          >
            <div className="text-[10px] uppercase tracking-[0.22em] text-blue-300/90">Trace the campaign</div>
            <div className="text-[12.5px] text-white mt-0.5">
              ▶ Cinematic, end to end
              <span className="text-slate-400/80 ml-2 text-[11px]">{battles.length} battles</span>
            </div>
          </button>
        )}

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <button onClick={() => goTo(groupIndex - 1)} disabled={groupIndex === 0}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 transition-all text-xs">&larr;</button>
            <button onClick={() => setPlaying(!playing)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-all">
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => goTo(groupIndex + 1)} disabled={groupIndex >= groups.length - 1}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white disabled:opacity-20 transition-all text-xs">&rarr;</button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const next = !cinematic;
                setCinematic(next);
                // Toggling cinematic ON should do something visible right now,
                // not on the next dwell. Fire the replay for the currently
                // focused battle immediately when it has one. Also enables
                // auto-play so the rest of the war keeps going.
                if (next && currentBattle && onPlayReplay &&
                    (currentBattle.hasReplay || currentBattle.hasSchematic)) {
                  onPlayReplay(currentBattle);
                  setPlaying(true);
                }
                // Toggling OFF: close any open replay so the panel state matches.
                if (!next && onCloseReplay) {
                  onCloseReplay();
                }
              }}
              title="Cinematic mode: opens the replay for each battle and plays through before advancing."
              className={`h-7 px-2.5 rounded text-[10px] font-medium tracking-wide transition-colors ${
                cinematic
                  ? 'bg-blue-500/25 text-blue-200 border border-blue-500/40'
                  : 'bg-[#1e2030] text-slate-400 border border-slate-700/30 hover:text-slate-300'
              }`}
            >Cinematic</button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}
              className="bg-[#1e2030] border border-slate-700/30 rounded px-2 py-1 text-[10px] text-slate-400">
              <option value={6000}>Slow</option>
              <option value={4000}>Normal</option>
              <option value={2500}>Fast</option>
              <option value={1200}>Rapid</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-600 w-14 tabular-nums">{totalIdx + 1}/{battles.length}</span>
          <input type="range" min={0} max={Math.max(0, groups.length - 1)} value={groupIndex}
            onChange={(e) => { setPlaying(false); goTo(parseInt(e.target.value)); }}
            className="flex-1 accent-blue-500 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer" />
        </div>

        {/* How-it-ended card. Always visible while browsing a war so the
            outcome and stats are an anchor for the user. Auto-emphasized
            (expanded + blue border) when playback reaches the last
            battle, fulfilling the "every war story ends with how the war
            was won" rule. */}
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
      </div>
      {/* Cinematic full-screen overlay. Mounted via portal-style fixed
          positioning rather than inside the side panel so the title
          card owns the whole viewport, not just a 420px column. */}
      <WarCinematicOverlay
        stage={cinematicStage === 'overture' ? 'overture' : cinematicStage === 'aftermath' ? 'aftermath' : 'none'}
        warName={selectedWar}
        summary={warSummary}
        sides={cinematicSides}
        onDismiss={() => {
          // Skipping the overture: keep cinematic mode on and start
          // playing immediately. Dismissing the aftermath: stop the
          // cinematic stage and stay on the war detail panel.
          if (cinematicStage === 'overture') {
            setCinematicStage('playing');
            setPlaying(true);
          } else if (cinematicStage === 'aftermath') {
            setCinematicStage('none');
          }
        }}
        onBegin={() => {
          setCinematicStage('playing');
          setPlaying(true);
        }}
      />
    </div>
  );
}
