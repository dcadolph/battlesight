// Faction color palette. Two layers:
//
// 1. Iconic ColorKey -> hex map. Each key is the historical association
//    we want the eye to recognise instantly: Nazis are SS black so red
//    stays free for the Soviets, Imperial Japan reads as blood red,
//    Confederates are gray against Union navy, Romans are crimson
//    against Carthage purple, and so on.
//
// 2. detectColorKey(name) pattern-matches a faction's display string
//    against known patterns so most replays light up the right colors
//    without per-replay tagging. Replays that need to be explicit set
//    factionAColorKey / factionBColorKey on the Replay schema.

export type ColorKey =
  // World War II.
  | 'nazi-black'
  | 'soviet-red'
  | 'imperial-japan'
  | 'fascist-italy'
  | 'us-blue'
  | 'royal-navy'
  | 'free-french'
  | 'nationalist-china'
  | 'communist-china'
  // Cold War and modern.
  | 'north-korea-red'
  | 'south-korea-blue'
  | 'north-vietnam-red'
  | 'south-vietnam-blue'
  | 'isis-black'
  | 'ukraine-blue'
  | 'russia-modern-red'
  // American Civil War.
  | 'union-blue'
  | 'confederate-gray'
  // Napoleonic and revolutionary.
  | 'napoleonic-blue'
  | 'redcoat-red'
  | 'continental-blue'
  | 'prussian-blue'
  | 'habsburg-white'
  | 'russian-green'
  // Ancient and medieval.
  | 'roman-crimson'
  | 'carthage-purple'
  | 'persian-purple'
  | 'greek-slate'
  | 'mongol-amber'
  | 'crusader-cream'
  | 'saracen-green'
  | 'ottoman-burgundy'
  | 'spanish-gold'
  // Generic role fallbacks.
  | 'aggressor-red'
  | 'defender-blue'
  | 'neutral-amber';

// Palette holds the solid stroke / fill plus the soft halo we use for the
// drop-shadow glow around unit chips and arrow strokes.
export interface Palette {
  // Primary is the solid hex used for strokes, fills, and arrowheads.
  primary: string;
  // Glow is an rgba string used inside drop-shadow filters.
  glow: string;
}

const PALETTE: Record<ColorKey, Palette> = {
  // World War II.
  'nazi-black': { primary: '#a16207', glow: 'rgba(161,98,7,0.55)' },
  'soviet-red': { primary: '#dc2626', glow: 'rgba(220,38,38,0.40)' },
  'imperial-japan': { primary: '#9b1c1c', glow: 'rgba(155,28,28,0.45)' },
  'fascist-italy': { primary: '#ec4899', glow: 'rgba(236,72,153,0.45)' },
  'us-blue': { primary: '#1d4ed8', glow: 'rgba(29,78,216,0.40)' },
  'royal-navy': { primary: '#1e3a8a', glow: 'rgba(30,58,138,0.45)' },
  'free-french': { primary: '#3b82f6', glow: 'rgba(59,130,246,0.40)' },
  'nationalist-china': { primary: '#1e40af', glow: 'rgba(30,64,175,0.40)' },
  'communist-china': { primary: '#b91c1c', glow: 'rgba(185,28,28,0.45)' },
  // Cold War and modern.
  'north-korea-red': { primary: '#dc2626', glow: 'rgba(220,38,38,0.40)' },
  'south-korea-blue': { primary: '#1d4ed8', glow: 'rgba(29,78,216,0.40)' },
  'north-vietnam-red': { primary: '#dc2626', glow: 'rgba(220,38,38,0.40)' },
  'south-vietnam-blue': { primary: '#1d4ed8', glow: 'rgba(29,78,216,0.40)' },
  'isis-black': { primary: '#0f1116', glow: 'rgba(15,17,22,0.55)' },
  'ukraine-blue': { primary: '#facc15', glow: 'rgba(250,204,21,0.45)' },
  'russia-modern-red': { primary: '#a5121b', glow: 'rgba(165,18,27,0.45)' },
  // American Civil War.
  'union-blue': { primary: '#1e3a8a', glow: 'rgba(30,58,138,0.45)' },
  'confederate-gray': { primary: '#6b7280', glow: 'rgba(107,114,128,0.45)' },
  // Napoleonic and revolutionary.
  'napoleonic-blue': { primary: '#3b82f6', glow: 'rgba(59,130,246,0.40)' },
  'redcoat-red': { primary: '#dc2626', glow: 'rgba(220,38,38,0.40)' },
  'continental-blue': { primary: '#1e3a8a', glow: 'rgba(30,58,138,0.45)' },
  'prussian-blue': { primary: '#1e2a4a', glow: 'rgba(30,42,74,0.50)' },
  'habsburg-white': { primary: '#e5e7eb', glow: 'rgba(229,231,235,0.40)' },
  'russian-green': { primary: '#475569', glow: 'rgba(71,85,105,0.45)' },
  // Ancient and medieval.
  'roman-crimson': { primary: '#b91c1c', glow: 'rgba(185,28,28,0.45)' },
  'carthage-purple': { primary: '#6b21a8', glow: 'rgba(107,33,168,0.45)' },
  'persian-purple': { primary: '#7e22ce', glow: 'rgba(126,34,206,0.45)' },
  'greek-slate': { primary: '#475569', glow: 'rgba(71,85,105,0.45)' },
  'mongol-amber': { primary: '#b45309', glow: 'rgba(180,83,9,0.45)' },
  'crusader-cream': { primary: '#fef3c7', glow: 'rgba(254,243,199,0.40)' },
  'saracen-green': { primary: '#7c3aed', glow: 'rgba(124,58,237,0.45)' },
  'ottoman-burgundy': { primary: '#9f1239', glow: 'rgba(159,18,57,0.45)' },
  'spanish-gold': { primary: '#ca8a04', glow: 'rgba(202,138,4,0.45)' },
  // Generic.
  'aggressor-red': { primary: '#dc2626', glow: 'rgba(220,38,38,0.40)' },
  'defender-blue': { primary: '#1d4ed8', glow: 'rgba(29,78,216,0.40)' },
  'neutral-amber': { primary: '#f59e0b', glow: 'rgba(245,158,11,0.40)' },
};

