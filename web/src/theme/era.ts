// Era theme: maps a battle era (or any year) to a coherent visual mood.
// Owns atmosphere color, screen-edge vignette tint, accent color, and the
// display font used by story-opening surfaces (intro card, battle dossier).
// Consumed by App, BattleGlobe, and BattlePanel so the whole frame shifts
// when the user crosses into a different period of history.

export interface EraTheme {
  // Hex atmosphere color passed to react-globe.gl's atmosphereColor.
  atmosphere: string;
  // Vignette tint painted at the screen edges via a full-bleed overlay.
  vignette: string;
  // Accent color used by story-opening surfaces. Same hue as the era marker
  // dot but rebalanced for type and chrome.
  accent: string;
  // Display font for cinematic headings. System fonts only, no network cost.
  titleFont: string;
  // One-word mood descriptor shown in the era stamp on the dossier.
  mood: string;
  // Stable key so consumers can compare themes without color-string equality.
  era: string;
}

const DEFAULT_THEME: EraTheme = {
  atmosphere: '#7f9bbf',
  vignette: 'rgba(8, 12, 24, 0.55)',
  accent: '#7f9bbf',
  titleFont: "'Inter', system-ui, sans-serif",
  mood: 'History',
  era: '',
};

// Year ranges driving year-to-era resolution. Identical to TimelineSlider's
// ERA_RANGES so the play-history sweep and the slider's bands agree on where
// each era begins and ends. Exported because the history playhead paints
// faint era bands behind its scrub bar and needs the same authoritative
// boundaries the rest of the app uses.
export const ERA_RANGES: Array<[string, number, number]> = [
  // Ancient era reaches deep antiquity. The Battle of Megiddo (1457 BC)
  // is the earliest engagement we currently document; the floor at
  // -3000 leaves headroom for the Mesopotamian and Egyptian dynastic
  // wars that pre-date Megiddo for future curation.
  ['ancient', -3000, 500],
  ['medieval', 500, 1500],
  ['early-modern', 1500, 1700],
  ['napoleonic', 1700, 1820],
  ['industrial', 1820, 1914],
  ['world-war-1', 1914, 1919],
  ['interwar', 1919, 1939],
  ['world-war-2', 1939, 1946],
  // "Modern" used to span 1946 → today, which lumped Korea, Vietnam, the
  // Falklands, Desert Storm, the Yugoslav wars, Iraq, Afghanistan, and the
  // Russia-Ukraine war into a single 80-year bucket — visually flat, and
  // historiographically wrong. Split at 1991 (USSR collapses) so the Cold
  // War years read as their own era and the contemporary era frames the
  // post-Soviet, drone-and-cyber-age conflicts.
  ['cold-war', 1946, 1991],
  ['contemporary', 1991, 2030],
];

// Serif display face for periods that feel literary: manuscripts, dispatches,
// classical histories. Modern eras get a tight technical sans to match the
// cold-war / satellite-imagery feel of their atmosphere palette.
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const SANS = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

