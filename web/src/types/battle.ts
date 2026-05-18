export interface Side {
  name: string;
  commander: string;
  strength: string;
  casualties: string;
}

export interface Alias {
  // name is the alternative name itself (e.g. "Battle of Sharpsburg").
  name: string;
  // by is the belligerent or tradition that used this name (e.g.
  // "Confederate"). Optional. When omitted the alias renders as just an
  // alternative name without an attributed perspective.
  by?: string;
}

export interface Reference {
  type: string;
  title: string;
  author?: string;
  year?: number;
  url?: string;
  note?: string;
}

export interface Battle {
  id: string;
  name: string;
  aliases?: Alias[];
  year: number;
  date: string;
  lat: number;
  lng: number;
  era: string;
  war: string;
  battleType: string;
  sides: Side[];
  victor: string;
  summary: string;
  significance: string;
  references?: Reference[];
  verified?: boolean;
  source?: string;
  hasReplay?: boolean;
  hasSchematic?: boolean;
  wikipediaTitle?: string;
  tier?: 'reconstructed' | 'documented' | 'indexed';
}

export const TIER_LABELS: Record<string, string> = {
  reconstructed: 'Reconstructed',
  documented: 'Documented',
  indexed: 'Indexed',
};

export const TIER_DESCRIPTIONS: Record<string, string> = {
  reconstructed: 'Hand-built phase-by-phase replay; commanders, sides, and dates have been hand-checked.',
  documented: 'Curated entry or imported with a full set of sides, dates, and a clean war attribution.',
  indexed: 'Wikidata-harvested pointer. Coordinates and name only; treat as a deep link to Wikipedia.',
};

export const ERA_COLORS: Record<string, string> = {
  'ancient': '#f59e0b',
  'medieval': '#ef4444',
  'early-modern': '#8b5cf6',
  'napoleonic': '#3b82f6',
  'industrial': '#6366f1',
  'world-war-1': '#ec4899',
  // Interwar reads as a "tarnished amber" between the two world wars,
  // distinct from ancient's brighter #f59e0b. Without this slot the 341
  // interwar battles fall back to the white fallback in BattleGlobe and
  // render as bright white pillars.
  'interwar': '#a16207',
  'world-war-2': '#f43f5e',
  // Cold-war = desaturated jade (tactical-map / satellite-imagery feel).
  // Contemporary = cooler cyan (drone-and-cyber digital age). The two
  // colours sit close enough on the wheel that the era boundary at 1991
  // reads as a half-step shift rather than a hard cut, but distinct enough
  // that Vietnam (cold-war) and Russia-Ukraine (contemporary) never share
  // a globe colour.
  'cold-war': '#34d399',
  'contemporary': '#06b6d4',
  // Legacy alias. The era taxonomy split 'modern' into 'cold-war' +
  // 'contemporary'; the JSON files and the SQLite DB have been migrated,
  // but a stale row or in-flight payload can still carry the old key.
  // Mapping it to the contemporary colour keeps the marker from rendering
  // as the white fallback and prevents undefined-color crashes downstream.
  'modern': '#06b6d4',
};

export const ERA_LABELS: Record<string, string> = {
  'ancient': 'Ancient',
  'medieval': 'Medieval',
  'early-modern': 'Early Modern',
  // "Napoleonic" was the historical short-hand for this era key, but it is a
  // Western European lens that reads as strange when applied to a battle in
  // Qing China or Mughal India during the same window. "Age of Revolutions"
  // is the academic shorthand that covers the same 1700-1820 period in a
  // globally-applicable way (American, French, Haitian, Latin American
  // revolutions, plus the Napoleonic Wars themselves). Per-battle context
  // (e.g. "Napoleonic Wars", "Qing Dynasty", "Late Mughal") surfaces from
  // regionalEraContext below so the era label reads relevant in every
  // hemisphere.
  'napoleonic': 'Age of Revolutions',
  'industrial': 'Industrial Age',
  'world-war-1': 'World War I',
  'interwar': 'Interwar',
  'world-war-2': 'World War II',
  // "Modern" used to span 1946 → today, which lumped Korea, Vietnam, Iraq,
  // and Russia-Ukraine into a single bucket and read as a junk drawer.
  // Split at 1991: cold war ends with the Soviet collapse, contemporary
  // takes over with the post-Soviet, post-Gulf-War conflicts.
  'cold-war': 'Cold War',
  'contemporary': 'Contemporary',
  // Legacy alias for any stale 'modern' row that slipped through the DB
  // migration. Reads as the contemporary label so the dossier still has a
  // sensible title.
  'modern': 'Contemporary',
};