// paletteFor returns the Palette for a ColorKey.
export function paletteFor(key: ColorKey): Palette {
  return PALETTE[key];
}

// detectColorKey scans a faction display string for known patterns and
// returns the matching iconic ColorKey, or null when no pattern matches
// confidently. Pattern matching is case-insensitive. The order below
// matters: more specific patterns appear before the generic catch-alls.
export function detectColorKey(name: string): ColorKey | null {
  const s = name.toLowerCase();

  // World War II Axis.
  if (/(nazi|wehrmacht|waffen[- ]?ss|kriegsmarine|luftwaffe|third reich|axis germany|german army group|panzer)/.test(s)) {
    return 'nazi-black';
  }
  if (/(imperial japan|japanese army|imperial japanese|empire of japan|kwantung|\bija\b|\bijn\b)/.test(s)) {
    return 'imperial-japan';
  }
  if (/(fascist italy|kingdom of italy|italian fascist|regio esercito|mussolini)/.test(s)) {
    return 'fascist-italy';
  }

  // Soviet and Eastern Bloc.
  if (/(soviet|red army|\bussr\b|stalin|warsaw pact)/.test(s)) return 'soviet-red';

  // ISIS / extremist / insurgent. Includes the Iraq-era insurgent names
  // (Zarqawi network, AQI, Mahdi Army, Sunni resistance) so Second
  // Fallujah etc. don't accidentally render insurgents in the same blue
  // as US forces. Catches generic "insurgents" / "resistance" / "militants"
  // labels too so curators don't have to spell out every group name.
  if (/(\bisis\b|\bisil\b|daesh|al[- ]qaeda|\baqi\b|zarqawi|mahdi army|islamic state|taliban|mujahid|insurgent|resistance(?!.*fr\.?)|militants?|jihadi|hamas|hezbollah|houthi|boko[- ]haram|al[- ]shabaab|wagner)/.test(s)) {
    return 'isis-black';
  }

  // China.
  if (/(nationalist china|kuomintang|\bkmt\b|chiang|republic of china)/.test(s)) return 'nationalist-china';
  if (/(\bpla\b|people'?s liberation|communist china|red china|\bprc\b|mao)/.test(s)) return 'communist-china';

  // Korea.
  if (/(north korea|\bkpa\b|\bdprk\b|democratic people'?s)/.test(s)) return 'north-korea-red';
  if (/(south korea|\brok\b|republic of korea)/.test(s)) return 'south-korea-blue';

  // Vietnam.
  if (/(north vietnam|\bnva\b|\bpavn\b|viet cong|\bvc\b|vietcong|viet[- ]?minh)/.test(s)) return 'north-vietnam-red';
  if (/(south vietnam|\barvn\b|republic of vietnam)/.test(s)) return 'south-vietnam-blue';

  // Modern Russia / Ukraine.
  if (/(ukrainian|ukraine|\bzsu\b|\bafu\b|kyiv government)/.test(s)) return 'ukraine-blue';
  if (/(russian federation|russian armed|wagner|donetsk|luhansk|\bvdv\b)/.test(s)) return 'russia-modern-red';

  // American Civil War.
  if (/(\bconfederate|confederacy|\bcsa\b|johnny reb|army of northern virginia|army of tennessee|stonewall|lee'?s army)/.test(s)) {
    return 'confederate-gray';
  }
  if (/(\bunion\b|federal army|army of the potomac|army of the cumberland|grant'?s|sherman'?s)/.test(s)) {
    return 'union-blue';
  }

  // World War I and modern Western Allies.
  if (/(\bbef\b|british expeditionary|british empire|commonwealth|\braf\b|royal navy|royal army|\buk\b\s|\buk forces)/.test(s)) {
    return 'royal-navy';
  }
  if (/(united states|\bus army\b|\bus\.\s|\bu\.s\.|usmc|\bmarines\b|us navy|\busn\b|american expeditionary|allies\b|\baef\b)/.test(s)) {
    return 'us-blue';
  }
  if (/(free french|french resistance|french army|\bfrance\b|grande arm[ée]e|french empire|napoleon)/.test(s)) {
    // Napoleonic and pre-WW1 French gets the lighter cobalt; modern French
    // forces are functionally indistinguishable from US blue so we route
    // them to free-french palette anyway.
    if (/(napoleon|grande arm[ée]e|french empire|first french|consulate)/.test(s)) return 'napoleonic-blue';
    return 'free-french';
  }

  // Redcoats. After modern UK so 18th-century British forces get the red
  // they actually wore.
  if (/(\bredcoats|king'?s army|crown forces|king george|british regulars)/.test(s)) return 'redcoat-red';

  // American Revolution.
  if (/(continental army|continentals|patriots?\b|colonial militia)/.test(s)) return 'continental-blue';

  // Prussia / pre-Nazi Imperial Germany.
  if (/(prussian|kingdom of prussia|\bprussia\b|frederick the great|german confederation|imperial german|kaiser)/.test(s)) {
    return 'prussian-blue';
  }

  // Austria / Habsburg.
  if (/(austrian empire|austria-?hungary|habsburg|holy roman|austrian army|imperial austrian)/.test(s)) {
    return 'habsburg-white';
  }

  // Tsarist Russia.
  if (/(russian empire|tsarist|imperial russia|tsar\b|romanov)/.test(s)) return 'russian-green';

  // Spanish.
  if (/(spanish empire|conquistador|tercio|\bspain\b|spanish army)/.test(s)) return 'spanish-gold';

  // Ottoman.
  if (/(ottoman|janissary|sultanate of rum|sublime porte|seljuk)/.test(s)) return 'ottoman-burgundy';

  // Ancient and medieval.
  if (/(roman empire|roman republic|romans?\b|legion\b|legions\b|caesar|consul)/.test(s)) return 'roman-crimson';
  if (/(carthage|carthaginian|hannibal|punic)/.test(s)) return 'carthage-purple';
  if (/(achaemenid|persian empire|sassanid|sasanian|persians|darius|xerxes)/.test(s)) return 'persian-purple';
  if (/(\bgreeks?\b|hoplite|athen|sparta|macedon|alexander|seleucid|ptolem)/.test(s)) return 'greek-slate';
  if (/(mongol|\bkhan\b|genghis|kublai|golden horde)/.test(s)) return 'mongol-amber';
  if (/(crusader|knights templar|hospitaller|teutonic|christian army)/.test(s)) return 'crusader-cream';
  if (/(saracen|ayyubid|caliphate|fatimid|mamluk|saladin|muslim army)/.test(s)) return 'saracen-green';

  return null;
}

// resolveSidePalette picks a palette for one side of a replay. Order of
// resolution: explicit ColorKey wins, then auto-detect from the name,
// then null so the caller can fall back to the positional default.
export function resolveSidePalette(
  explicit: ColorKey | undefined,
  name: string | undefined,
): Palette | null {
  if (explicit) return paletteFor(explicit);
  if (name) {
    const k = detectColorKey(name);
    if (k) return paletteFor(k);
  }
  return null;
}
