// canonCountriesFromSide mirrors the Go canon-country mapper in
// internal/battles/country.go on the client. Used to derive which countries
// should be shaded on the globe when a battle is selected, so even a battle
// that has no curated control regions still carries territorial context.
//
// The list is intentionally permissive: a Wikipedia-style side description
// like "Allied (United States, United Kingdom, Belgium)" should map to all
// three. Order of patterns matters because more specific phrases (e.g.
// "soviet union") sit ahead of broader ones (e.g. "russia") to keep cold-
// war engagements out of the tsarist bucket.

interface CountryPattern {
  name: string;
  phrases: string[];
}

const PATTERNS: CountryPattern[] = [
  { name: 'United States', phrases: [
    'united states', 'u.s. army', 'u.s. navy', 'u.s. marine', 'u.s.a.',
    'usa', 'americans', 'american army', 'american navy',
    'american expeditionary', 'american forces',
    'confederate states', 'confederacy', 'union army', 'union forces',
  ] },
  { name: 'United Kingdom', phrases: [
    'united kingdom', 'great britain', 'british empire', 'british army',
    'british indian', 'royal navy', 'royal air force', ' raf ', ' bef ',
    'kingdom of england', 'english fleet', 'scottish ', ' welsh ',
    'anglo-', 'british ', ' britain', ' england', 'english (',
  ] },
  { name: 'Germany', phrases: [
    'nazi germany', 'third reich', 'wehrmacht', 'german empire',
    'weimar republic', 'imperial germany', 'afrika korps', 'luftwaffe',
    'kriegsmarine', 'kingdom of prussia', 'prussian ', ' prussia',
    'germany', 'german ',
  ] },
  { name: 'Russia', phrases: [
    'soviet union', 'u.s.s.r.', 'ussr', 'red army', 'soviet ',
    'bolshevik', 'russian empire', 'russian federation', 'russian ',
    ' russia', 'imperial russia', 'tsardom', 'muscovy', 'muscovite',
  ] },
  { name: 'France', phrases: [
    'french republic', 'kingdom of france', 'vichy france', 'napoleonic',
    'free french', ' france', 'french ', 'gauls', 'gaul ',
  ] },
  { name: 'Italy', phrases: ['kingdom of italy', 'italian republic', 'italy', 'italian '] },
  { name: 'Rome', phrases: ['roman republic', 'roman empire', 'byzantine empire', 'eastern roman', ' rome ', 'roman ', ' romans'] },
  { name: 'Spain', phrases: ['spanish empire', 'kingdom of spain', 'crown of castile', ' castile', 'spain', 'spanish '] },
  { name: 'Portugal', phrases: ['portugal', 'portuguese '] },
  { name: 'Netherlands', phrases: ['netherlands', 'dutch ', 'dutch republic', 'united provinces', ' holland', 'batavian'] },
  { name: 'Belgium', phrases: ['belgium', 'belgian '] },
  { name: 'Poland', phrases: ['poland', 'polish ', 'polish-lithuanian', 'commonwealth of poland'] },
  { name: 'Ukraine', phrases: ['ukraine', 'ukrainian ', 'armed forces of ukraine'] },
  { name: 'Japan', phrases: ['empire of japan', 'imperial japan', 'imperial japanese', 'japan', 'japanese '] },
  { name: 'China', phrases: ["people's republic of china", 'republic of china', 'qing dynasty', 'ming dynasty', 'han dynasty', 'tang dynasty', 'song dynasty', 'china', 'chinese '] },
  { name: 'Korea', phrases: ['north korea', 'south korea', 'dprk', 'republic of korea', 'joseon', 'goguryeo', 'korea', 'korean '] },
  { name: 'Vietnam', phrases: ['viet cong', 'viet minh', 'north vietnam', 'south vietnam', "people's army of vietnam", 'nva ', 'vietnam', 'vietnamese '] },
  { name: 'India', phrases: ['british indian', 'mughal', 'maratha', 'mauryan', 'india', 'indian '] },
  { name: 'Pakistan', phrases: ['pakistan', 'pakistani '] },
  { name: 'Afghanistan', phrases: ['afghanistan', 'afghan ', 'taliban', 'northern alliance', 'mujahideen'] },
  { name: 'Iran', phrases: ['islamic republic of iran', 'iran', 'iranian ', 'persia', 'persian ', 'achaemenid', 'sassanid', 'safavid', 'qajar'] },
  { name: 'Iraq', phrases: ['iraq', 'iraqi ', 'baathist iraq', 'abbasid'] },
  { name: 'Syria', phrases: ['syrian arab army', "ba'athist syria", 'arab republic of syria', 'syria', 'syrian ', 'isis', 'islamic state', 'isil', 'daesh'] },
  { name: 'Israel', phrases: ['israel defense forces', ' idf ', 'kingdom of israel', 'israel', 'israeli '] },
  { name: 'Palestine', phrases: ['palestine', 'palestinian ', 'hamas', 'plo ', 'fatah'] },
  { name: 'Lebanon', phrases: ['lebanon', 'lebanese ', 'hezbollah'] },
  { name: 'Egypt', phrases: ['egypt', 'egyptian ', 'ptolemaic', 'mamluk', 'fatimid', 'ayyubid'] },
  { name: 'Turkey', phrases: ['ottoman', 'republic of turkey', 'sublime porte', 'turkey', 'turkish '] },
  { name: 'Greece', phrases: ['hellenic', 'athens', 'athenian ', 'sparta', 'spartan ', 'macedonia', 'macedonian ', 'thebes', 'greece', 'greek '] },
  { name: 'Austria', phrases: ['austria-hungary', 'austrian empire', 'habsburg', 'holy roman empire', 'austria', 'austrian '] },
  { name: 'Hungary', phrases: ['hungary', 'hungarian ', 'magyar'] },
  { name: 'Serbia', phrases: ['yugoslavia', 'yugoslav ', 'kingdom of serbia', 'serbia', 'serbian '] },
  { name: 'Bulgaria', phrases: ['kingdom of bulgaria', 'bulgaria', 'bulgarian '] },
  { name: 'Romania', phrases: ['wallachia', 'moldavia', 'romania', 'romanian '] },
  { name: 'Finland', phrases: ['finland', 'finnish '] },
  { name: 'Norway', phrases: ['norway', 'norwegian ', 'norse '] },
  { name: 'Sweden', phrases: ['kingdom of sweden', 'sweden', 'swedish '] },
  { name: 'Denmark', phrases: ['kingdom of denmark', 'denmark', 'danish '] },
  { name: 'Canada', phrases: ['royal canadian', 'canada', 'canadian '] },
  { name: 'Australia', phrases: ['royal australian', 'anzac', 'anzacs', 'australia', 'australian '] },
  { name: 'New Zealand', phrases: ['new zealand', 'new zealanders'] },
  { name: 'Mexico', phrases: ['aztec ', 'mexica', 'mexico', 'mexican '] },
  { name: 'Argentina', phrases: ['argentina', 'argentine ', 'argentinian '] },
  { name: 'Brazil', phrases: ['brazil', 'brazilian '] },
  { name: 'South Africa', phrases: ['south africa', 'south african ', 'boer', 'transvaal'] },
  { name: 'Ethiopia', phrases: ['ethiopia', 'ethiopian ', 'abyssinia', 'abyssinian '] },
  { name: 'Sudan', phrases: ['sudan', 'sudanese ', 'rapid support forces', ' saf '] },
  { name: 'Somalia', phrases: ['somalia', 'somali ', 'al-shabaab', 'al shabaab'] },
  { name: 'Libya', phrases: ['libya', 'libyan ', 'gaddafi', 'qaddafi'] },
  { name: 'Yemen', phrases: ['yemen', 'yemeni ', 'houthi', 'ansar allah'] },
  { name: 'Saudi Arabia', phrases: ['saudi arabia', 'saudi '] },
  { name: 'Armenia', phrases: ['armenia', 'armenian '] },
  { name: 'Azerbaijan', phrases: ['azerbaijan', 'azerbaijani ', 'azeri '] },
  { name: 'Mongolia', phrases: ['mongol ', 'mongols', 'mongolia', 'golden horde', 'ilkhanate', 'yuan dynasty'] },
];

