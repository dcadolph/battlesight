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
  atmosphere: '#7ab9ff',
  vignette: 'rgba(8, 12, 24, 0.55)',
  accent: '#7ab9ff',
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
  ['ancient', -500, 500],
  ['medieval', 500, 1500],
  ['early-modern', 1500, 1700],
  ['napoleonic', 1700, 1820],
  ['industrial', 1820, 1914],
  ['world-war-1', 1914, 1919],
  ['interwar', 1919, 1939],
  ['world-war-2', 1939, 1946],
  ['modern', 1946, 2025],
];

// Serif display face for periods that feel literary: manuscripts, dispatches,
// classical histories. Modern eras get a tight technical sans to match the
// cold-war / satellite-imagery feel of their atmosphere palette.
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const SANS = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

const THEMES: Record<string, EraTheme> = {
  'ancient': {
    atmosphere: '#f4c47a',
    vignette: 'rgba(40, 22, 8, 0.65)',
    accent: '#f59e0b',
    titleFont: SERIF,
    mood: 'Antiquity',
    era: 'ancient',
  },
  'medieval': {
    atmosphere: '#d97a5a',
    vignette: 'rgba(40, 12, 10, 0.65)',
    accent: '#ef4444',
    titleFont: SERIF,
    mood: 'Medieval',
    era: 'medieval',
  },
  'early-modern': {
    atmosphere: '#b48dff',
    vignette: 'rgba(24, 14, 40, 0.6)',
    accent: '#a78bfa',
    titleFont: SERIF,
    mood: 'Early Modern',
    era: 'early-modern',
  },
  'napoleonic': {
    atmosphere: '#7aa9ff',
    vignette: 'rgba(10, 18, 38, 0.6)',
    accent: '#60a5fa',
    titleFont: SERIF,
    mood: 'Napoleonic',
    era: 'napoleonic',
  },
  'industrial': {
    atmosphere: '#94a3b8',
    vignette: 'rgba(14, 18, 28, 0.7)',
    accent: '#818cf8',
    titleFont: SANS,
    mood: 'Industrial Age',
    era: 'industrial',
  },
  'world-war-1': {
    atmosphere: '#e879b8',
    vignette: 'rgba(28, 10, 24, 0.7)',
    accent: '#f472b6',
    titleFont: SANS,
    mood: 'The Great War',
    era: 'world-war-1',
  },
  'interwar': {
    atmosphere: '#d4a574',
    vignette: 'rgba(30, 22, 10, 0.7)',
    accent: '#a16207',
    titleFont: SANS,
    mood: 'Interwar',
    era: 'interwar',
  },
  'world-war-2': {
    atmosphere: '#fb7185',
    vignette: 'rgba(28, 8, 14, 0.7)',
    accent: '#f43f5e',
    titleFont: SANS,
    mood: 'World War',
    era: 'world-war-2',
  },
  'modern': {
    atmosphere: '#5eead4',
    vignette: 'rgba(6, 18, 18, 0.6)',
    accent: '#10b981',
    titleFont: SANS,
    mood: 'Modern',
    era: 'modern',
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
  return 'modern';
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
