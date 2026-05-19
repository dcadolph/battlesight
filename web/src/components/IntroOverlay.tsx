import { useEffect, useRef, useState } from 'react';
import type { Battle } from '../types/battle';
import { ERA_COLORS, ERA_LABELS } from '../types/battle';
import { themeForEra } from '../theme/era';
import { formatYear } from '../lib/format';
import EyeLogo from './EyeLogo';
import CloseButton from './CloseButton';

interface IntroOverlayProps {
  featured: Battle;
  onDismiss: () => void;
  onStart: () => void;
}

// Era ticker beats. Each beat is one moment in the sweep with its own
// vignette-themed accent, label, and signature battle. The intro animation
// crossfades between these beats over a fixed duration so the user sees
// the arc of human conflict before the static featured-battle card lands.
const BEATS: Array<{
  yearLabel: string;
  era: string;
  caption: string;
  weapon: string;
}> = [
  { yearLabel: '1457 BC', era: 'ancient', caption: 'Megiddo. Chariots and slings.', weapon: 'Bronze' },
  { yearLabel: '480 BC', era: 'ancient', caption: 'Thermopylae. Phalanx in the pass.', weapon: 'Spear' },
  { yearLabel: '216 BC', era: 'ancient', caption: 'Cannae. Encirclement perfected.', weapon: 'Legion' },
  { yearLabel: '732 AD', era: 'medieval', caption: 'Tours. The Frankish line holds.', weapon: 'Sword' },
  { yearLabel: '1066', era: 'medieval', caption: 'Hastings. Norman cavalry breaks the shield wall.', weapon: 'Lance' },
  { yearLabel: '1415', era: 'medieval', caption: 'Agincourt. English longbows in the mud.', weapon: 'Longbow' },
  { yearLabel: '1571', era: 'early-modern', caption: 'Lepanto. Galleys and arquebuses.', weapon: 'Cannon' },
  { yearLabel: '1815', era: 'napoleonic', caption: 'Waterloo. Squares and the Imperial Guard.', weapon: 'Musket' },
  { yearLabel: '1916', era: 'world-war-1', caption: 'The Somme. Machine guns and barbed wire.', weapon: 'Trenches' },
  { yearLabel: '1942', era: 'world-war-2', caption: 'Stalingrad. Tanks, snipers, ruins.', weapon: 'Panzer' },
  { yearLabel: '1968', era: 'modern', caption: 'Tet. Jungle, Phantoms, Hueys.', weapon: 'Jet' },
  { yearLabel: '1991', era: 'modern', caption: 'Desert Storm. Smart bombs and recce drones.', weapon: 'Missile' },
  { yearLabel: '2024', era: 'modern', caption: 'Ukraine and Gaza. FPV drones, Iron Dome interceptors.', weapon: 'Drone' },
];

const BEAT_MS = 850;
const FADE_MS = 220;