const THEMES: Record<string, EraTheme> = {
  'ancient': {
    // Muted honey-gold, not the neon amber of a warning badge.
    atmosphere: '#d8b57e',
    vignette: 'rgba(40, 22, 8, 0.65)',
    accent: '#c99a45',
    titleFont: SERIF,
    mood: 'Antiquity',
    era: 'ancient',
  },
  'medieval': {
    atmosphere: '#bf7357',
    vignette: 'rgba(40, 12, 10, 0.65)',
    accent: '#b5503f',
    titleFont: SERIF,
    mood: 'Medieval',
    era: 'medieval',
  },
  'early-modern': {
    atmosphere: '#9d8bc0',
    vignette: 'rgba(24, 14, 40, 0.6)',
    accent: '#8e7fb5',
    titleFont: SERIF,
    mood: 'Early Modern',
    era: 'early-modern',
  },
  'napoleonic': {
    atmosphere: '#7e9cbf',
    vignette: 'rgba(10, 18, 38, 0.6)',
    accent: '#6b90ba',
    titleFont: SERIF,
    mood: 'Napoleonic',
    era: 'napoleonic',
  },
  'industrial': {
    atmosphere: '#8f97a2',
    vignette: 'rgba(14, 18, 28, 0.7)',
    accent: '#7b83a6',
    titleFont: SANS,
    mood: 'Industrial Age',
    era: 'industrial',
  },
  'world-war-1': {
    atmosphere: '#bd7ba1',
    vignette: 'rgba(28, 10, 24, 0.7)',
    accent: '#b46e94',
    titleFont: SANS,
    mood: 'The Great War',
    era: 'world-war-1',
  },
  'interwar': {
    atmosphere: '#bd9a6c',
    vignette: 'rgba(30, 22, 10, 0.7)',
    accent: '#9a6a30',
    titleFont: SANS,
    mood: 'Interwar',
    era: 'interwar',
  },
  'world-war-2': {
    atmosphere: '#c1666f',
    vignette: 'rgba(28, 8, 14, 0.7)',
    accent: '#b94a53',
    titleFont: SANS,
    mood: 'World War',
    era: 'world-war-2',
  },
  'cold-war': {
    // Steel-gray atmosphere with a desaturated jade accent reads as
    // satellite-image and tactical-map: the visual vocabulary of the era.
    atmosphere: '#969ba1',
    vignette: 'rgba(14, 18, 20, 0.7)',
    accent: '#5c9d83',
    titleFont: SANS,
    mood: 'Cold War',
    era: 'cold-war',
  },
  'contemporary': {
    // Cool cyan atmosphere; drone-and-fibre digital-age feel sits a half
    // shade brighter than cold-war so the era jump reads on the timeline.
    atmosphere: '#6fb3c1',
    vignette: 'rgba(8, 18, 24, 0.6)',
    accent: '#3f95a8',
    titleFont: SANS,
    mood: 'Contemporary',
    era: 'contemporary',
  },
  // Legacy alias for stale 'modern' era keys (pre-split battles in the
  // DB, in-flight payloads, etc.). Reads as the contemporary theme so any
  // path that still hands us 'modern' continues to render sanely.
  'modern': {
    atmosphere: '#6fb3c1',
    vignette: 'rgba(8, 18, 24, 0.6)',
    accent: '#3f95a8',
    titleFont: SANS,
    mood: 'Contemporary',
    era: 'contemporary',
  },
};

// themeForEra returns the theme for a known era key, or a neutral default.
export function themeForEra(era: string | undefined | null): EraTheme {
  if (!era) return DEFAULT_THEME;
  return THEMES[era] ?? DEFAULT_THEME;
}

// eraForYear classifies a year into one of the named eras. Used by the
// play-history mode to advance the global theme as the year ticker climbs.
export function eraForYear(year: number): string {
  for (const [name, lo, hi] of ERA_RANGES) {
    if (year >= lo && year < hi) return name;
  }
  return 'contemporary';
}

// themeForYear is sugar over eraForYear → themeForEra, the most common call
// pattern in the playback loop.
export function themeForYear(year: number): EraTheme {
  return themeForEra(eraForYear(year));
}

// blendThemes linearly interpolates two themes across hex color channels so
// crossings between eras read as a wash rather than a hard cut. t is clamped
// to [0, 1]. Non-color fields snap to the destination theme once t >= 0.5.
export function blendThemes(from: EraTheme, to: EraTheme, t: number): EraTheme {
  const k = Math.max(0, Math.min(1, t));
  return {
    atmosphere: mixHex(from.atmosphere, to.atmosphere, k),
    vignette: mixRgba(from.vignette, to.vignette, k),
    accent: mixHex(from.accent, to.accent, k),
    titleFont: k < 0.5 ? from.titleFont : to.titleFont,
    mood: k < 0.5 ? from.mood : to.mood,
    era: k < 0.5 ? from.era : to.era,
  };
}

function mixHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function mixRgba(a: string, b: string, t: number): string {
  const pa = parseRgba(a);
  const pb = parseRgba(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  const al = pa[3] + (pb[3] - pa[3]) * t;
  return `rgba(${r}, ${g}, ${bl}, ${al.toFixed(3)})`;
}

function parseRgba(s: string): [number, number, number, number] | null {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => p.trim());
  if (parts.length < 3) return null;
  const r = parseFloat(parts[0]);
  const g = parseFloat(parts[1]);
  const b = parseFloat(parts[2]);
  const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
  return [r, g, b, a];
}
