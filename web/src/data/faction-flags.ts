// Faction → flag image resolver with period gating.
//
// Modern country flags come from flagcdn.com — a free, fast CDN with
// 250+ ISO country flags as PNGs at predictable URLs.
//
// Historically iconic regime flags (Nazi banner with swastika, USSR
// hammer-and-sickle, Imperial Russia / Vichy tricolours, etc.) live
// in /public/flags/historic/ as committed SVGs. These are kept local
// because Wikimedia Commons rate-limits anonymous image requests and
// we don't want broken flags on every load.
//
// Each faction maps to one or more period-gated flag sources. When a
// caller asks for the flag at year Y, we walk the list and return the
// first source whose [minYear, maxYear] window contains Y. If nothing
// matches, returns null and the renderer falls back to the editorial
// typography label alone.

interface FlagSource {
  url: string;
  minYear: number;
  maxYear: number;
}

// Helpers so the map below stays readable.
const flagcdn = (iso: string): string => `https://flagcdn.com/h60/${iso}.png`;
const historic = (slug: string): string => `/flags/historic/${slug}.svg`;

export const FACTION_FLAGS: Record<string, FlagSource[]> = {
  // ── Twentieth-century iconic regimes (period-gated) ──────────────
  'nazi-germany': [
    { url: historic('nazi-germany'), minYear: 1933, maxYear: 1945 },
  ],
  'imperial-germany': [
    { url: historic('imperial-germany'), minYear: 1867, maxYear: 1918 },
  ],
  'germany': [
    { url: historic('imperial-germany'), minYear: 1867, maxYear: 1918 },
    { url: historic('nazi-germany'), minYear: 1933, maxYear: 1945 },
    { url: flagcdn('de'), minYear: 1949, maxYear: 9999 },
  ],
  'vichy': [
    { url: historic('vichy'), minYear: 1940, maxYear: 1944 },
  ],
  'ussr': [
    { url: historic('ussr'), minYear: 1922, maxYear: 1991 },
  ],
  'soviet-union': [
    { url: historic('ussr'), minYear: 1922, maxYear: 1991 },
  ],
  'russia': [
    { url: historic('imperial-russia'), minYear: 1721, maxYear: 1917 },
    { url: historic('ussr'), minYear: 1922, maxYear: 1991 },
    { url: flagcdn('ru'), minYear: 1991, maxYear: 9999 },
  ],
  'imperial-japan': [
    { url: historic('imperial-japan'), minYear: 1868, maxYear: 1945 },
  ],
  'imperial-russia': [
    { url: historic('imperial-russia'), minYear: 1721, maxYear: 1917 },
  ],

  // ── Modern country flags ─────────────────────────────────────────
  'uk': [{ url: flagcdn('gb'), minYear: 1801, maxYear: 9999 }],
  'british-empire': [{ url: flagcdn('gb'), minYear: 1707, maxYear: 1997 }],
  'kingdom-england': [{ url: flagcdn('gb'), minYear: 927, maxYear: 1707 }],
  'kingdom-scotland': [{ url: flagcdn('gb'), minYear: 843, maxYear: 1707 }],
  'commonwealth': [{ url: flagcdn('gb'), minYear: 1707, maxYear: 9999 }],
  'us': [{ url: flagcdn('us'), minYear: 1776, maxYear: 9999 }],
  'us-union': [{ url: flagcdn('us'), minYear: 1776, maxYear: 9999 }],
  'continental-army': [{ url: flagcdn('us'), minYear: 1775, maxYear: 1783 }],
  'us-puerto-rico': [{ url: flagcdn('us'), minYear: 1898, maxYear: 9999 }],
  'us-confederacy': [
    { url: historic('us-confederacy'), minYear: 1861, maxYear: 1865 },
  ],
  'france': [{ url: flagcdn('fr'), minYear: 1794, maxYear: 9999 }],
  'french-empire': [{ url: flagcdn('fr'), minYear: 1794, maxYear: 9999 }],
  'kingdom-france-bourbon': [{ url: flagcdn('fr'), minYear: 1589, maxYear: 1792 }],
  'italy': [
    { url: historic('kingdom-italy'), minYear: 1861, maxYear: 1946 },
    { url: flagcdn('it'), minYear: 1946, maxYear: 9999 },
  ],
  'kingdom-italy': [{ url: historic('kingdom-italy'), minYear: 1861, maxYear: 1946 }],
  'japan': [{ url: flagcdn('jp'), minYear: 1870, maxYear: 9999 }],
  'china': [{ url: flagcdn('cn'), minYear: 1949, maxYear: 9999 }],
  'china-prc': [{ url: flagcdn('cn'), minYear: 1949, maxYear: 9999 }],
  'china-roc': [{ url: flagcdn('tw'), minYear: 1912, maxYear: 1949 }],
  'roc-china': [{ url: flagcdn('tw'), minYear: 1912, maxYear: 1949 }],
  'india': [{ url: flagcdn('in'), minYear: 1947, maxYear: 9999 }],
  'poland': [{ url: flagcdn('pl'), minYear: 966, maxYear: 9999 }],
  'spain': [{ url: flagcdn('es'), minYear: 1492, maxYear: 9999 }],
  'habsburg-spain': [{ url: flagcdn('es'), minYear: 1516, maxYear: 1700 }],
  'portugal': [{ url: flagcdn('pt'), minYear: 1143, maxYear: 9999 }],
  'mexico': [{ url: flagcdn('mx'), minYear: 1821, maxYear: 9999 }],
  'brazil': [{ url: flagcdn('br'), minYear: 1822, maxYear: 9999 }],
  'argentina': [{ url: flagcdn('ar'), minYear: 1816, maxYear: 9999 }],
  'argentina-alt': [{ url: flagcdn('ar'), minYear: 1816, maxYear: 9999 }],
  'paraguay': [{ url: flagcdn('py'), minYear: 1811, maxYear: 9999 }],
  'uruguay': [{ url: flagcdn('uy'), minYear: 1830, maxYear: 9999 }],
  'south-africa': [{ url: flagcdn('za'), minYear: 1910, maxYear: 9999 }],
  'canada': [{ url: flagcdn('ca'), minYear: 1867, maxYear: 9999 }],
  'australia': [{ url: flagcdn('au'), minYear: 1901, maxYear: 9999 }],
  'new-zealand': [{ url: flagcdn('nz'), minYear: 1907, maxYear: 9999 }],
  'south-korea': [{ url: flagcdn('kr'), minYear: 1948, maxYear: 9999 }],
  'north-korea': [{ url: flagcdn('kp'), minYear: 1948, maxYear: 9999 }],
  'north-vietnam': [{ url: flagcdn('vn'), minYear: 1945, maxYear: 1976 }],
  'south-vietnam': [{ url: flagcdn('vn'), minYear: 1955, maxYear: 1975 }],
  'viet-cong': [{ url: flagcdn('vn'), minYear: 1960, maxYear: 1976 }],
  'turkey': [{ url: flagcdn('tr'), minYear: 1923, maxYear: 9999 }],
  'ottoman': [{ url: historic('ottoman'), minYear: 1453, maxYear: 1922 }],
  'seljuk': [{ url: historic('ottoman'), minYear: 1037, maxYear: 1308 }],
  'iran': [{ url: flagcdn('ir'), minYear: 1979, maxYear: 9999 }],
  'iraq': [{ url: flagcdn('iq'), minYear: 1932, maxYear: 9999 }],
  'iraq-saddam': [{ url: flagcdn('iq'), minYear: 1979, maxYear: 2003 }],
  'iraq-government': [{ url: flagcdn('iq'), minYear: 2003, maxYear: 9999 }],
  'syria': [{ url: flagcdn('sy'), minYear: 1946, maxYear: 9999 }],
  'ukraine': [{ url: flagcdn('ua'), minYear: 1991, maxYear: 9999 }],
  'finland': [{ url: flagcdn('fi'), minYear: 1917, maxYear: 9999 }],
  'sweden': [{ url: flagcdn('se'), minYear: 1523, maxYear: 9999 }],
  'sweden-empire': [{ url: flagcdn('se'), minYear: 1611, maxYear: 1721 }],
  'netherlands': [{ url: flagcdn('nl'), minYear: 1581, maxYear: 9999 }],
  'dutch-republic': [{ url: flagcdn('nl'), minYear: 1581, maxYear: 1795 }],
  'belgium': [{ url: flagcdn('be'), minYear: 1830, maxYear: 9999 }],
  'norway': [{ url: flagcdn('no'), minYear: 1814, maxYear: 9999 }],
  'denmark': [{ url: flagcdn('dk'), minYear: 1219, maxYear: 9999 }],
  'denmark-norway': [{ url: flagcdn('dk'), minYear: 1524, maxYear: 1814 }],
  'austria': [{ url: flagcdn('at'), minYear: 1955, maxYear: 9999 }],
  'austria-hungary': [{ url: historic('austria-hungary'), minYear: 1867, maxYear: 1918 }],
  'hungary': [{ url: flagcdn('hu'), minYear: 1000, maxYear: 9999 }],
  'romania': [{ url: flagcdn('ro'), minYear: 1859, maxYear: 9999 }],
  'bulgaria': [{ url: flagcdn('bg'), minYear: 681, maxYear: 9999 }],
  'yugoslavia': [{ url: flagcdn('rs'), minYear: 1918, maxYear: 2003 }],
  'greece': [{ url: flagcdn('gr'), minYear: 1822, maxYear: 9999 }],
  'serbia': [{ url: flagcdn('rs'), minYear: 1882, maxYear: 9999 }],
};

// flagForFaction resolves the right image URL for a faction in the given
// year, walking the period-gated source list. Returns null if no source
// fits (the caller falls back to the typography label alone).
export function flagForFaction(faction: string, year: number): string | null {
  const sources = FACTION_FLAGS[faction];
  if (!sources) return null;
  for (const s of sources) {
    if (year >= s.minYear && year <= s.maxYear) return s.url;
  }
  return null;
}