// IntroOverlay is the cinematic gateway the user lands on the first time
// they open the app (and again on a reset). Plays through a chronological
// sweep of human conflict — Bronze Age chariots to FPV drones — with
// era-themed text and signature battle captions before settling on the
// featured-battle dossier. The globe stays visible behind the overlay so
// the user is reading the world atlas, not a SaaS modal.
export default function IntroOverlay({ featured, onDismiss, onStart }: IntroOverlayProps) {
  const color = ERA_COLORS[featured.era] || '#3b82f6';
  const theme = themeForEra(featured.era);
  const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";

  // beatIdx walks the BEATS array on a wall-clock timer. When it reaches
  // the end of the list the ticker pins to the last entry and the static
  // dossier card crossfades in.
  const [beatIdx, setBeatIdx] = useState(0);
  const [tickerDone, setTickerDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setBeatIdx((i) => {
        if (i >= BEATS.length - 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setTickerDone(true);
          return i;
        }
        return i + 1;
      });
    }, BEAT_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const beat = BEATS[beatIdx];
  const beatColor = ERA_COLORS[beat.era] || color;
  const beatLabel = ERA_LABELS[beat.era] || beat.era;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'intro-veil-in 600ms ease-out both' }}
    >
      {/* Veil. Much lighter than before so the globe behind reads through
          the overlay — the intro is meant to frame the globe, not cover
          it. Click-to-skip lands at the dossier card immediately. */}
      <button
        type="button"
        onClick={() => { setTickerDone(true); setBeatIdx(BEATS.length - 1); }}
        aria-label="Skip intro"
        className="absolute inset-0 w-full h-full cursor-default"
        style={{
          background: 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(4,6,12,0.40) 0%, rgba(4,6,12,0.78) 65%, rgba(4,6,12,0.92) 100%)',
          backdropFilter: 'blur(2px)',
        }}
      />
      {/* Era-accent bloom — tints the centre of the screen the colour of
          the currently-active beat. Crossfades smoothly as the era
          advances, so the screen "warms" from cold-blue ancient up
          through Napoleonic blue, Great-War khaki, WWII iron, into the
          modern slate. */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-700"
        style={{
          background: `radial-gradient(ellipse 75% 55% at 50% 48%, ${beatColor}33 0%, transparent 65%)`,
        }}
      />

      {/* Top-right exit. */}
      <div className="absolute top-5 right-5 z-10">
        <CloseButton onClick={onDismiss} label="Close intro (Esc)" tone="elevated" />
      </div>

      {/* Title block — sits high so the era ticker has room below. */}
      <div className="relative w-full max-w-[720px] text-center" style={{ animation: 'intro-block-in 900ms cubic-bezier(.2,.65,.25,1) both' }}>
        <div className="inline-flex items-center gap-3 mb-4" style={{ color: '#fff' }}>
          <EyeLogo size={28} color={beatColor} />
          <h1
            className="leading-[1.0] tracking-tight"
            style={{
              fontFamily: SERIF,
              fontWeight: 600,
              fontSize: 'clamp(46px, 7vw, 80px)',
              letterSpacing: '-0.018em',
              textShadow: '0 10px 40px rgba(0,0,0,0.9), 0 0 28px rgba(255,255,255,0.08)',
            }}
          >
            Battle<span style={{ color: beatColor, transition: 'color 600ms ease-out' }}>Sight</span>
          </h1>
        </div>

        <div
          className="mx-auto h-px transition-all duration-700"
          style={{
            width: 200,
            background: `linear-gradient(90deg, transparent 0%, ${beatColor} 50%, transparent 100%)`,
            boxShadow: `0 0 14px ${beatColor}88`,
          }}
        />

        <p
          className="italic text-slate-200 mx-auto mt-6 mb-10"
          style={{
            fontFamily: SERIF,
            fontSize: 16,
            lineHeight: 1.55,
            maxWidth: '52ch',
            textShadow: '0 2px 14px rgba(0,0,0,0.7)',
          }}
        >
          A world atlas of human conflict. Bronze chariots to FPV drones,
          named and replayed where the record allows.
        </p>

        {/* Era ticker. Reads as a chronological flyover — the era badge,
            year, weapon-of-the-period chip, and a one-line caption swap
            every ~850ms. The hairline rule underneath glows in the era
            accent. The eye reads "the whole arc of war is in here." */}
        {!tickerDone && (
          <div
            key={`beat-${beatIdx}`}
            className="mx-auto"
            style={{
              maxWidth: 520,
              animation: `intro-beat-in ${FADE_MS}ms ease-out both`,
            }}
          >
            <div className="flex items-center justify-center gap-3 mb-3 flex-wrap">
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-[0.24em] font-semibold"
                style={{
                  background: `${beatColor}1f`,
                  color: beatColor,
                  border: `1px solid ${beatColor}55`,
                }}
              >
                {beatLabel}
              </span>
              <span
                className="tabular-nums text-[28px] font-semibold tracking-tight text-white"
                style={{ fontFamily: SERIF, textShadow: '0 4px 18px rgba(0,0,0,0.7)' }}
              >
                {beat.yearLabel}
              </span>
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-[0.24em] font-semibold"
                style={{
                  background: 'rgba(15,18,28,0.65)',
                  color: '#cbd5e1',
                  border: '1px solid rgba(148,163,184,0.35)',
                }}
              >
                {beat.weapon}
              </span>
            </div>
            <p
              className="text-slate-200 italic"
              style={{
                fontFamily: SERIF,
                fontSize: 17,
                lineHeight: 1.45,
                textShadow: '0 2px 12px rgba(0,0,0,0.7)',
              }}
            >
              {beat.caption}
            </p>
            {/* Beat progress strip — fills as the ticker advances so the
                user has a sense of "how much more is coming." */}
            <div
              className="mx-auto mt-5 h-[2px] rounded-full overflow-hidden"
              style={{ width: 220, background: 'rgba(148,163,184,0.18)' }}
            >
              <div
                className="h-full"
                style={{
                  width: `${((beatIdx + 1) / BEATS.length) * 100}%`,
                  background: `linear-gradient(90deg, transparent 0%, ${beatColor} 50%, transparent 100%)`,
                  boxShadow: `0 0 10px ${beatColor}88`,
                  transition: 'width 700ms ease-out',
                }}
              />
            </div>
          </div>
        )}

        {/* Featured battle dossier card — only fades in after the ticker
            completes so the eye lands on the static spread last. */}
        {tickerDone && (
          <div
            className="rounded-2xl px-6 py-5 mt-2 mb-6 mx-auto text-left"
            style={{
              background: 'rgba(8,10,18,0.82)',
              border: `1px solid ${color}40`,
              boxShadow: `0 24px 56px -16px rgba(0,0,0,0.6), inset 0 1px 0 ${color}22`,
              maxWidth: 520,
              animation: 'intro-card-in 600ms cubic-bezier(.2,.65,.25,1) both',
            }}
          >
            <div className="flex items-center gap-2.5 mb-3 flex-wrap">
              <span
                className="inline-block px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-[0.2em] font-semibold"
                style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
              >
                {ERA_LABELS[featured.era] || featured.era}
              </span>
              <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                Today's featured battle
              </span>
              {featured.hasReplay && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(59,130,246,0.18)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.35)' }}
                >
                  ▶ Replay
                </span>
              )}
            </div>
            <div
              className="text-white text-[22px] font-semibold mb-1 tracking-tight"
              style={{ fontFamily: theme.titleFont }}
            >
              {featured.name}
            </div>
            <div className="text-[12px] uppercase tracking-[0.18em] text-slate-500 mb-3 tabular-nums">
              {featured.date || formatYear(featured.year)}
              {featured.war ? ` · ${featured.war}` : ''}
            </div>
            <p
              className="text-slate-300 leading-relaxed"
              style={{ fontFamily: SERIF, fontSize: 14 }}
            >
              {featured.summary || featured.significance}
            </p>
          </div>
        )}

        {/* Action row only appears after the ticker resolves. Until then
            the user can click anywhere on the veil to skip. */}
        {tickerDone && (
          <div
            className="flex flex-wrap gap-3 justify-center mb-5"
            style={{ animation: 'intro-card-in 600ms 120ms cubic-bezier(.2,.65,.25,1) both' }}
          >
            <button
              onClick={onStart}
              className="inline-flex items-center justify-center h-11 px-6 rounded-full text-[13px] font-semibold tracking-wide text-white shadow-lg transition-all hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
              style={{
                background: `linear-gradient(180deg, ${color} 0%, ${color}cc 100%)`,
                boxShadow: `0 8px 24px ${color}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
              }}
            >
              {featured.hasReplay ? 'Watch the replay' : 'Open this battle'}
            </button>
            <button
              onClick={onDismiss}
              className="inline-flex items-center justify-center h-11 px-6 rounded-full text-[13px] font-semibold tracking-wide text-slate-200 bg-transparent border border-slate-600/60 hover:bg-slate-800/50 hover:border-slate-400 transition-colors"
            >
              Explore the globe
            </button>
          </div>
        )}

        {/* Keyboard hint, plus a "skip intro" cue while the ticker runs. */}
        {!tickerDone ? (
          <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
            Click anywhere to skip · <kbd className="px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-300 not-italic mx-0.5">Esc</kbd>
          </div>
        ) : (
          <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
            Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-300 not-italic mx-0.5">/</kbd> to search · <kbd className="px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-300 not-italic mx-0.5">Esc</kbd> to close
          </div>
        )}
      </div>

      <style>{`
        @keyframes intro-veil-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes intro-block-in {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes intro-beat-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes intro-card-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
