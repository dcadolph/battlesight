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
  'modern': '#10b981',
};

export const ERA_LABELS: Record<string, string> = {
  'ancient': 'Ancient',
  'medieval': 'Medieval',
  'early-modern': 'Early Modern',
  'napoleonic': 'Napoleonic',
  'industrial': 'Industrial Age',
  'world-war-1': 'World War I',
  'interwar': 'Interwar',
  'world-war-2': 'World War II',
  'modern': 'Modern',
};