// canonCountriesFromSide returns the canonical present-day countries inferred
// from a freeform side description. Stable, de-duplicated, never empty
// without reason (an unrecognised side returns []).
export function canonCountriesFromSide(side: string): string[] {
  if (!side) return [];
  const s = ` ${side.toLowerCase()} `;
  const found: string[] = [];
  for (const pat of PATTERNS) {
    for (const phrase of pat.phrases) {
      if (s.includes(phrase)) {
        if (!found.includes(pat.name)) found.push(pat.name);
        break;
      }
    }
  }
  return found;
}

// canonCountriesForBattle walks every side on a battle and returns the
// union of recognised countries. Order: insertion (first occurrence on the
// first side wins for stable rendering).
export function canonCountriesForBattle(sides: Array<{ name?: string }> | undefined): string[] {
  if (!sides || sides.length === 0) return [];
  const out: string[] = [];
  for (const s of sides) {
    if (!s?.name) continue;
    for (const c of canonCountriesFromSide(s.name)) {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

// canonBelligerentKey returns a stable comparison key for the cinematic
// overture's belligerent dedup. The country map above lumps Union and
// Confederacy into "United States" because both occupied US territory, but
// for the overture's belligerent line they are two distinct sides; same
// pattern for Allies vs Vichy, USSR vs imperial Russia. Returns "" when
// no alias matches so the caller falls back to a normalised form.
// Rule order matters. The first match wins. USSR / Imperial Germany /
// other specific keys must precede their broader country fallbacks
// ("germany", "russia") so a label like "Soviet Union" doesn't get
// caught by a Union-army / United-Kingdom shaped fallback. Bug history:
// us-union once preceded ussr, and "Soviet Union" matched " union " and
// rendered as "Union" on the WW2 overture.
const BELLIGERENT_RULES: Array<[string, string[]]> = [
  ['ussr', ['soviet union', 'u.s.s.r.', ' ussr ', 'red army', 'soviet ']],
  ['nazi-germany', ['nazi germany', 'third reich', 'wehrmacht', ' afrika korps', 'luftwaffe', 'kriegsmarine']],
  ['imperial-germany', ['german empire', 'imperial germany']],
  ['us-union', ['union army', 'union forces', '(union)', 'federal army', 'federal forces']],
  ['us-confederacy', ['confederate states', 'confederacy', 'confederate army', 'confederate ', ' csa ']],
  ['us', ['united states', 'u.s.a.', ' usa ', ' america ', 'american ', 'u.s. army', 'u.s. navy', 'u.s. marine']],
  ['uk', ['united kingdom', 'great britain', 'british empire', 'british ', ' britain', ' england', 'kingdom of england', 'royal navy', 'royal air force', ' raf ', 'raf fighter']],
  ['canada', ['royal canadian', 'canadian ', ' canada']],
  ['australia', ['royal australian', 'anzac', 'anzacs', 'australian ', ' australia']],
  ['new-zealand', ['new zealand', 'new zealanders']],
  ['germany', ['weimar republic', 'kingdom of prussia', 'prussian ', ' prussia', 'germany', 'german ']],
  ['russia', ['russian empire', 'russian federation', 'russian ', ' russia', 'imperial russia', 'tsardom', 'muscovy', 'muscovite']],
  ['vichy', ['vichy france']],
  ['france', ['french republic', 'kingdom of france', 'napoleonic', 'free french', ' france', 'french ', 'gauls', 'gaul ']],
  ['italy', ['kingdom of italy', 'italian republic', 'italian social republic', 'italy', 'italian ']],
  ['japan', ['empire of japan', 'imperial japan', 'imperial japanese', 'japanese empire', 'japan', 'japanese ']],
  ['china-roc', ['republic of china', 'nationalist china', 'kuomintang']],
  ['china-prc', ["people's republic of china", 'communist china', "people's liberation army", ' pla ']],
  ['china', ['qing dynasty', 'ming dynasty', 'han dynasty', 'tang dynasty', 'song dynasty', 'china', 'chinese ']],
  ['poland', ['second polish republic', 'polish republic', 'polish armed forces', 'polish ', ' poland', 'kingdom of poland']],
  ['finland', ['kingdom of finland', 'finnish ', ' finland']],
  ['hungary', ['kingdom of hungary', 'hungarian ', ' hungary']],
  ['romania', ['kingdom of romania', 'romanian ', ' romania']],
  ['bulgaria', ['kingdom of bulgaria', 'bulgarian ', ' bulgaria']],
  ['yugoslavia', ['kingdom of yugoslavia', 'yugoslav partisans', 'yugoslav ', ' yugoslavia']],
  ['greece', ['kingdom of greece', 'hellenic', 'greek ', ' greece']],
  ['netherlands', ['kingdom of the netherlands', 'dutch ', ' netherlands', ' holland', 'batavian']],
  ['belgium', ['kingdom of belgium', 'belgian ', ' belgium']],
  ['norway', ['kingdom of norway', 'norwegian ', ' norway']],
  ['denmark', ['kingdom of denmark', 'danish ', ' denmark']],
  ['rome', ['roman republic', 'roman empire', 'byzantine empire', 'eastern roman', ' rome ', 'roman ', ' romans']],
  ['ottoman', ['ottoman']],
  ['turkey', ['republic of turkey', 'turkey', 'turkish ']],
  ['hts', ['hayat tahrir al-sham', ' hts ', ' hts', 'syrian salvation', 'syrian opposition', 'free syrian army']],
  ['isis', ['islamic state', ' isis ', 'isil', 'daesh']],
  ['syria', ['syrian arab army', "ba'athist syria", 'arab republic of syria', 'syria', 'syrian ']],
];

export function canonBelligerentKey(label: string): string {
  if (!label) return '';
  const s = ` ${label.toLowerCase()} `;
  for (const [key, phrases] of BELLIGERENT_RULES) {
    for (const phrase of phrases) {
      if (s.includes(phrase)) return key;
    }
  }
  return '';
}

// CANONICAL_BELLIGERENT_LABELS maps each canonBelligerentKey to the clean,
// publication-grade name to display. Wikipedia's combatant fields routinely
// arrive as concatenated wreckage ("Union of Soviet Socialist Republics
// Soviet Union", "Free City of Danzig, Supported by: , Nazi Germany",
// "Empire of Japan 31st Infantry Division"). Once a key resolves, render
// the canonical name instead of the raw text — the overture is a chip
// strip, not a forensic excerpt of the source article.
const CANONICAL_BELLIGERENT_LABELS: Record<string, string> = {
  'us-union': 'Union',
  'us-confederacy': 'Confederate States',
  'us': 'United States',
  'uk': 'United Kingdom',
  'canada': 'Canada',
  'australia': 'Australia',
  'new-zealand': 'New Zealand',
  'nazi-germany': 'Nazi Germany',
  'imperial-germany': 'German Empire',
  'germany': 'Germany',
  'ussr': 'Soviet Union',
  'russia': 'Russia',
  'vichy': 'Vichy France',
  'france': 'France',
  'italy': 'Italy',
  'japan': 'Japan',
  'china-roc': 'Republic of China',
  'china-prc': "People's Republic of China",
  'china': 'China',
  'poland': 'Poland',
  'finland': 'Finland',
  'hungary': 'Hungary',
  'romania': 'Romania',
  'bulgaria': 'Bulgaria',
  'yugoslavia': 'Yugoslavia',
  'greece': 'Greece',
  'netherlands': 'Netherlands',
  'belgium': 'Belgium',
  'norway': 'Norway',
  'denmark': 'Denmark',
  'rome': 'Rome',
  'ottoman': 'Ottoman Empire',
  'turkey': 'Turkey',
  'hts': 'Syrian Opposition (HTS-led)',
  'isis': 'Islamic State',
  'syria': 'Syria',
};

// canonBelligerentLabel returns the publication-grade name for a canon key
// when one is registered. Falls back to the empty string so callers can use
// their own normalised label.
export function canonBelligerentLabel(key: string): string {
  return CANONICAL_BELLIGERENT_LABELS[key] || '';
}