// regionalEraContext returns a finer-grained historical context label for a
// battle by combining the era key with the battle's geographic region. Used
// alongside ERA_LABELS in the dossier and outro so an 1815 battle on the
// Indus reads as "Age of Revolutions · Late Mughal" rather than only "Age
// of Revolutions". Returns an empty string when no specific local context
// fits, in which case the caller renders the era alone.
export function regionalEraContext(era: string, lat: number, lng: number): string {
  if (era === 'napoleonic') {
    if (lng >= -10 && lng <= 40 && lat >= 35 && lat <= 72) return 'Napoleonic Wars';
    if (lng >= -130 && lng <= -50 && lat >= 20 && lat <= 60) return 'Revolutionary America';
    if (lng >= -90 && lng <= -30 && lat >= -56 && lat <= 25) return 'Latin American Independence';
    if (lng >= 60 && lng <= 100 && lat >= 5 && lat <= 40) return 'Late Mughal · East India Company';
    if (lng >= 100 && lng <= 145 && lat >= 18 && lat <= 55) return 'Qing Dynasty';
    if (lng >= 128 && lng <= 146 && lat >= 30 && lat <= 46) return 'Edo Period';
    if (lng >= 24 && lng <= 65 && lat >= 12 && lat <= 42) return 'Ottoman Empire';
    return '';
  }
  if (era === 'industrial') {
    if (lng >= -10 && lng <= 40 && lat >= 35 && lat <= 72) return 'European Industrial Powers';
    if (lng >= -130 && lng <= -65 && lat >= 24 && lat <= 60) return 'American Expansion · Civil War';
    if (lng >= 60 && lng <= 100 && lat >= 5 && lat <= 40) return 'British Raj';
    if (lng >= 100 && lng <= 145 && lat >= 18 && lat <= 55) return 'Late Qing · Meiji';
    if (lng >= 128 && lng <= 146 && lat >= 30 && lat <= 46) return 'Meiji Restoration';
    if (lng >= 24 && lng <= 65 && lat >= 12 && lat <= 42) return 'Ottoman Decline';
    if (lng >= -20 && lng <= 55 && lat >= -35 && lat <= 35) return 'Scramble for Africa';
    return '';
  }
  if (era === 'early-modern') {
    if (lng >= -10 && lng <= 40 && lat >= 35 && lat <= 72) return 'Wars of Religion · Early Empire';
    if (lng >= 100 && lng <= 145 && lat >= 18 && lat <= 55) return 'Ming · Qing transition';
    if (lng >= 128 && lng <= 146 && lat >= 30 && lat <= 46) return 'Sengoku · Tokugawa';
    if (lng >= 60 && lng <= 100 && lat >= 5 && lat <= 40) return 'Mughal Empire';
    if (lng >= 24 && lng <= 65 && lat >= 12 && lat <= 42) return 'Ottoman Empire at zenith';
    return '';
  }
  if (era === 'medieval') {
    if (lng >= -10 && lng <= 40 && lat >= 35 && lat <= 72) return 'European Middle Ages';
    if (lng >= 100 && lng <= 145 && lat >= 18 && lat <= 55) return 'Tang · Song · Yuan · Ming';
    if (lng >= 128 && lng <= 146 && lat >= 30 && lat <= 46) return 'Heian · Kamakura · Muromachi';
    if (lng >= 24 && lng <= 65 && lat >= 12 && lat <= 42) return 'Caliphates · Crusader states';
    if (lng >= 60 && lng <= 100 && lat >= 5 && lat <= 40) return 'Delhi Sultanate · Vijayanagara';
    return '';
  }
  if (era === 'ancient') {
    if (lng >= -10 && lng <= 40 && lat >= 35 && lat <= 50) return 'Mediterranean Antiquity';
    if (lng >= 30 && lng <= 60 && lat >= 22 && lat <= 45) return 'Near East · Persia';
    if (lng >= 100 && lng <= 130 && lat >= 18 && lat <= 45) return 'Imperial China';
    if (lng >= 60 && lng <= 100 && lat >= 5 && lat <= 40) return 'Indian Antiquity';
    return '';
  }
  if (era === 'cold-war') {
    if (lng >= 60 && lng <= 130 && lat >= 5 && lat <= 30) return 'Indochina · Korea';
    if (lng >= -130 && lng <= -65 && lat >= 7 && lat <= 30) return 'Latin American Cold War';
    if (lng >= -10 && lng <= 50 && lat >= 35 && lat <= 60) return 'Iron Curtain';
    if (lng >= 60 && lng <= 95 && lat >= 28 && lat <= 42) return 'Soviet-Afghan War';
    if (lng >= 25 && lng <= 60 && lat >= 12 && lat <= 36) return 'Arab–Israeli wars';
    if (lng >= -20 && lng <= 55 && lat >= -35 && lat <= 25) return 'Decolonisation · Proxy wars';
    return '';
  }
  if (era === 'contemporary') {
    if (lng >= 25 && lng <= 45 && lat >= 44 && lat <= 56) return 'Russia–Ukraine War';
    if (lng >= 30 && lng <= 50 && lat >= 12 && lat <= 40) return 'War on Terror · Syrian Civil War';
    if (lng >= 60 && lng <= 80 && lat >= 28 && lat <= 40) return 'Afghanistan · GWOT';
    if (lng >= 12 && lng <= 30 && lat >= 40 && lat <= 48) return 'Yugoslav Wars';
    if (lng >= -20 && lng <= 55 && lat >= -35 && lat <= 20) return 'African insurgencies';
    if (lng >= 100 && lng <= 130 && lat >= 5 && lat <= 30) return 'South China Sea era';
    return '';
  }
  return '';
}
