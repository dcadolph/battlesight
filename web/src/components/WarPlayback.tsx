import { useState, useEffect, useRef, useCallback } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS } from '../types/battle';

interface WarPlaybackProps {
  onBattleFocus: (battle: Battle) => void;
  onBattlesLoaded: (battles: Battle[] | null) => void;
  onClose: () => void;
  // onPlayReplay is fired in cinematic mode when the auto-step lands on a
  // battle that has a hand-crafted phase replay. App opens the replay
  // overlay; WarPlayback continues its own timer and fires onCloseReplay
  // when ready to advance to the next battle.
  onPlayReplay?: (battle: Battle) => void;
  onCloseReplay?: () => void;
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

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BC` : `${year}`;
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

export default function WarPlayback({ onBattleFocus, onBattlesLoaded, onClose, onPlayReplay, onCloseReplay }: WarPlaybackProps) {
  const [wars, setWars] = useState<WarCount[]>([]);
  const [warSearch, setWarSearch] = useState('');
  const [warSort, setWarSort] = useState<'casualties' | 'battles' | 'alpha' | 'chrono'>('casualties');
  const [selectedWar, setSelectedWar] = useState('');
  const [battles, setBattles] = useState<Battle[]>([]);
  const [groups, setGroups] = useState<BattleGroup[]>([]);
  const [groupIndex, setGroupIndex] = useState(0);
  const [subIndex, setSubIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const [speed, setSpeed] = useState(4000);
  const [detail, setDetail] = useState<Battle | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetch('/api/battles/stats')
      .then((r) => r.json())
      .then((d) => {
        setWars((d.wars || []).filter((w: WarCount) => w.count >= 3));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedWar) { setBattles([]); setGroups([]); onBattlesLoaded(null); return; }
    fetch(`/api/battles?war=${encodeURIComponent(selectedWar)}&limit=2000`)
      .then((r) => r.json())
      .then((d) => {
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
  }, [selectedWar, onBattlesLoaded]);

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

  useEffect(() => {
    if (groups.length > 0 && groupIndex === 0 && subIndex === 0) focusBattle(groups[0].battles[0]);
  }, [groups, groupIndex, subIndex, focusBattle]);

  useEffect(() => {
    if (!playing || groups.length === 0) return;
    const group = groups[groupIndex];
    const battle = group.battles[subIndex];

    // Cinematic mode: when the current battle has a hand-crafted replay,
    // open it and dwell long enough for the phases to play before advancing.
    // Battles without a replay dwell at the normal speed.
    const isCinematic = cinematic && !!onPlayReplay && battle?.hasReplay;
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
      }
    }, dwellMs);
    return () => clearTimeout(timerRef.current);
  }, [playing, groupIndex, subIndex, groups, speed, cinematic, onPlayReplay, onCloseReplay, focusBattle, goTo]);

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

  const filteredWars = warSearch
    ? tree.filter((w) => w.name.toLowerCase().includes(warSearch.toLowerCase()))
    : tree;

  const currentGroup = groups[groupIndex];
  const currentBattle = currentGroup?.battles[subIndex];
  const totalIdx = groups.slice(0, groupIndex).reduce((s, g) => s + g.battles.length, 0) + subIndex;

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-30 w-[540px] max-w-[95vw]">
      <div className="bg-[#12131a] border border-slate-700/50 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/50">
          <h3 className="text-xs font-semibold text-white tracking-wide uppercase">
            {selectedWar || 'Choose a war'}
          </h3>
          <div className="flex items-center gap-2">
            {selectedWar && <span className="text-[10px] text-slate-500">{battles.length} battles</span>}
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:text-white hover:bg-slate-700 transition-all text-xs">&times;</button>
          </div>
        </div>

        <div className="p-4">
          {!selectedWar ? (
            <div>
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
              <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
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
          ) : (
            <div>
              <button
                onClick={() => { setSelectedWar(''); setPlaying(false); setDetail(null); }}
                className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors mb-3 block"
              >&larr; Back</button>

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
                    onClick={() => setCinematic((c) => !c)}
                    title="Cinematic mode: when the next battle has a phase replay, open it and play through before advancing."
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
