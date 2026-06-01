// Per-war territorial control snapshots. Drives the time-shifting globe
// shading during war cinematic playback — as the playhead crosses each
// snapshot's year, the globe re-paints countries with their controlling
// faction's colour, so Axis red advances across Europe in 1940-42 and
// recedes again in 1943-45. The shading is intentionally coarse: country-
// polygon resolution from the world-atlas data set, no sub-national
// boundaries, no shape interpolation between snapshots (hard cut). The
// goal is reading the campaign at a glance, not surveying borders.
//
// Country keys are present-day ISO country names matching the world-atlas
// TopoJSON properties.name field. Aliases ("United States of America" vs
// "United States") are handled by the globe's COUNTRY_NAME_ALIASES map.
//
// Owner keys match canonBelligerentKey values so the colour table below
// can stay aligned with the rest of the app's identity system.

// Bloc is the high-level coalition the user sees on the map. The
// editorial Britannica/Map-Men style is "red side vs blue side", with a
// third color reserved for major three-way conflicts (Cold War triads,
// Three Kingdoms, etc.) and a grey wash for neutrals. Faction-specific
// colors (OWNER_COLORS) only matter when a snapshot does NOT specify a
// bloc per faction — the bloc map collapses 60 different palette entries
// into the four core "what side are you on" reads.
export type Bloc = 'A' | 'B' | 'C' | 'neutral';

export interface TerritorySnapshot {
  // year is the decimal year (e.g. 1939.7 ≈ September 1939) the snapshot
  // takes effect. Snapshots are applied as "current as of this year or
  // later, until the next snapshot fires".
  year: number;
  // label is a short caption surfacing on the globe HUD during playback.
  label: string;
  // control maps an owner key to the list of present-day country names
  // that owner held at this snapshot.
  control: Record<string, string[]>;
  // bloc optionally assigns each owner to a high-level coalition for
  // editorial color simplification. When present, the bloc → BLOC_COLORS
  // mapping wins over OWNER_COLORS so the map reads as "red vs blue"
  // instead of a dozen competing faction shades. Faction identity is
  // still preserved through the on-globe typography label layer.
  bloc?: Record<string, Bloc>;
}

export interface WarTerritory {
  // war is the canonical war name (matches battles.war).
  war: string;
  // snapshots are sorted ascending by year. The frontend picks the most
  // recent snapshot ≤ the current playhead year.
  snapshots: TerritorySnapshot[];
}

// OWNER_COLORS assigns each canonBelligerentKey its shading colour for the
// territory pass. Axis powers cluster in red-orange; Allied / Coalition
// powers in blue-cyan; neutral / Other in slate. Hex without alpha; the
// renderer mixes alpha at paint time.
export const OWNER_COLORS: Record<string, string> = {
  // World War II Axis. Nazis read black (SS uniform) so red stays free for
  // the Soviet sphere; Imperial Japan reads as blood crimson; Italy reads
  // as fascist green. Each Axis power has its own distinct silhouette on
  // the European map at peak occupation.
  // Nazi Germany painted as feldgrau — the Wehrmacht's actual uniform
  // color. Distinct enough from Soviet bright red that the Eastern Front
  // reads as two competing forces, not one red blob. Visible on dark
  // satellite imagery and historically iconic.
  // Curated palette: avoid greens (which blend with forested land) and
  // saturated mid-blues (which blend with ocean). Every shade below was
  // chosen to read clearly against the satellite-style Earth texture.
  // Nazi Germany gets the bright Nazi-banner red so the WW2 cinematic
  // reads as "red Reich" at a glance. The Soviet sphere takes a deep
  // crimson so red Reich and red USSR sit side by side on the 1941
  // Eastern Front map without merging into one blob. The faction symbol
  // layer (Iron Cross vs. hammer-and-sickle) seals the distinction.
  'nazi-germany': '#dc2626',
  'imperial-germany': '#854d0e',
  'germany': '#a16207',
  'japan': '#b91c1c',
  'italy': '#ec4899',
  'vichy': '#fb923c',
  'ussr': '#7f1d1d',
  'russia': '#7f1d1d',
  'ukraine': '#facc15',
  // Western Allies palette: each gets a different cool tone so France,
  // UK, and the US stay distinguishable when they're side-by-side on
  // the map (e.g. occupied Germany 1945).
  // Western Allies palette — each cool tone is offset enough that you can
  // see UK, US, Canada/Australia, Free French, and India as separate
  // territories on the same map. India gets a warm orange so it reads as
  // the Raj on the Asian rim rather than blending with the Commonwealth.
  'us': '#2563eb',
  'uk': '#eab308',
  'canada': '#f43f5e',
  'australia': '#22d3ee',
  'new-zealand': '#06b6d4',
  'commonwealth': '#22d3ee',
  'india': '#ea580c',
  'south-africa': '#d97706',
  'france': '#1d4ed8',
  'french-empire': '#3b82f6',
  'china-roc': '#0ea5e9',
  'china-prc': '#b91c1c',
  'china': '#fb7185',
  'poland': '#9333ea',
  'ottoman': '#9f1239',
  'turkey': '#06b6d4',
  'syria': '#7c3aed',
  'iraq': '#c026d3',
  'iran': '#7c3aed',
  'sweden': '#facc15',
  'paraguay': '#9333ea',
  'brazil': '#0d9488',
  'uruguay': '#fbbf24',
  'argentina-alt': '#9333ea',
  'persia': '#7e22ce',
  'punjab': '#ea580c',
  'isis': '#0f1116',
  'hts': '#475569',
  'us-union': '#2563eb',
  'us-confederacy': '#a16207',
  'rome': '#b91c1c',
  'finland': '#cbd5e1',
  // Axis-aligned minor powers cluster in mustard/amber tones so they
  // read as "with the Axis but not Germany" at a glance.
  'hungary': '#854d0e',
  'romania': '#a16207',
  'bulgaria': '#854d0e',
  'yugoslavia': '#9333ea',
  'greece': '#06b6d4',
  // Low Countries and Scandinavia: amber pre-occupation, recolored to
  // nazi-black inside the snapshots once they fall. The amber tone gives
  // them a distinct identity from the green saracen/turkey palette.
  'netherlands': '#f59e0b',
  'belgium': '#f59e0b',
  'norway': '#f59e0b',
  'denmark': '#f59e0b',
  'austria-hungary': '#854d0e',
  'serbia': '#0891b2',
  'north-korea': '#dc2626',
  'south-korea': '#2563eb',
  'un-coalition': '#22d3ee',
  'prussia': '#1e2a4a',
  'austria': '#e5e7eb',
  'spain': '#f97316',
  'portugal': '#c084fc',
  'british-empire': '#dc2626',
  'continental-army': '#2563eb',
  'mongol': '#b45309',
  'crusader': '#eab308',
  'saracen': '#7c3aed',
  'byzantine': '#a855f7',
  'fatimid': '#f59e0b',
  'seljuk': '#be123c',
  'north-vietnam': '#dc2626',
  'south-vietnam': '#2563eb',
  'viet-cong': '#7f1d1d',
  'pathet-lao': '#b91c1c',
  'khmer-rouge': '#7f1d1d',
  'coalition': '#1d4ed8',
  'iraq-saddam': '#365314',
  'iraq-government': '#1d4ed8',
  'taliban': '#0f1116',
  'afghan-government': '#1d4ed8',
  'imperial-japan': '#9b1c1c',
  'roc-china': '#0891b2',
  'mexico': '#16a34a',
  'argentina': '#7c3aed',
  'dutch-republic': '#ea580c',
  'habsburg-spain': '#ca8a04',
  'kingdom-france-bourbon': '#3b82f6',
  'kingdom-england': '#dc2626',
  'kingdom-scotland': '#1d4ed8',
  'denmark-norway': '#f59e0b',
  'sweden-empire': '#facc15',
  'rus': '#15532f',
  'cuba-spain': '#ca8a04',
  'us-puerto-rico': '#1d4ed8',
  // Ancient and medieval iconic colors. Persian deep purple matches the
  // historical association (Tyrian-style royal purple), Greek slate-blue
  // reads as the Aegean / Athenian world, Roman crimson against Carthage
  // royal purple gives the Punic Wars their iconic colour clash, and so
  // on. Kept as separate OWNER_COLORS keys so snapshot maps can reach
  // for them directly without going through faction-palette.
  'persian-purple': '#7c3aed',
  'greek-slate': '#475569',
  'roman-crimson': '#b91c1c',
  'carthage-purple': '#6b21a8',
  'south-korea-blue': '#1d4ed8',
  'prussian-blue': '#1e2a4a',
  'hamas': '#0f1116',
  'hezbollah': '#0f1116',
};

export const TERRITORY: WarTerritory[] = [
  {
    war: 'World War II',
    snapshots: [
      {
        year: 1939.75,
        label: 'September 1939: Invasion of Poland',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia'],
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'Egypt', 'Sudan', 'Kenya', 'Tanzania', 'Uganda', 'Nigeria', 'Ghana', 'Malaysia', 'Myanmar'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'france': ['France', 'Algeria', 'Tunisia', 'Morocco', 'Mali', 'Niger', 'Chad', 'Senegal', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia'],
          'poland': ['Poland'],
          'italy': ['Italy', 'Albania', 'Libya', 'Eritrea', 'Ethiopia', 'Somalia'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
        },
        bloc: {
          'nazi-germany': 'A', 'italy': 'A',
          'uk': 'B', 'india': 'B', 'south-africa': 'B', 'france': 'B', 'poland': 'B',
          'ussr': 'neutral', 'japan': 'neutral',
        },
      },
      {
        year: 1940.5,
        label: 'June 1940: Fall of France',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway'],
          'vichy': ['France', 'Algeria', 'Tunisia', 'Morocco', 'Mali', 'Niger', 'Chad', 'Senegal', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia'],
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'Egypt', 'Sudan', 'Kenya', 'Tanzania', 'Uganda', 'Nigeria', 'Ghana', 'Malaysia', 'Myanmar'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'italy': ['Italy', 'Albania', 'Libya', 'Eritrea', 'Ethiopia', 'Somalia'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
        },
        bloc: {
          'nazi-germany': 'A', 'vichy': 'A', 'italy': 'A',
          'uk': 'B', 'india': 'B', 'south-africa': 'B', 'canada': 'B', 'australia': 'B', 'new-zealand': 'B',
          'ussr': 'neutral', 'japan': 'neutral',
        },
      },
      {
        year: 1941.6,
        label: 'June 1941: Operation Barbarossa',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Macedonia', 'Greece', 'Belarus', 'Lithuania', 'Latvia', 'Estonia'],
          'vichy': ['France', 'Algeria', 'Tunisia', 'Morocco', 'Mali', 'Niger', 'Chad', 'Senegal', 'Madagascar'],
          'ussr': ['Russia', 'Ukraine', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'Egypt', 'Sudan', 'Kenya', 'Tanzania', 'Uganda', 'Nigeria', 'Ghana', 'Malaysia', 'Myanmar'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'italy': ['Italy', 'Albania', 'Libya', 'Eritrea', 'Ethiopia', 'Somalia'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia'],
        },
        bloc: {
          'nazi-germany': 'A', 'vichy': 'A', 'italy': 'A', 'japan': 'A',
          'uk': 'B', 'india': 'B', 'south-africa': 'B', 'canada': 'B', 'australia': 'B', 'new-zealand': 'B', 'ussr': 'B',
        },
      },
      {
        year: 1942.7,
        label: 'Autumn 1942: Axis high water mark',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway', 'France', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Macedonia', 'Greece', 'Belarus', 'Lithuania', 'Latvia', 'Estonia', 'Ukraine', 'Moldova', 'Libya', 'Tunisia'],
          'ussr': ['Russia', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'Egypt', 'Sudan', 'Kenya', 'Tanzania', 'Uganda', 'Nigeria', 'Ghana'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'us': ['United States'],
          'italy': ['Italy', 'Albania', 'Eritrea', 'Ethiopia', 'Somalia'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia', 'Myanmar', 'Thailand', 'Malaysia', 'Indonesia', 'Philippines', 'Papua New Guinea'],
        },
        bloc: {
          'nazi-germany': 'A', 'italy': 'A', 'japan': 'A',
          'uk': 'B', 'india': 'B', 'south-africa': 'B', 'canada': 'B', 'australia': 'B', 'new-zealand': 'B', 'ussr': 'B', 'us': 'B',
        },
      },
      {
        year: 1943.7,
        label: 'Summer 1943: Stalingrad reversed, Italy invaded',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway', 'France', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Greece', 'Belarus', 'Lithuania', 'Latvia', 'Estonia', 'Italy'],
          'ussr': ['Russia', 'Ukraine', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'Egypt', 'Libya', 'Tunisia', 'Sudan', 'Kenya', 'Tanzania', 'Nigeria', 'Myanmar'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'us': ['United States'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia', 'Thailand', 'Malaysia', 'Indonesia', 'Philippines'],
        },
        bloc: {
          'nazi-germany': 'A', 'japan': 'A',
          'uk': 'B', 'india': 'B', 'south-africa': 'B', 'canada': 'B', 'australia': 'B', 'new-zealand': 'B', 'ussr': 'B', 'us': 'B',
        },
      },
      {
        year: 1944.5,
        label: 'June 1944: D-Day, Bagration',
        control: {
          // Italy moved out of the Axis column: Rome fell on 4 June 1944
          // (two days before D-Day) and the Kingdom of Italy had been a
          // co-belligerent on the Allied side since the September 1943
          // armistice. The Italian Social Republic (Mussolini's German
          // puppet state, 1943-45) only governed northern Italy and is
          // not a feature in the world atlas — so we paint the whole
          // Italian peninsula Allied to reflect the political reality.
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Denmark', 'Norway', 'Yugoslavia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Greece', 'Hungary'],
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Moldova', 'Lithuania', 'Latvia', 'Estonia', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'France', 'Italy', 'Egypt', 'Libya', 'Sudan', 'Kenya', 'Tanzania', 'Nigeria', 'Myanmar'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'us': ['United States', 'Philippines'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia', 'Thailand', 'Malaysia', 'Indonesia'],
        },
        bloc: {
          'nazi-germany': 'A', 'japan': 'A',
          'uk': 'B', 'india': 'B', 'south-africa': 'B', 'canada': 'B', 'australia': 'B', 'new-zealand': 'B', 'ussr': 'B', 'us': 'B',
        },
      },
      {
        year: 1945.4,
        label: 'May 1945: Victory in Europe',
        control: {
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Moldova', 'Lithuania', 'Latvia', 'Estonia', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan', 'Poland', 'Czechia', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Macedonia', 'Germany', 'Austria'],
          'uk': ['United Kingdom', 'France', 'Italy', 'Netherlands', 'Belgium', 'Denmark', 'Norway', 'Greece', 'Egypt', 'Libya', 'Sudan', 'Kenya', 'Tanzania', 'Nigeria', 'Myanmar'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'us': ['United States', 'Philippines', 'Germany', 'Austria'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia', 'Thailand', 'Malaysia', 'Indonesia'],
        },
        bloc: {
          'japan': 'A',
          'uk': 'B', 'india': 'B', 'south-africa': 'B', 'canada': 'B', 'australia': 'B', 'new-zealand': 'B', 'ussr': 'B', 'us': 'B',
        },
      },
      {
        year: 1945.7,
        label: 'September 1945: Victory in the Pacific',
        control: {
          'us': ['United States', 'Japan', 'South Korea', 'Philippines'],
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Moldova', 'Lithuania', 'Latvia', 'Estonia', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan', 'Poland', 'Czechia', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Macedonia', 'North Korea'],
          'uk': ['United Kingdom', 'France', 'Italy', 'Netherlands', 'Belgium', 'Denmark', 'Norway', 'Greece', 'Egypt', 'Libya', 'Sudan', 'Kenya', 'Tanzania', 'Nigeria', 'Myanmar', 'Malaysia'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'china-roc': ['China', 'Taiwan'],
        },
        bloc: {
          'us': 'B', 'ussr': 'B', 'uk': 'B', 'india': 'B', 'south-africa': 'B', 'canada': 'B', 'australia': 'B', 'new-zealand': 'B', 'china-roc': 'B',
        },
      },
    ],
  },
  {
    // Duplicate snapshot block — original Russo-Ukrainian War above carries
    // the real data. Kept for the older 'Russia-Ukraine War' key just in
    // case any legacy data still references that spelling, but contains
    // identical control maps. Safe to remove if no battles ever map here.
    war: 'War in Donbas (2014–2022)',
    snapshots: [
      {
        year: 2014.2,
        label: 'February 2014: Crimea annexed, Donbas insurgency',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
        },
      },
      {
        year: 2022.16,
        label: 'February 24 2022: Full-scale invasion',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'australia': ['Australia'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Bulgaria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway', 'Denmark', 'Netherlands', 'Belgium', 'Luxembourg', 'Ireland', 'Portugal', 'Greece', 'Austria'],
        },
      },
      {
        year: 2022.7,
        label: 'September 2022: Kharkiv counter-offensive',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'australia': ['Australia'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Bulgaria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway', 'Denmark', 'Netherlands', 'Belgium', 'Luxembourg', 'Ireland', 'Portugal', 'Greece', 'Austria'],
        },
      },
      {
        year: 2022.85,
        label: 'November 2022: Kherson liberated',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'australia': ['Australia'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Bulgaria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway', 'Denmark', 'Netherlands', 'Belgium', 'Luxembourg', 'Ireland', 'Portugal', 'Greece', 'Austria'],
        },
      },
      {
        year: 2023.5,
        label: 'Summer 2023: Ukrainian counter-offensive grinds south',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'australia': ['Australia'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Bulgaria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway', 'Denmark', 'Netherlands', 'Belgium', 'Luxembourg', 'Ireland', 'Portugal', 'Greece', 'Austria'],
        },
      },
      {
        year: 2024.2,
        label: 'February 2024: Avdiivka falls, Russia presses west',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'australia': ['Australia'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Bulgaria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway', 'Denmark', 'Netherlands', 'Belgium', 'Luxembourg', 'Ireland', 'Portugal', 'Greece', 'Austria'],
        },
      },
      {
        year: 2024.62,
        label: 'August 2024: Ukraine launches Kursk incursion',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'australia': ['Australia'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Bulgaria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway', 'Denmark', 'Netherlands', 'Belgium', 'Luxembourg', 'Ireland', 'Portugal', 'Greece', 'Austria'],
        },
      },
    ],
  },
  {
    war: 'World War I',
    snapshots: [
      {
        year: 1914.6,
        label: 'August 1914: Schlieffen Plan, Russian mobilization',
        control: {
          'imperial-germany': ['Germany', 'Poland'],
          'austria-hungary': ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Bosnia and Herzegovina'],
          'ottoman': ['Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Yemen'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan'],
          'france': ['France', 'Belgium', 'Algeria', 'Tunisia', 'Morocco', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia', 'Senegal', 'Mali', 'Niger', 'Chad'],
          'uk': ['United Kingdom', 'Ireland', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'serbia': ['Serbia', 'Montenegro'],
        },
      },
      {
        year: 1915.5,
        label: 'May 1915: Italy joins Allies, Gallipoli',
        control: {
          'imperial-germany': ['Germany', 'Poland'],
          'austria-hungary': ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Bosnia and Herzegovina'],
          'ottoman': ['Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Yemen'],
          'bulgaria': ['Bulgaria'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan'],
          'france': ['France', 'Belgium', 'Algeria', 'Tunisia', 'Morocco', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia', 'Senegal', 'Mali', 'Niger', 'Chad'],
          'uk': ['United Kingdom', 'Ireland', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'italy': ['Italy', 'Libya', 'Eritrea', 'Somalia'],
          'serbia': ['Serbia', 'Montenegro'],
        },
      },
      {
        year: 1916.6,
        label: 'Summer 1916: Verdun, Somme, Brusilov',
        control: {
          'imperial-germany': ['Germany', 'Poland', 'Belgium', 'Lithuania', 'Latvia', 'Belarus'],
          'austria-hungary': ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Bosnia and Herzegovina', 'Serbia', 'Montenegro'],
          'ottoman': ['Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Yemen'],
          'bulgaria': ['Bulgaria'],
          'russia': ['Russia', 'Ukraine', 'Estonia', 'Finland', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan'],
          'france': ['France', 'Algeria', 'Tunisia', 'Morocco', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia', 'Senegal', 'Mali', 'Niger', 'Chad'],
          'uk': ['United Kingdom', 'Ireland', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'italy': ['Italy', 'Libya', 'Eritrea', 'Somalia'],
          'romania': ['Romania'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
        },
      },
      {
        year: 1917.4,
        label: 'April 1917: US enters, Russia in revolution',
        control: {
          'imperial-germany': ['Germany', 'Poland', 'Belgium', 'Lithuania', 'Latvia', 'Belarus', 'Romania'],
          'austria-hungary': ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Bosnia and Herzegovina', 'Serbia', 'Montenegro'],
          'ottoman': ['Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Yemen'],
          'bulgaria': ['Bulgaria'],
          'russia': ['Russia', 'Ukraine', 'Estonia', 'Finland', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan'],
          'france': ['France', 'Algeria', 'Tunisia', 'Morocco', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia', 'Senegal', 'Mali', 'Niger', 'Chad'],
          'uk': ['United Kingdom', 'Ireland', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'italy': ['Italy', 'Libya', 'Eritrea', 'Somalia'],
          'us': ['United States'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
        },
      },
      {
        year: 1918.9,
        label: 'November 1918: Armistice, Central Powers collapse',
        control: {
          'uk': ['United Kingdom', 'Ireland', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana', 'Iraq', 'Israel', 'Jordan'],
          'india': ['India'],
          'south-africa': ['South Africa'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'france': ['France', 'Belgium', 'Algeria', 'Tunisia', 'Morocco', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia', 'Senegal', 'Mali', 'Niger', 'Chad', 'Syria', 'Lebanon'],
          'us': ['United States'],
          'italy': ['Italy', 'Libya', 'Eritrea', 'Somalia'],
          'serbia': ['Serbia', 'Montenegro', 'Croatia', 'Slovenia', 'Bosnia and Herzegovina', 'Macedonia'],
          'poland': ['Poland'],
          'romania': ['Romania', 'Moldova', 'Hungary'],
          'germany': ['Germany'],
          'austria': ['Austria'],
          'turkey': ['Turkey'],
          'russia': ['Russia', 'Ukraine', 'Belarus', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Georgia', 'Armenia', 'Azerbaijan'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
        },
      },
    ],
  },
  {
    war: 'Napoleonic Wars',
    snapshots: [
      {
        year: 1805.9,
        label: 'December 1805: Austerlitz, end of Third Coalition',
        control: {
          'french-empire': ['France', 'Belgium', 'Netherlands', 'Luxembourg', 'Switzerland'],
          'prussia': ['Germany'],
          'austria': ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Italy'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan'],
          'uk': ['United Kingdom', 'Ireland'],
          'india': ['India'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'spain': ['Spain', 'Mexico', 'Cuba', 'Colombia', 'Peru', 'Argentina', 'Bolivia', 'Chile', 'Venezuela', 'Ecuador', 'Philippines'],
          'portugal': ['Portugal', 'Brazil', 'Angola', 'Mozambique'],
          'ottoman': ['Turkey', 'Egypt', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Greece', 'Bulgaria', 'Romania', 'Serbia', 'Bosnia and Herzegovina'],
          'denmark': ['Denmark', 'Norway'],
          'finland': ['Finland', 'Sweden'],
        },
      },
      {
        year: 1810.5,
        label: '1810: French Empire at its peak',
        control: {
          'french-empire': ['France', 'Belgium', 'Netherlands', 'Luxembourg', 'Switzerland', 'Germany', 'Italy', 'Spain', 'Slovenia', 'Croatia', 'Bosnia and Herzegovina'],
          'austria': ['Austria', 'Hungary', 'Czechia', 'Slovakia'],
          'prussia': ['Poland'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Finland'],
          'uk': ['United Kingdom', 'Ireland'],
          'india': ['India'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'portugal': ['Portugal', 'Brazil', 'Angola', 'Mozambique'],
          'ottoman': ['Turkey', 'Egypt', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Greece', 'Bulgaria', 'Romania', 'Serbia'],
          'finland': ['Sweden'],
        },
      },
      {
        year: 1812.5,
        label: 'Summer 1812: Russian campaign',
        control: {
          'french-empire': ['France', 'Belgium', 'Netherlands', 'Luxembourg', 'Switzerland', 'Germany', 'Italy', 'Spain', 'Slovenia', 'Croatia', 'Bosnia and Herzegovina', 'Poland', 'Lithuania', 'Belarus'],
          'austria': ['Austria', 'Hungary', 'Czechia', 'Slovakia'],
          'russia': ['Russia', 'Ukraine', 'Estonia', 'Latvia', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Finland'],
          'uk': ['United Kingdom', 'Ireland', 'Portugal'],
          'india': ['India'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'ottoman': ['Turkey', 'Egypt', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Greece', 'Bulgaria', 'Romania', 'Serbia'],
          'finland': ['Sweden'],
        },
      },
      {
        year: 1813.8,
        label: 'October 1813: Leipzig, the Battle of the Nations',
        control: {
          'french-empire': ['France', 'Belgium', 'Netherlands', 'Luxembourg', 'Switzerland', 'Italy'],
          'prussia': ['Germany', 'Poland'],
          'austria': ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Bosnia and Herzegovina'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Finland'],
          'uk': ['United Kingdom', 'Ireland'],
          'india': ['India'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'spain': ['Spain', 'Mexico', 'Cuba', 'Colombia', 'Peru', 'Argentina', 'Bolivia', 'Chile', 'Venezuela', 'Ecuador', 'Philippines'],
          'portugal': ['Portugal', 'Brazil', 'Angola', 'Mozambique'],
          'ottoman': ['Turkey', 'Egypt', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Greece', 'Bulgaria', 'Romania', 'Serbia'],
          'finland': ['Sweden'],
        },
      },
      {
        year: 1815.5,
        label: 'June 1815: Waterloo, Congress of Vienna',
        control: {
          'france': ['France'],
          'prussia': ['Germany', 'Poland'],
          'austria': ['Austria', 'Hungary', 'Czechia', 'Slovakia', 'Slovenia', 'Croatia', 'Bosnia and Herzegovina', 'Italy'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Finland'],
          'uk': ['United Kingdom', 'Ireland', 'Belgium', 'Netherlands', 'Luxembourg'],
          'india': ['India'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'spain': ['Spain', 'Mexico', 'Cuba', 'Colombia', 'Peru', 'Argentina', 'Bolivia', 'Chile', 'Venezuela', 'Ecuador', 'Philippines'],
          'portugal': ['Portugal', 'Brazil', 'Angola', 'Mozambique'],
          'ottoman': ['Turkey', 'Egypt', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Greece', 'Bulgaria', 'Romania', 'Serbia'],
          'finland': ['Sweden', 'Norway'],
        },
      },
    ],
  },
  {
    war: 'Korean War',
    snapshots: [
      {
        year: 1950.5,
        label: 'June 1950: North Korean invasion',
        control: {
          'north-korea': ['North Korea'],
          'south-korea': ['South Korea'],
          'china-prc': ['China'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'ussr': ['Russia'],
        },
      },
      {
        year: 1950.75,
        label: 'September 1950: Pusan defense, Inchon landing',
        control: {
          'north-korea': ['North Korea'],
          'south-korea': ['South Korea'],
          'china-prc': ['China'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'ussr': ['Russia'],
        },
      },
      {
        year: 1950.83,
        label: 'November 1950: UN pushes to the Yalu',
        control: {
          'un-coalition': ['North Korea', 'South Korea'],
          'china-prc': ['China'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'ussr': ['Russia'],
        },
      },
      {
        year: 1951.1,
        label: 'January 1951: Chinese intervention, UN driven back',
        control: {
          'north-korea': ['North Korea'],
          'south-korea': ['South Korea'],
          'china-prc': ['China'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'ussr': ['Russia'],
        },
      },
      {
        year: 1953.6,
        label: 'July 1953: Armistice at the 38th parallel',
        control: {
          'north-korea': ['North Korea'],
          'south-korea': ['South Korea'],
          'china-prc': ['China'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
          'canada': ['Canada'],
          'australia': ['Australia'],
          'new-zealand': ['New Zealand'],
          'ussr': ['Russia'],
        },
      },
    ],
  },
  {
    war: 'Vietnam War',
    snapshots: [
      {
        year: 1954.7,
        label: 'July 1954: Geneva partition at the 17th parallel',
        control: {
          'north-vietnam': ['Vietnam'],
          'south-vietnam': ['Cambodia', 'Laos'],
          'china-prc': ['China'],
          'us': ['United States', 'Philippines'],
          'ussr': ['Russia'],
          'uk': ['United Kingdom'],
        },
      },
      {
        year: 1965.2,
        label: 'February 1965: US ground escalation begins',
        control: {
          'north-vietnam': ['Vietnam'],
          'south-vietnam': ['Cambodia', 'Laos'],
          'china-prc': ['China'],
          'us': ['United States', 'Philippines', 'Thailand', 'South Korea', 'Australia'],
          'ussr': ['Russia'],
        },
      },
      {
        year: 1968.1,
        label: 'January 1968: Tet Offensive',
        control: {
          'north-vietnam': ['Vietnam', 'Laos'],
          'south-vietnam': ['Cambodia'],
          'china-prc': ['China'],
          'us': ['United States', 'Philippines', 'Thailand', 'South Korea', 'Australia'],
          'ussr': ['Russia'],
        },
      },
      {
        year: 1973.1,
        label: 'January 1973: Paris Peace Accords',
        control: {
          'north-vietnam': ['Vietnam'],
          'south-vietnam': ['Cambodia', 'Laos'],
          'china-prc': ['China'],
          'us': ['United States', 'Philippines', 'Thailand', 'South Korea', 'Australia'],
          'ussr': ['Russia'],
        },
      },
      {
        year: 1975.3,
        label: 'April 1975: Fall of Saigon',
        control: {
          'north-vietnam': ['Vietnam', 'Cambodia', 'Laos'],
          'china-prc': ['China'],
          'us': ['United States', 'Philippines'],
          'ussr': ['Russia'],
        },
      },
    ],
  },
  {
    war: 'Iraq War',
    snapshots: [
      {
        year: 2003.2,
        label: 'March 2003: Coalition invasion',
        control: {
          'iraq-saddam': ['Iraq'],
          'coalition': ['United States', 'United Kingdom', 'Australia', 'Poland'],
          'syria': ['Syria'],
          'turkey': ['Turkey'],
        },
      },
      {
        year: 2003.5,
        label: 'May 2003: Baghdad falls',
        control: {
          'coalition': ['United States', 'United Kingdom', 'Australia', 'Poland', 'Iraq'],
          'syria': ['Syria'],
          'turkey': ['Turkey'],
        },
      },
      {
        year: 2006.8,
        label: 'Late 2006: Sectarian civil war',
        control: {
          'iraq-government': ['Iraq'],
          'coalition': ['United States', 'United Kingdom', 'Australia'],
          'syria': ['Syria'],
          'turkey': ['Turkey'],
        },
      },
      {
        year: 2011.9,
        label: 'December 2011: US withdrawal',
        control: {
          'iraq-government': ['Iraq'],
          'us': ['United States'],
          'syria': ['Syria'],
          'turkey': ['Turkey'],
        },
      },
    ],
  },
  {
    war: 'War in Afghanistan (2001–2021)',
    snapshots: [
      {
        year: 2001.8,
        label: 'October 2001: US strikes the Taliban',
        control: {
          'taliban': ['Afghanistan'],
          'coalition': ['United States', 'United Kingdom', 'Canada'],
          'pakistan': ['Pakistan'],
        },
      },
      {
        year: 2002.1,
        label: 'January 2002: Northern Alliance enters Kabul',
        control: {
          'afghan-government': ['Afghanistan'],
          'coalition': ['United States', 'United Kingdom', 'Canada', 'Germany', 'Italy', 'France', 'Australia'],
        },
      },
      {
        year: 2014.6,
        label: 'July 2014: NATO combat mission ends',
        control: {
          'afghan-government': ['Afghanistan'],
          'coalition': ['United States', 'United Kingdom'],
        },
      },
      {
        year: 2021.6,
        label: 'August 2021: Kabul falls, Taliban return',
        control: {
          'taliban': ['Afghanistan'],
          'us': ['United States'],
        },
      },
    ],
  },
  {
    war: 'Spanish–American War',
    snapshots: [
      {
        year: 1898.3,
        label: 'April 1898: USS Maine, war declared',
        control: {
          'spain': ['Spain', 'Cuba', 'Philippines', 'Puerto Rico'],
          'us': ['United States'],
        },
      },
      {
        year: 1898.6,
        label: 'August 1898: Spanish colonies fall',
        control: {
          'us': ['United States', 'Cuba', 'Philippines', 'Puerto Rico'],
          'spain': ['Spain'],
        },
      },
    ],
  },
  {
    war: 'Crusades',
    snapshots: [
      {
        year: 1095.0,
        label: '1095: Council of Clermont, call for crusade',
        control: {
          'byzantine': ['Greece', 'Turkey', 'Bulgaria', 'Albania', 'Macedonia', 'Serbia'],
          'seljuk': ['Iran', 'Iraq', 'Syria', 'Jordan', 'Lebanon', 'Israel'],
          'fatimid': ['Egypt', 'Libya'],
        },
      },
      {
        year: 1099.6,
        label: 'July 1099: Jerusalem taken',
        control: {
          'crusader': ['Israel', 'Lebanon', 'Jordan', 'Syria'],
          'byzantine': ['Greece', 'Turkey', 'Bulgaria', 'Albania', 'Macedonia'],
          'fatimid': ['Egypt', 'Libya'],
          'seljuk': ['Iran', 'Iraq'],
        },
      },
      {
        year: 1144.9,
        label: '1144: Edessa falls, Second Crusade called',
        control: {
          'crusader': ['Israel', 'Lebanon', 'Jordan'],
          'saracen': ['Syria', 'Iraq', 'Iran'],
          'byzantine': ['Greece', 'Turkey', 'Bulgaria'],
          'fatimid': ['Egypt'],
        },
      },
      {
        year: 1187.7,
        label: 'July 1187: Hattin, Jerusalem retaken by Saladin',
        control: {
          'crusader': ['Lebanon'],
          'saracen': ['Israel', 'Jordan', 'Syria', 'Iraq', 'Egypt'],
          'byzantine': ['Greece', 'Turkey', 'Bulgaria'],
        },
      },
      {
        year: 1291.5,
        label: 'May 1291: Fall of Acre, end of crusader Levant',
        control: {
          'saracen': ['Israel', 'Lebanon', 'Jordan', 'Syria', 'Egypt', 'Iraq'],
          'byzantine': ['Greece', 'Turkey'],
        },
      },
    ],
  },
  {
    war: 'Mongol invasions',
    snapshots: [
      {
        year: 1206.0,
        label: '1206: Genghis Khan unifies the Mongol tribes',
        control: {
          'mongol': ['Mongolia'],
          'china': ['China'],
          'russia': ['Russia'],
        },
      },
      {
        year: 1227.0,
        label: '1227: Death of Genghis, Mongols hold north China and central Asia',
        control: {
          'mongol': ['Mongolia', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Uzbekistan', 'Turkmenistan'],
          'china': ['China'],
        },
      },
      {
        year: 1241.4,
        label: 'April 1241: Legnica and Mohi, Mongols at the gates of Europe',
        control: {
          'mongol': ['Mongolia', 'China', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Uzbekistan', 'Turkmenistan', 'Russia', 'Belarus', 'Ukraine', 'Iran', 'Afghanistan', 'Pakistan', 'Poland', 'Hungary', 'Romania', 'Bulgaria'],
        },
      },
      {
        year: 1260.7,
        label: 'September 1260: Ain Jalut, Mongol westward advance halted',
        control: {
          'mongol': ['Mongolia', 'China', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Uzbekistan', 'Turkmenistan', 'Russia', 'Belarus', 'Ukraine', 'Iran', 'Iraq', 'Afghanistan', 'Pakistan'],
          'saracen': ['Syria', 'Jordan', 'Israel', 'Lebanon', 'Egypt'],
        },
      },
      {
        year: 1294.0,
        label: '1294: Kublai Khan dies, Mongol Empire at full extent',
        control: {
          'mongol': ['Mongolia', 'China', 'North Korea', 'South Korea', 'Kazakhstan', 'Kyrgyzstan', 'Tajikistan', 'Uzbekistan', 'Turkmenistan', 'Russia', 'Belarus', 'Ukraine', 'Iran', 'Iraq', 'Afghanistan', 'Pakistan', 'Georgia', 'Armenia', 'Azerbaijan'],
        },
      },
    ],
  },
  {
    war: 'Second Sino-Japanese War',
    snapshots: [
      {
        year: 1937.6,
        label: 'July 1937: Marco Polo Bridge incident',
        control: {
          'roc-china': ['China'],
          'imperial-japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
          'ussr': ['Russia', 'Mongolia'],
        },
      },
      {
        year: 1940.0,
        label: '1940: Japanese forces hold Chinese coast and Manchuria',
        control: {
          'roc-china': ['China'],
          'imperial-japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
          'ussr': ['Russia', 'Mongolia'],
        },
      },
      {
        year: 1945.7,
        label: 'September 1945: Japan surrenders',
        control: {
          'roc-china': ['China', 'Taiwan'],
          'us': ['Japan', 'South Korea'],
          'ussr': ['Russia', 'Mongolia', 'North Korea'],
        },
      },
    ],
  },
  {
    war: 'Falklands War',
    snapshots: [
      {
        year: 1982.25,
        label: 'April 1982: Argentine forces seize the Falklands',
        control: {
          'argentina': ['Argentina', 'Chile'],
          'uk': ['United Kingdom'],
        },
      },
      {
        year: 1982.5,
        label: 'June 1982: British task force retakes the islands',
        control: {
          'argentina': ['Argentina'],
          'uk': ['United Kingdom', 'Chile'],
        },
      },
    ],
  },
  {
    war: 'War of 1812',
    snapshots: [
      {
        year: 1812.5,
        label: 'June 1812: United States declares war',
        control: {
          'us': ['United States'],
          'british-empire': ['United Kingdom', 'Canada'],
        },
      },
      {
        year: 1814.7,
        label: 'August 1814: Washington burned',
        control: {
          'us': ['United States'],
          'british-empire': ['United Kingdom', 'Canada'],
        },
      },
      {
        year: 1815.1,
        label: 'January 1815: New Orleans, Treaty of Ghent ratified',
        control: {
          'us': ['United States'],
          'british-empire': ['United Kingdom', 'Canada'],
        },
      },
    ],
  },
  {
    war: 'Crimean War',
    snapshots: [
      {
        year: 1853.5,
        label: 'July 1853: Russian troops enter the Danubian Principalities',
        control: {
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'ottoman-burgundy': ['Turkey', 'Bulgaria', 'Romania', 'Greece', 'Serbia', 'Macedonia', 'Albania', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Egypt', 'Libya'],
          'uk': ['United Kingdom'],
          'french-empire': ['France'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
        },
      },
      {
        year: 1854.3,
        label: 'March 1854: UK and France join the Ottomans',
        control: {
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'ottoman-burgundy': ['Turkey', 'Bulgaria', 'Romania', 'Greece', 'Serbia', 'Macedonia', 'Albania', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Egypt', 'Libya'],
          'uk': ['United Kingdom'],
          'french-empire': ['France'],
        },
      },
      {
        year: 1856.2,
        label: 'March 1856: Treaty of Paris',
        control: {
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'ottoman-burgundy': ['Turkey', 'Bulgaria', 'Romania', 'Greece', 'Serbia', 'Macedonia', 'Albania', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia', 'Egypt', 'Libya'],
          'uk': ['United Kingdom'],
          'french-empire': ['France'],
        },
      },
    ],
  },
  {
    war: 'Franco-Prussian War',
    snapshots: [
      {
        year: 1870.6,
        label: 'July 1870: France declares war',
        control: {
          'prussian-blue': ['Germany'],
          'french-empire': ['France', 'Algeria', 'Tunisia', 'Morocco'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary'],
          'uk': ['United Kingdom'],
        },
      },
      {
        year: 1870.75,
        label: 'September 1870: Sedan, Napoleon III captured',
        control: {
          'prussian-blue': ['Germany'],
          'french-empire': ['France', 'Algeria', 'Tunisia', 'Morocco'],
        },
      },
      {
        year: 1871.4,
        label: 'May 1871: Treaty of Frankfurt, Alsace-Lorraine ceded',
        control: {
          'prussian-blue': ['Germany'],
          'french-empire': ['France', 'Algeria', 'Tunisia', 'Morocco'],
        },
      },
    ],
  },
  {
    war: 'Russo-Japanese War',
    snapshots: [
      {
        year: 1904.1,
        label: 'February 1904: Japanese strike Port Arthur',
        control: {
          'imperial-japan': ['Japan'],
          'russian-green': ['Russia', 'Belarus', 'Ukraine', 'Kazakhstan', 'Mongolia'],
          'china': ['China'],
          'roc-china': ['Taiwan', 'North Korea', 'South Korea'],
        },
      },
      {
        year: 1905.6,
        label: 'September 1905: Treaty of Portsmouth',
        control: {
          'imperial-japan': ['Japan', 'North Korea', 'South Korea', 'Taiwan'],
          'russian-green': ['Russia', 'Belarus', 'Ukraine', 'Kazakhstan', 'Mongolia'],
          'china': ['China'],
        },
      },
    ],
  },
  {
    war: 'Greek War of Independence',
    snapshots: [
      {
        year: 1821.2,
        label: 'March 1821: Uprising in the Peloponnese',
        control: {
          'ottoman-burgundy': ['Turkey', 'Greece', 'Bulgaria', 'Albania', 'Macedonia', 'Serbia', 'Romania', 'Egypt', 'Libya', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Iraq', 'Saudi Arabia'],
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'uk': ['United Kingdom'],
          'french-empire': ['France'],
        },
      },
      {
        year: 1827.8,
        label: 'October 1827: Navarino, Ottoman fleet sunk',
        control: {
          'ottoman-burgundy': ['Turkey', 'Greece', 'Bulgaria', 'Albania', 'Macedonia', 'Serbia', 'Romania', 'Egypt', 'Libya', 'Syria', 'Lebanon', 'Israel', 'Jordan'],
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'uk': ['United Kingdom'],
          'french-empire': ['France'],
        },
      },
      {
        year: 1832.4,
        label: 'May 1832: Treaty of Constantinople, Greek independence',
        control: {
          'greek-slate': ['Greece'],
          'ottoman-burgundy': ['Turkey', 'Bulgaria', 'Albania', 'Macedonia', 'Serbia', 'Romania', 'Egypt', 'Libya', 'Syria', 'Lebanon', 'Israel', 'Jordan'],
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'uk': ['United Kingdom'],
          'french-empire': ['France'],
        },
      },
    ],
  },
  {
    war: 'Mexican-American War',
    snapshots: [
      {
        year: 1846.4,
        label: 'May 1846: United States declares war',
        control: {
          'us': ['United States'],
          'mexico': ['Mexico'],
          'uk': [],
          'canada': ['Canada'],
          'spain': ['Spain', 'Cuba', 'Puerto Rico', 'Philippines'],
        },
      },
      {
        year: 1847.7,
        label: 'September 1847: Mexico City falls',
        control: {
          'us': ['United States'],
          'mexico': ['Mexico'],
        },
      },
      {
        year: 1848.2,
        label: 'February 1848: Treaty of Guadalupe Hidalgo',
        control: {
          'us': ['United States'],
          'mexico': ['Mexico'],
        },
      },
    ],
  },
  {
    war: 'French Revolutionary Wars',
    snapshots: [
      {
        year: 1792.4,
        label: 'April 1792: France declares war on Austria',
        control: {
          'kingdom-france-bourbon': ['France'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia', 'Belgium', 'Luxembourg'],
          'prussian-blue': ['Germany', 'Poland'],
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'uk': ['United Kingdom', 'Ireland'],
          'spain': ['Spain', 'Portugal'],
          'habsburg-spain': ['Italy'],
        },
      },
      {
        year: 1796.5,
        label: 'May 1796: Napoleon takes the Army of Italy across the Alps',
        control: {
          'kingdom-france-bourbon': ['France', 'Belgium', 'Luxembourg', 'Netherlands'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia', 'Italy'],
          'prussian-blue': ['Germany', 'Poland'],
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'uk': ['United Kingdom', 'Ireland'],
          'spain': ['Spain', 'Portugal'],
        },
      },
      {
        year: 1800.6,
        label: 'June 1800: Marengo, French dominance in Italy restored',
        control: {
          'kingdom-france-bourbon': ['France', 'Belgium', 'Luxembourg', 'Netherlands', 'Italy', 'Switzerland'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'prussian-blue': ['Germany', 'Poland'],
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'uk': ['United Kingdom', 'Ireland'],
          'spain': ['Spain', 'Portugal'],
        },
      },
      {
        year: 1802.2,
        label: 'March 1802: Treaty of Amiens, brief peace',
        control: {
          'kingdom-france-bourbon': ['France', 'Belgium', 'Luxembourg', 'Netherlands', 'Italy', 'Switzerland'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'prussian-blue': ['Germany', 'Poland'],
          'russian-green': ['Russia', 'Ukraine', 'Belarus'],
          'uk': ['United Kingdom', 'Ireland'],
          'spain': ['Spain', 'Portugal'],
        },
      },
    ],
  },
  {
    war: "Hundred Years' War",
    snapshots: [
      {
        year: 1337.3,
        label: 'May 1337: Edward III claims the French crown',
        control: {
          'kingdom-england': ['United Kingdom', 'Ireland'],
          'kingdom-france-bourbon': ['France'],
          'habsburg-spain': ['Spain', 'Portugal'],
          'austria': ['Germany', 'Czechia', 'Austria'],
        },
      },
      {
        year: 1360.4,
        label: 'May 1360: Treaty of Brétigny, English holdings at their peak',
        control: {
          'kingdom-england': ['United Kingdom', 'Ireland'],
          'kingdom-france-bourbon': ['France'],
          'habsburg-spain': ['Spain', 'Portugal'],
        },
      },
      {
        year: 1429.4,
        label: 'May 1429: Joan of Arc lifts the siege of Orléans',
        control: {
          'kingdom-england': ['United Kingdom', 'Ireland'],
          'kingdom-france-bourbon': ['France'],
        },
      },
      {
        year: 1453.6,
        label: 'July 1453: Castillon, English driven from France',
        control: {
          'kingdom-england': ['United Kingdom', 'Ireland'],
          'kingdom-france-bourbon': ['France'],
        },
      },
    ],
  },
  {
    war: "Seven Years' War",
    snapshots: [
      {
        year: 1756.5,
        label: '1756: Prussia opens with the invasion of Saxony',
        control: {
          'prussia': ['Germany'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'french-empire': ['France'],
          'british-empire': ['United Kingdom', 'Canada', 'India'],
          'russia': ['Russia'],
          'spain': ['Spain', 'Mexico'],
        },
      },
      {
        year: 1759.7,
        label: '1759: Annus Mirabilis, Britain takes Quebec',
        control: {
          'prussia': ['Germany'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'french-empire': ['France'],
          'british-empire': ['United Kingdom', 'Canada', 'India'],
          'russia': ['Russia'],
          'spain': ['Spain', 'Mexico'],
        },
      },
      {
        year: 1763.2,
        label: 'February 1763: Treaty of Paris, Britain wins North America',
        control: {
          'prussia': ['Germany'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'french-empire': ['France'],
          'british-empire': ['United Kingdom', 'Canada', 'India'],
          'russia': ['Russia'],
          'spain': ['Spain', 'Mexico'],
        },
      },
    ],
  },
  {
    war: 'Wars of Alexander the Great',
    snapshots: [
      {
        year: -336,
        label: '336 BC: Alexander inherits Macedon',
        control: {
          'greek-slate': ['Greece', 'Macedonia', 'Bulgaria', 'Albania'],
          'persian-purple': ['Iran', 'Iraq', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Turkey', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
        },
      },
      {
        year: -333,
        label: '333 BC: Issus — Persia routed at the Cilician Gates',
        control: {
          'greek-slate': ['Greece', 'Macedonia', 'Bulgaria', 'Albania', 'Turkey'],
          'persian-purple': ['Iran', 'Iraq', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
        },
      },
      {
        year: -331,
        label: '331 BC: Gaugamela — the Persian Empire breaks',
        control: {
          'greek-slate': ['Greece', 'Macedonia', 'Bulgaria', 'Albania', 'Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Iraq'],
          'persian-purple': ['Iran', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
        },
      },
      {
        year: -326,
        label: '326 BC: Hydaspes — Alexander reaches the Indus',
        control: {
          'greek-slate': ['Greece', 'Macedonia', 'Bulgaria', 'Albania', 'Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Iraq', 'Iran', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
        },
      },
      {
        year: -323,
        label: '323 BC: Alexander dies at Babylon, empire at peak',
        control: {
          'greek-slate': ['Greece', 'Macedonia', 'Bulgaria', 'Albania', 'Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Iraq', 'Iran', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
        },
      },
    ],
  },
  {
    war: 'Greco-Persian Wars',
    snapshots: [
      {
        year: -499,
        label: '499 BC: Ionian Revolt',
        control: {
          'persian-purple': ['Iran', 'Iraq', 'Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
          'greek-slate': ['Greece', 'Albania', 'Macedonia', 'Bulgaria'],
        },
      },
      {
        year: -490,
        label: '490 BC: Marathon — Athens repels the first invasion',
        control: {
          'persian-purple': ['Iran', 'Iraq', 'Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
          'greek-slate': ['Greece', 'Albania', 'Macedonia', 'Bulgaria'],
        },
      },
      {
        year: -480,
        label: '480 BC: Thermopylae, Salamis — second invasion broken',
        control: {
          'persian-purple': ['Iran', 'Iraq', 'Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
          'greek-slate': ['Greece', 'Albania', 'Macedonia', 'Bulgaria'],
        },
      },
      {
        year: -449,
        label: '449 BC: Peace of Callias — Persia abandons the Aegean',
        control: {
          'persian-purple': ['Iran', 'Iraq', 'Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan', 'Egypt', 'Libya', 'Saudi Arabia', 'Afghanistan', 'Pakistan'],
          'greek-slate': ['Greece', 'Albania', 'Macedonia', 'Bulgaria'],
        },
      },
    ],
  },
  {
    war: 'Second Punic War',
    snapshots: [
      {
        year: -218,
        label: '218 BC: Hannibal crosses the Alps',
        control: {
          'roman-crimson': ['Italy', 'France', 'Spain', 'Portugal'],
          'carthage-purple': ['Tunisia', 'Algeria', 'Morocco', 'Libya'],
        },
      },
      {
        year: -216,
        label: '216 BC: Cannae — Rome at the brink',
        control: {
          'roman-crimson': ['France', 'Spain', 'Portugal'],
          'carthage-purple': ['Tunisia', 'Algeria', 'Morocco', 'Libya', 'Italy'],
        },
      },
      {
        year: -211,
        label: '211 BC: Roman recovery, Spain contested',
        control: {
          'roman-crimson': ['Italy', 'France'],
          'carthage-purple': ['Tunisia', 'Algeria', 'Morocco', 'Libya', 'Spain', 'Portugal'],
        },
      },
      {
        year: -202,
        label: '202 BC: Zama — Carthage broken',
        control: {
          'roman-crimson': ['Italy', 'France', 'Spain', 'Portugal'],
          'carthage-purple': ['Tunisia', 'Algeria', 'Morocco', 'Libya'],
        },
      },
    ],
  },
  {
    war: "Thirty Years' War",
    snapshots: [
      {
        year: 1618,
        label: '1618: Defenestration of Prague',
        control: {
          'habsburg-spain': ['Spain', 'Portugal', 'Belgium', 'Netherlands', 'Italy', 'Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'prussian-blue': ['Germany'],
          'kingdom-france-bourbon': ['France'],
          'sweden-empire': ['Sweden', 'Norway', 'Finland', 'Estonia', 'Latvia'],
          'denmark-norway': ['Denmark'],
          'ottoman-burgundy': ['Turkey', 'Bulgaria', 'Romania', 'Serbia', 'Greece', 'Albania'],
        },
      },
      {
        year: 1630,
        label: '1630: Gustavus Adolphus lands at Peenemünde',
        control: {
          'habsburg-spain': ['Spain', 'Portugal', 'Belgium', 'Italy', 'Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'prussian-blue': ['Germany'],
          'kingdom-france-bourbon': ['France'],
          'sweden-empire': ['Sweden', 'Norway', 'Finland', 'Estonia', 'Latvia'],
          'denmark-norway': ['Denmark'],
          'dutch-republic': ['Netherlands'],
        },
      },
      {
        year: 1645,
        label: '1645: France and Sweden push Habsburgs back',
        control: {
          'habsburg-spain': ['Spain', 'Portugal', 'Italy', 'Austria', 'Czechia', 'Slovakia', 'Hungary'],
          'prussian-blue': ['Germany'],
          'kingdom-france-bourbon': ['France', 'Belgium'],
          'sweden-empire': ['Sweden', 'Norway', 'Finland', 'Estonia', 'Latvia'],
          'dutch-republic': ['Netherlands'],
        },
      },
      {
        year: 1648,
        label: '1648: Peace of Westphalia',
        control: {
          'habsburg-spain': ['Spain', 'Portugal', 'Italy', 'Austria', 'Czechia', 'Slovakia', 'Hungary'],
          'prussian-blue': ['Germany'],
          'kingdom-france-bourbon': ['France', 'Belgium'],
          'sweden-empire': ['Sweden', 'Norway', 'Finland'],
          'dutch-republic': ['Netherlands'],
        },
      },
    ],
  },
  {
    // Aliased under both names so battles tagged "Russo-Ukrainian War" (the
    // DB-canonical name, 204 battles) AND "Russian invasion of Ukraine" (9
    // battles) both surface the same territory shading. The previous keying
    // left the 204-battle bucket with NO snapshot match → no colored
    // territory → polygons fell back to the generic blue stub, which
    // rendered both Russia and Ukraine as the same blue tint.
    war: 'Russo-Ukrainian War',
    snapshots: [
      {
        year: 2022.16,
        label: 'February 24 2022: Full-scale invasion',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway'],
        },
      },
      {
        year: 2022.7,
        label: 'September 2022: Kharkiv counter-offensive',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway'],
        },
      },
      {
        year: 2024.62,
        label: 'August 2024: Ukraine breaches into Kursk Oblast',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
          'us': ['United States', 'Canada'],
          'uk': ['United Kingdom'],
          'france': ['France', 'Germany', 'Italy', 'Spain', 'Poland', 'Romania', 'Estonia', 'Latvia', 'Lithuania', 'Finland', 'Sweden', 'Norway'],
        },
      },
    ],
  },
  {
    war: 'Iran-Israel direct strikes 2024',
    snapshots: [
      {
        year: 2024.3,
        label: 'April 2024: Iran fires 300 drones and missiles at Israel',
        control: {
          'persian-purple': ['Iran', 'Iraq', 'Syria'],
          'us': ['United States'],
          'uk': ['United Kingdom', 'Jordan'],
          'south-korea-blue': ['Israel'],
        },
      },
      {
        year: 2024.78,
        label: 'October 2024: Israel strikes deep into Iran',
        control: {
          'persian-purple': ['Iran', 'Iraq', 'Syria'],
          'us': ['United States'],
          'uk': ['United Kingdom', 'Jordan'],
          'south-korea-blue': ['Israel'],
        },
      },
    ],
  },
  {
    war: 'Israel–Hamas war',
    snapshots: [
      {
        year: 2023.78,
        label: 'October 7 2023: Hamas attack, Israeli response begins',
        control: {
          'hamas': ['Palestine'],
          'south-korea-blue': ['Israel'],
          'persian-purple': ['Iran', 'Lebanon', 'Syria'],
          'us': ['United States'],
          'uk': ['United Kingdom', 'Egypt', 'Jordan'],
        },
      },
      {
        year: 2024.5,
        label: 'Mid-2024: Rafah operation, regional escalation',
        control: {
          'hamas': ['Palestine'],
          'south-korea-blue': ['Israel'],
          'persian-purple': ['Iran', 'Lebanon', 'Syria'],
          'us': ['United States'],
          'uk': ['United Kingdom', 'Egypt', 'Jordan'],
        },
      },
      {
        year: 2025.1,
        label: 'January 2025: First-phase ceasefire',
        control: {
          'hamas': ['Palestine'],
          'south-korea-blue': ['Israel'],
          'persian-purple': ['Iran', 'Lebanon', 'Syria'],
          'us': ['United States'],
          'uk': ['United Kingdom', 'Egypt', 'Jordan'],
        },
      },
    ],
  },
  {
    war: 'Israel-Hezbollah conflict 2024',
    snapshots: [
      {
        year: 2024.7,
        label: 'September 2024: Pager attacks, leadership decapitated',
        control: {
          'persian-purple': ['Iran', 'Lebanon', 'Syria'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
          'south-korea-blue': ['Israel'],
        },
      },
      {
        year: 2024.9,
        label: 'November 2024: Ground incursion, ceasefire',
        control: {
          'persian-purple': ['Iran', 'Lebanon', 'Syria'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
          'south-korea-blue': ['Israel'],
        },
      },
    ],
  },
  {
    war: 'Soviet–Afghan War',
    snapshots: [
      {
        year: 1979.92,
        label: 'December 1979: Soviet invasion',
        control: {
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan', 'Afghanistan'],
          'taliban': ['Pakistan'],
          'us': ['United States'],
          'china-prc': ['China'],
        },
      },
      {
        year: 1986,
        label: '1986: Stinger missiles arrive with the mujahideen',
        control: {
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan', 'Afghanistan'],
          'taliban': ['Pakistan'],
          'us': ['United States'],
          'china-prc': ['China'],
        },
      },
      {
        year: 1989.13,
        label: 'February 1989: Last Soviet column crosses the Friendship Bridge',
        control: {
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'afghan-government': ['Afghanistan'],
          'taliban': ['Pakistan'],
        },
      },
    ],
  },
  {
    war: 'War of the Spanish Succession',
    snapshots: [
      {
        year: 1701,
        label: '1701: Bourbon Philip V crowned in Madrid',
        control: {
          'kingdom-france-bourbon': ['France', 'Spain', 'Portugal'],
          'habsburg-spain': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia', 'Italy'],
          'british-empire': ['United Kingdom', 'Ireland'],
          'dutch-republic': ['Netherlands', 'Belgium', 'Luxembourg'],
          'prussian-blue': ['Germany'],
        },
      },
      {
        year: 1704,
        label: '1704: Blenheim — Marlborough breaks the French line',
        control: {
          'kingdom-france-bourbon': ['France', 'Spain', 'Portugal'],
          'habsburg-spain': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia', 'Italy'],
          'british-empire': ['United Kingdom', 'Ireland'],
          'dutch-republic': ['Netherlands', 'Belgium', 'Luxembourg'],
          'prussian-blue': ['Germany'],
        },
      },
      {
        year: 1713.5,
        label: '1713: Treaty of Utrecht — Bourbon Spain, no union',
        control: {
          'kingdom-france-bourbon': ['France', 'Spain'],
          'habsburg-spain': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia', 'Italy', 'Belgium'],
          'british-empire': ['United Kingdom', 'Ireland', 'Portugal'],
          'dutch-republic': ['Netherlands', 'Luxembourg'],
          'prussian-blue': ['Germany'],
        },
      },
    ],
  },
  {
    war: 'Mahdist War',
    snapshots: [
      {
        year: 1881,
        label: '1881: The Mahdi declares jihad against Anglo-Egyptian rule',
        control: {
          'british-empire': ['United Kingdom', 'Egypt', 'South Africa', 'Kenya', 'India'],
          'mongol': ['Sudan'],
          'ottoman-burgundy': ['Turkey'],
        },
      },
      {
        year: 1885,
        label: '1885: Fall of Khartoum — Gordon killed',
        control: {
          'british-empire': ['United Kingdom', 'Egypt', 'South Africa', 'Kenya', 'India'],
          'mongol': ['Sudan'],
          'ottoman-burgundy': ['Turkey'],
        },
      },
      {
        year: 1898.7,
        label: '1898: Omdurman — Kitchener reconquers the Sudan',
        control: {
          'british-empire': ['United Kingdom', 'Egypt', 'Sudan', 'South Africa', 'Kenya', 'India'],
          'ottoman-burgundy': ['Turkey'],
        },
      },
    ],
  },
  {
    war: 'Algerian War',
    snapshots: [
      {
        year: 1954.84,
        label: 'November 1954: FLN insurgency opens',
        control: {
          'french-empire': ['France', 'Algeria', 'Tunisia', 'Morocco'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
        },
      },
      {
        year: 1957.5,
        label: '1957: Battle of Algiers, paras crush the urban network',
        control: {
          'french-empire': ['France', 'Algeria', 'Tunisia', 'Morocco'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
        },
      },
      {
        year: 1962.5,
        label: 'July 1962: Évian Accords, Algerian independence',
        control: {
          'french-empire': ['France', 'Tunisia', 'Morocco'],
          'mongol': ['Algeria'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'Norman conquest of England',
    snapshots: [
      {
        year: 1066.3,
        label: 'January 1066: Edward dies, Harold crowned',
        control: {
          'kingdom-england': ['United Kingdom', 'Ireland'],
          'kingdom-france-bourbon': ['France'],
          'sweden-empire': ['Norway', 'Denmark', 'Sweden'],
        },
      },
      {
        year: 1066.82,
        label: 'October 14 1066: Hastings — Harold killed, William advances on London',
        control: {
          'kingdom-france-bourbon': ['United Kingdom', 'France'],
          'kingdom-england': ['Ireland'],
          'sweden-empire': ['Norway', 'Denmark', 'Sweden'],
        },
      },
      {
        year: 1071,
        label: '1071: Hereward the Wake defeated, conquest complete',
        control: {
          'kingdom-france-bourbon': ['United Kingdom', 'France'],
          'kingdom-england': ['Ireland'],
        },
      },
    ],
  },
  {
    war: 'Russian Civil War',
    snapshots: [
      {
        year: 1918,
        label: '1918: Reds vs Whites, Allied Intervention lands at Murmansk',
        control: {
          'ussr': ['Russia', 'Belarus', 'Ukraine'],
          'uk': ['United Kingdom'],
          'us': ['United States'],
          'french-empire': ['France'],
          'imperial-japan': ['Japan'],
          'imperial-germany': ['Germany'],
        },
      },
      {
        year: 1920,
        label: '1920: Red Army drives Whites from Crimea, war winds down',
        control: {
          'ussr': ['Russia', 'Belarus', 'Ukraine'],
          'uk': ['United Kingdom'],
          'us': ['United States'],
          'french-empire': ['France'],
          'imperial-japan': ['Japan'],
        },
      },
      {
        year: 1922,
        label: '1922: Vladivostok — last Whites evacuate, USSR proclaimed',
        control: {
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
        },
      },
    ],
  },
  {
    war: 'Boxer Rebellion',
    snapshots: [
      {
        year: 1900.5,
        label: 'Summer 1900: Eight-Nation Alliance lands at Tianjin',
        control: {
          'china-roc': ['China'],
          'imperial-japan': ['Japan'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Mongolia'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
          'french-empire': ['France'],
          'imperial-germany': ['Germany'],
          'austria': ['Austria'],
          'italy': ['Italy'],
        },
      },
      {
        year: 1901.7,
        label: 'September 1901: Boxer Protocol, indemnity imposed',
        control: {
          'china-roc': ['China'],
          'imperial-japan': ['Japan'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Mongolia'],
          'us': ['United States'],
          'uk': ['United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'Italian War of 1521–1526',
    snapshots: [
      {
        year: 1494,
        label: '1494: Charles VIII of France invades Italy',
        control: {
          'kingdom-france-bourbon': ['France'],
          'habsburg-spain': ['Spain', 'Belgium', 'Netherlands', 'Austria'],
          'italy': ['Italy'],
          'ottoman-burgundy': ['Turkey', 'Greece', 'Bulgaria'],
        },
      },
      {
        year: 1525,
        label: 'February 1525: Pavia — France crushed, Francis I captured',
        control: {
          'kingdom-france-bourbon': ['France'],
          'habsburg-spain': ['Spain', 'Belgium', 'Netherlands', 'Austria', 'Italy'],
          'ottoman-burgundy': ['Turkey', 'Greece', 'Bulgaria'],
        },
      },
      {
        year: 1559,
        label: '1559: Peace of Cateau-Cambrésis ends the wars',
        control: {
          'kingdom-france-bourbon': ['France'],
          'habsburg-spain': ['Spain', 'Belgium', 'Netherlands', 'Austria', 'Italy'],
        },
      },
    ],
  },
  {
    war: 'Second Italian War of Independence',
    snapshots: [
      {
        year: 1848,
        label: '1848: Year of Revolutions — Piedmont declares war on Austria',
        control: {
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia', 'Italy'],
          'kingdom-france-bourbon': ['France'],
          'spain': ['Spain'],
        },
      },
      {
        year: 1861,
        label: '1861: Kingdom of Italy proclaimed',
        control: {
          'italy': ['Italy'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'kingdom-france-bourbon': ['France'],
        },
      },
      {
        year: 1871,
        label: '1871: Rome captured, unification complete',
        control: {
          'italy': ['Italy'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Slovenia', 'Croatia'],
          'french-empire': ['France'],
        },
      },
    ],
  },
  {
    war: 'Roman conquest of Britain',
    snapshots: [
      {
        year: 43,
        label: '43 AD: Aulus Plautius lands in Kent',
        control: {
          'roman-crimson': ['Italy', 'France', 'Spain', 'Portugal', 'Belgium', 'Netherlands'],
          'mongol': ['United Kingdom'],
        },
      },
      {
        year: 60,
        label: '60 AD: Boudica rises against Rome',
        control: {
          'roman-crimson': ['Italy', 'France', 'Spain', 'Portugal', 'Belgium', 'Netherlands', 'United Kingdom'],
        },
      },
      {
        year: 122,
        label: '122 AD: Hadrian\'s Wall — Rome accepts a fixed northern frontier',
        control: {
          'roman-crimson': ['Italy', 'France', 'Spain', 'Portugal', 'Belgium', 'Netherlands', 'United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'Gallic Wars',
    snapshots: [
      {
        year: -58,
        label: '58 BC: Caesar accepts the Helvetii alliance request',
        control: {
          'roman-crimson': ['Italy', 'Greece', 'Spain', 'Portugal', 'Turkey', 'Syria'],
          'mongol': ['France', 'Belgium', 'Switzerland', 'Luxembourg'],
        },
      },
      {
        year: -52,
        label: '52 BC: Alesia — Vercingetorix surrenders',
        control: {
          'roman-crimson': ['Italy', 'Greece', 'Spain', 'Portugal', 'Turkey', 'Syria', 'France', 'Belgium', 'Switzerland', 'Luxembourg'],
        },
      },
    ],
  },
  {
    war: 'First Punic War',
    snapshots: [
      {
        year: -264,
        label: '264 BC: Romans land in Sicily',
        control: {
          'roman-crimson': ['Italy'],
          'carthage-purple': ['Tunisia', 'Algeria', 'Morocco', 'Libya', 'Spain'],
        },
      },
      {
        year: -241,
        label: '241 BC: Aegates Islands — Carthage cedes Sicily',
        control: {
          'roman-crimson': ['Italy'],
          'carthage-purple': ['Tunisia', 'Algeria', 'Morocco', 'Libya', 'Spain'],
        },
      },
    ],
  },
  {
    war: 'Anglo-Zulu War',
    snapshots: [
      {
        year: 1879.0,
        label: 'January 1879: British column crosses the Buffalo River',
        control: {
          'british-empire': ['United Kingdom', 'South Africa'],
          'mongol': ['Eswatini', 'Lesotho'],
        },
      },
      {
        year: 1879.6,
        label: 'July 1879: Ulundi — Zulu kingdom dissolved',
        control: {
          'british-empire': ['United Kingdom', 'South Africa', 'Eswatini', 'Lesotho'],
        },
      },
    ],
  },
  {
    war: 'American Civil War',
    snapshots: [
      {
        year: 1861.3,
        label: 'April 1861: Secession crisis',
        control: {
          'us-union': ['United States'],
          'us-confederacy': [
            'South Carolina', 'Mississippi', 'Florida', 'Alabama', 'Georgia',
            'Louisiana', 'Texas', 'Virginia', 'Arkansas', 'Tennessee', 'North Carolina',
          ],
        },
      },
    ],
  },
  {
    war: 'American Revolutionary War',
    snapshots: [
      {
        year: 1776.5,
        label: 'July 1776: Declaration of Independence',
        control: {
          'continental-army': ['United States'],
          'british-empire': ['United Kingdom', 'Canada'],
          'france': ['France'],
          'spain': ['Spain'],
        },
      },
    ],
  },
  {
    war: 'Second Boer War',
    snapshots: [
      {
        year: 1899.8,
        label: 'October 1899: War declared',
        control: {
          'british-empire': ['United Kingdom', 'India', 'Australia', 'New Zealand', 'Canada'],
          'us-confederacy': ['South Africa', 'Eswatini', 'Lesotho'],
        },
      },
    ],
  },
  {
    war: 'Gulf War',
    snapshots: [
      {
        year: 1991.1,
        label: 'January 1991: Operation Desert Storm',
        control: {
          'us': ['United States', 'United Kingdom', 'France', 'Canada', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Denmark', 'Norway', 'Greece'],
          'un-coalition': ['Saudi Arabia', 'Kuwait', 'Egypt', 'Syria', 'United Arab Emirates', 'Qatar', 'Bahrain', 'Oman'],
          'iraq': ['Iraq'],
        },
      },
    ],
  },
  {
    war: 'Hundred Years\' War',
    snapshots: [
      {
        year: 1429.3,
        label: 'April 1429: Joan of Arc and the Siege of Orléans',
        control: {
          'continental-army': ['France'],
          'british-empire': ['United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'Wars of the Roses',
    snapshots: [
      {
        year: 1471.4,
        label: 'May 1471: Battle of Tewkesbury',
        control: {
          'redcoat-red': ['United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'Crimean War',
    snapshots: [
      {
        year: 1854.6,
        label: 'September 1854: Allied landing in the Crimea',
        control: {
          'ottoman': ['Turkey'],
          'us': ['United Kingdom', 'France', 'Italy'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan'],
        },
      },
    ],
  },
  {
    war: 'Vietnam War',
    snapshots: [
      {
        year: 1965.5,
        label: 'July 1965: US ground escalation',
        control: {
          'north-vietnam': ['Vietnam'],
          'us': ['United States', 'Australia', 'New Zealand', 'Thailand', 'Philippines', 'South Korea'],
        },
      },
    ],
  },
  {
    war: 'Iran–Iraq War',
    snapshots: [
      {
        year: 1980.9,
        label: 'September 1980: Iraqi invasion',
        control: {
          'iraq': ['Iraq'],
          'iran': ['Iran'],
        },
      },
    ],
  },
  {
    war: 'Korean War',
    // Korean War already has snapshots above (line 593). Skip — leaving
    // here as a placeholder if curators want sub-phase entries later.
    snapshots: [],
  },
  {
    war: 'Eighty Years\' War',
    snapshots: [
      {
        year: 1581.5,
        label: 'July 1581: Act of Abjuration',
        control: {
          'continental-army': ['Netherlands'],
          'spain': ['Spain', 'Belgium', 'Luxembourg', 'Portugal'],
        },
      },
    ],
  },
  {
    war: 'Thirty Years\' War',
    snapshots: [
      {
        year: 1631.5,
        label: 'September 1631: Battle of Breitenfeld',
        control: {
          'sweden': ['Sweden', 'Finland', 'Norway'],
          'continental-army': ['Netherlands'],
          'nazi-germany': ['Austria', 'Czechia', 'Hungary'],
          'spain': ['Spain'],
          'france': ['France'],
        },
      },
    ],
  },
  {
    war: 'Seven Years\' War',
    snapshots: [
      {
        year: 1759.8,
        label: '1759: Annus Mirabilis',
        control: {
          'british-empire': ['United Kingdom', 'India', 'Canada'],
          'continental-army': ['United States'],
          'france': ['France', 'Algeria'],
          'spain': ['Spain', 'Mexico'],
          'prussia': ['Germany'],
          'austria': ['Austria', 'Hungary', 'Czechia'],
          'russia': ['Russia', 'Ukraine', 'Belarus'],
        },
      },
    ],
  },
  {
    war: 'Reconquista',
    snapshots: [
      {
        year: 1492.0,
        label: 'January 1492: Surrender of Granada',
        control: {
          'spain': ['Spain'],
          'portugal': ['Portugal'],
        },
      },
    ],
  },
  {
    war: 'Great Northern War',
    snapshots: [
      {
        year: 1709.5,
        label: 'July 1709: Battle of Poltava',
        control: {
          'sweden': ['Sweden', 'Finland', 'Norway', 'Estonia', 'Latvia'],
          'russia': ['Russia', 'Ukraine', 'Belarus'],
          'denmark': ['Denmark'],
          'poland': ['Poland', 'Lithuania'],
        },
      },
    ],
  },
  {
    war: 'War of the Austrian Succession',
    snapshots: [
      {
        year: 1745.5,
        label: '1745: War in full swing',
        control: {
          'austria': ['Austria', 'Czechia', 'Hungary', 'Slovakia', 'Croatia'],
          'prussia': ['Germany'],
          'france': ['France', 'Belgium'],
          'british-empire': ['United Kingdom'],
          'spain': ['Spain'],
          'russia': ['Russia', 'Belarus', 'Ukraine'],
        },
      },
    ],
  },
  {
    war: 'Sengoku period',
    snapshots: [
      {
        year: 1582.5,
        label: '1582: Honnō-ji Incident',
        control: {
          'japan': ['Japan'],
        },
      },
    ],
  },
  {
    war: 'Peninsular War',
    snapshots: [
      {
        year: 1812.5,
        label: 'July 1812: Battle of Salamanca',
        control: {
          'nazi-germany': ['Spain', 'Portugal'],
          'british-empire': ['United Kingdom'],
          'continental-army': ['France'],
        },
      },
    ],
  },
  {
    war: 'Franco-Prussian War',
    snapshots: [
      {
        year: 1870.7,
        label: 'September 1870: Sedan and the Siege of Paris',
        control: {
          'prussia': ['Germany'],
          'france': ['France', 'Algeria'],
        },
      },
    ],
  },
  {
    war: 'Austro-Prussian War',
    snapshots: [
      {
        year: 1866.5,
        label: 'July 1866: Battle of Königgrätz',
        control: {
          'prussia': ['Germany'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary'],
          'italy': ['Italy'],
        },
      },
    ],
  },
  {
    war: 'Great Turkish War',
    snapshots: [
      {
        year: 1683.7,
        label: 'September 1683: Battle of Vienna',
        control: {
          'ottoman': ['Turkey', 'Bulgaria', 'Greece', 'Albania', 'Serbia', 'Bosnia and Herzegovina', 'Macedonia'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Croatia'],
          'poland': ['Poland', 'Lithuania'],
          'russia': ['Russia', 'Ukraine', 'Belarus'],
        },
      },
    ],
  },
  {
    war: 'War of the Spanish Succession',
    // already in earlier snapshots; leaving as placeholder
    snapshots: [],
  },
  {
    war: 'First English Civil War',
    snapshots: [
      {
        year: 1645.5,
        label: 'June 1645: Battle of Naseby',
        control: {
          'continental-army': ['United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'War of the Sixth Coalition',
    snapshots: [
      {
        year: 1813.7,
        label: 'October 1813: Battle of Leipzig',
        control: {
          'continental-army': ['France', 'Belgium', 'Netherlands', 'Luxembourg'],
          'prussia': ['Germany'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Poland'],
          'british-empire': ['United Kingdom'],
          'sweden': ['Sweden', 'Norway'],
        },
      },
    ],
  },
  {
    war: 'War of the Fifth Coalition',
    snapshots: [
      {
        year: 1809.5,
        label: 'July 1809: Battle of Wagram',
        control: {
          'continental-army': ['France', 'Belgium', 'Netherlands', 'Italy', 'Spain'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary', 'Croatia'],
          'british-empire': ['United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'First Balkan War',
    snapshots: [
      {
        year: 1912.9,
        label: 'November 1912: Bulgarian advance on Constantinople',
        control: {
          'ottoman': ['Turkey'],
          'bulgaria': ['Bulgaria'],
          'serbia': ['Serbia', 'Macedonia', 'Kosovo'],
          'greece': ['Greece'],
          'us-confederacy': ['Montenegro'],
        },
      },
    ],
  },
  {
    war: 'Paraguayan War',
    snapshots: [
      {
        year: 1866.5,
        label: '1866: Triple Alliance offensive',
        control: {
          'paraguay': ['Paraguay'],
          'brazil': ['Brazil'],
          'argentina': ['Argentina'],
          'uruguay': ['Uruguay'],
        },
      },
    ],
  },
  {
    war: 'Spanish Civil War',
    snapshots: [
      {
        year: 1937.5,
        label: '1937: Nationalist consolidation',
        control: {
          'nazi-germany': ['Spain'],
          'portugal': ['Portugal'],
        },
      },
    ],
  },
  {
    war: 'Italian War of 1521–1526',
    snapshots: [
      {
        year: 1525.2,
        label: 'February 1525: Battle of Pavia',
        control: {
          'continental-army': ['France'],
          'spain': ['Spain'],
          'nazi-germany': ['Austria', 'Czechia', 'Germany', 'Hungary'],
          'italy': ['Italy'],
          'british-empire': ['United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'January Uprising',
    snapshots: [
      {
        year: 1863.5,
        label: '1863: Polish national uprising',
        control: {
          'russia': ['Russia', 'Belarus', 'Ukraine'],
          'poland': ['Poland', 'Lithuania', 'Latvia'],
        },
      },
    ],
  },
  {
    war: 'Hungarian Revolution of 1848',
    snapshots: [
      {
        year: 1849.4,
        label: 'April 1849: Declaration of Independence',
        control: {
          'continental-army': ['Hungary'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Croatia', 'Slovenia'],
          'russia': ['Russia', 'Belarus', 'Ukraine'],
        },
      },
    ],
  },
  {
    war: 'Franco-Dutch War',
    snapshots: [
      {
        year: 1672.5,
        label: '1672 Year of Disaster',
        control: {
          'continental-army': ['France'],
          'us-confederacy': ['Netherlands'],
          'british-empire': ['United Kingdom'],
          'spain': ['Spain', 'Belgium'],
        },
      },
    ],
  },
  {
    war: 'Russo-Turkish War (1768–1774)',
    snapshots: [
      {
        year: 1770.5,
        label: '1770: Battle of Chesma',
        control: {
          'russia': ['Russia', 'Ukraine', 'Belarus'],
          'ottoman': ['Turkey', 'Bulgaria', 'Romania', 'Greece', 'Albania'],
        },
      },
    ],
  },
  {
    war: 'French and Indian War',
    snapshots: [
      {
        year: 1759.5,
        label: '1759: Plains of Abraham',
        control: {
          'british-empire': ['United Kingdom'],
          'continental-army': ['United States'],
          'france': ['France', 'Canada'],
          'spain': ['Spain'],
        },
      },
    ],
  },
  {
    war: 'Syrian civil war',
    snapshots: [
      {
        year: 2015.5,
        label: '2015: Russian intervention',
        control: {
          'syria': ['Syria'],
          'isis': ['Iraq'],
          'russia': ['Russia'],
          'turkey': ['Turkey'],
          'iran': ['Iran'],
        },
      },
    ],
  },
  {
    war: 'First Sino-Japanese War',
    snapshots: [
      {
        year: 1894.7,
        label: 'September 1894: Battle of Pyongyang',
        control: {
          'japan': ['Japan', 'Taiwan'],
          'china-roc': ['China'],
        },
      },
    ],
  },
  {
    war: 'Russo-Turkish War (1877–1878)',
    snapshots: [
      {
        year: 1877.7,
        label: 'September 1877: Siege of Plevna',
        control: {
          'russia': ['Russia', 'Ukraine', 'Belarus'],
          'ottoman': ['Turkey', 'Bulgaria', 'Romania', 'Albania', 'Macedonia', 'Bosnia and Herzegovina'],
          'serbia': ['Serbia'],
          'us-confederacy': ['Montenegro'],
        },
      },
    ],
  },
  {
    war: 'War in the Vendée',
    snapshots: [
      {
        year: 1793.8,
        label: '1793: Catholic and Royal Army',
        control: {
          'continental-army': ['France'],
        },
      },
    ],
  },
  {
    war: 'Wars of Scottish Independence',
    snapshots: [
      {
        year: 1314.5,
        label: 'June 1314: Bannockburn',
        control: {
          'continental-army': ['United Kingdom'],
        },
      },
    ],
  },
  {
    war: 'Hussite Wars',
    snapshots: [
      {
        year: 1426.5,
        label: '1426: Hussite ascendancy',
        control: {
          'continental-army': ['Czechia', 'Slovakia'],
          'nazi-germany': ['Austria', 'Germany', 'Hungary'],
        },
      },
    ],
  },
  {
    war: 'French invasion of Russia',
    snapshots: [
      {
        year: 1812.6,
        label: 'September 1812: Battle of Borodino',
        control: {
          'continental-army': ['France', 'Belgium', 'Netherlands', 'Italy', 'Switzerland', 'Germany', 'Austria'],
          'russia': ['Russia', 'Belarus', 'Ukraine', 'Lithuania', 'Estonia', 'Latvia'],
        },
      },
    ],
  },
  {
    war: 'Philippine Revolution',
    snapshots: [
      {
        year: 1898.6,
        label: 'June 1898: Declaration of Independence',
        control: {
          'continental-army': ['Philippines'],
          'spain': ['Spain'],
          'us': ['United States'],
        },
      },
    ],
  },
  {
    war: 'Russo-Turkish War (1787–1792)',
    snapshots: [
      {
        year: 1790.5,
        label: '1790: Russian breakthrough',
        control: {
          'russia': ['Russia', 'Ukraine', 'Belarus'],
          'ottoman': ['Turkey', 'Bulgaria', 'Romania', 'Greece', 'Albania'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary'],
        },
      },
    ],
  },
  {
    war: 'Finnish War',
    snapshots: [
      {
        year: 1808.9,
        label: '1808: Russian conquest of Finland',
        control: {
          'russia': ['Russia'],
          'sweden': ['Sweden', 'Finland', 'Norway'],
        },
      },
    ],
  },
  {
    war: 'Viking invasions of England',
    snapshots: [
      {
        year: 1013.9,
        label: '1013: Sweyn Forkbeard\'s conquest',
        control: {
          'continental-army': ['United Kingdom'],
          'denmark': ['Denmark', 'Sweden', 'Norway'],
        },
      },
    ],
  },
  {
    war: 'Invasion of Poland',
    snapshots: [
      {
        year: 1939.75,
        label: 'September 1939',
        control: {
          'nazi-germany': ['Germany', 'Czechia', 'Slovakia', 'Austria'],
          'ussr': ['Russia', 'Belarus', 'Ukraine'],
          'poland': ['Poland'],
        },
      },
    ],
  },
  {
    war: 'Indian Rebellion of 1857',
    snapshots: [
      {
        year: 1857.6,
        label: '1857: Sepoy Mutiny',
        control: {
          'british-empire': ['United Kingdom', 'India', 'Pakistan', 'Bangladesh'],
        },
      },
    ],
  },
  {
    war: 'Arab–Byzantine wars',
    snapshots: [
      {
        year: 636.7,
        label: 'August 636: Battle of Yarmouk',
        control: {
          'saracen': ['Saudi Arabia', 'Iraq', 'Jordan', 'Yemen', 'Oman'],
          'byzantine': ['Turkey', 'Greece', 'Syria', 'Lebanon', 'Israel', 'Palestine', 'Egypt'],
        },
      },
    ],
  },
  {
    war: 'Peloponnesian War',
    snapshots: [
      {
        year: -415,
        label: '415 BC: Sicilian Expedition',
        control: {
          'continental-army': ['Greece'],
          'persia': ['Turkey'],
        },
      },
    ],
  },
  {
    war: 'Wars of the Diadochi',
    snapshots: [
      {
        year: -301,
        label: '301 BC: Battle of Ipsus',
        control: {
          'persia': ['Iran', 'Iraq', 'Turkey', 'Syria', 'Lebanon', 'Israel', 'Jordan'],
          'continental-army': ['Greece', 'Albania', 'Macedonia'],
        },
      },
    ],
  },
  {
    war: 'Wars at the end of the Han dynasty',
    snapshots: [
      {
        year: 208.7,
        label: '208 AD: Red Cliffs',
        control: {
          'china-roc': ['China'],
        },
      },
    ],
  },
  {
    war: 'Mexican War of Independence',
    snapshots: [
      {
        year: 1820.5,
        label: '1820: Insurgent consolidation',
        control: {
          'spain': ['Mexico'],
        },
      },
    ],
  },
  {
    war: 'Second French intervention in Mexico',
    snapshots: [
      {
        year: 1864.5,
        label: '1864: Maximilian crowned',
        control: {
          'continental-army': ['France'],
          'nazi-germany': ['Mexico'],
        },
      },
    ],
  },
  {
    war: 'Philippine–American War',
    snapshots: [
      {
        year: 1899.5,
        label: '1899: US-Filipino conflict',
        control: {
          'us': ['United States'],
          'continental-army': ['Philippines'],
        },
      },
    ],
  },
  {
    war: 'Polish–Soviet War',
    snapshots: [
      {
        year: 1920.6,
        label: 'August 1920: Battle of Warsaw',
        control: {
          'poland': ['Poland', 'Lithuania'],
          'russia': ['Russia', 'Belarus', 'Ukraine'],
        },
      },
    ],
  },
  {
    war: 'Italo-Turkish War',
    snapshots: [
      {
        year: 1911.9,
        label: '1911: Italian invasion of Libya',
        control: {
          'italy': ['Italy'],
          'ottoman': ['Turkey', 'Libya'],
        },
      },
    ],
  },
  {
    war: 'Hundred Days',
    snapshots: [
      {
        year: 1815.5,
        label: 'June 1815: Waterloo campaign',
        control: {
          'continental-army': ['France'],
          'british-empire': ['United Kingdom'],
          'prussia': ['Germany'],
          'austria': ['Austria', 'Czechia', 'Slovakia', 'Hungary'],
          'russia': ['Russia', 'Ukraine', 'Belarus'],
        },
      },
    ],
  },
  {
    war: 'Chinese Civil War',
    snapshots: [
      {
        year: 1949.5,
        label: '1949: Communist victory',
        control: {
          'china-prc': ['China'],
          'china-roc': ['Taiwan'],
        },
      },
    ],
  },
  {
    war: 'American Indian Wars',
    snapshots: [
      {
        year: 1876.5,
        label: '1876: Plains War',
        control: {
          'us': ['United States'],
        },
      },
    ],
  },
  {
    war: 'First Anglo-Dutch War',
    snapshots: [
      {
        year: 1653.5,
        label: '1653: Naval war',
        control: {
          'british-empire': ['United Kingdom'],
          'us-confederacy': ['Netherlands'],
        },
      },
    ],
  },
  {
    war: 'Sri Lankan Civil War',
    snapshots: [
      {
        year: 2009.2,
        label: 'May 2009: Government victory',
        control: {
          'continental-army': ['Sri Lanka'],
        },
      },
    ],
  },
  {
    war: 'Genpei War',
    snapshots: [
      {
        year: 1185.3,
        label: 'April 1185: Battle of Dan-no-ura',
        control: {
          'japan': ['Japan'],
        },
      },
    ],
  },
  {
    war: 'First Opium War',
    snapshots: [
      {
        year: 1841.5,
        label: '1841: British naval dominance',
        control: {
          'british-empire': ['United Kingdom'],
          'china-roc': ['China'],
        },
      },
    ],
  },
  {
    war: 'Croatian War of Independence',
    snapshots: [
      {
        year: 1995.8,
        label: 'August 1995: Operation Storm',
        control: {
          'continental-army': ['Croatia'],
          'us-confederacy': ['Serbia', 'Bosnia and Herzegovina', 'Montenegro'],
        },
      },
    ],
  },
  {
    war: 'Mexican Revolution',
    snapshots: [
      {
        year: 1914.5,
        label: '1914: Constitutionalist victory',
        control: {
          'continental-army': ['Mexico'],
        },
      },
    ],
  },
  {
    war: 'Byzantine–Bulgarian wars',
    snapshots: [
      {
        year: 1014.7,
        label: 'July 1014: Battle of Kleidion',
        control: {
          'byzantine': ['Turkey', 'Greece', 'Cyprus'],
          'bulgaria': ['Bulgaria', 'Macedonia', 'Serbia'],
        },
      },
    ],
  },
  {
    war: 'Mughal–Sikh Wars',
    snapshots: [
      {
        year: 1710.5,
        label: '1710: Banda Singh\'s uprising',
        control: {
          'nazi-germany': ['India', 'Pakistan', 'Bangladesh', 'Afghanistan'],
          'continental-army': ['Punjab'],
        },
      },
    ],
  },
  {
    war: 'Khmelnytsky Uprising',
    snapshots: [
      {
        year: 1648.7,
        label: '1648: Cossack rebellion',
        control: {
          'poland': ['Poland', 'Lithuania', 'Belarus'],
          'continental-army': ['Ukraine'],
        },
      },
    ],
  },
];

// OWNER_LABELS gives each owner key a short human-readable label for the
// faction legend during war cinematic playback. The legend reads off the
// currently active snapshot's control map keys and looks them up here.
export const OWNER_LABELS: Record<string, string> = {
  'nazi-germany': 'Nazi Germany',
  'imperial-germany': 'German Empire',
  'germany': 'Germany',
  'japan': 'Japan',
  'italy': 'Italy',
  'vichy': 'Vichy France',
  'ussr': 'Soviet Union',
  'russia': 'Russia',
  'ukraine': 'Ukraine',
  'us': 'United States',
  'uk': 'United Kingdom',
  'canada': 'Canada',
  'australia': 'Australia',
  'new-zealand': 'New Zealand',
  'france': 'France',
  'french-empire': 'French Empire',
  'china-roc': 'Republic of China',
  'china-prc': 'PRC',
  'china': 'China',
  'poland': 'Poland',
  'ottoman': 'Ottoman Empire',
  'turkey': 'Turkey',
  'syria': 'Syria',
  'isis': 'Islamic State',
  'hts': 'HTS',
  'us-union': 'Union',
  'us-confederacy': 'Confederacy',
  'rome': 'Rome',
  'finland': 'Finland and Sweden',
  'hungary': 'Hungary',
  'romania': 'Romania',
  'bulgaria': 'Bulgaria',
  'yugoslavia': 'Yugoslavia',
  'greece': 'Greece',
  'netherlands': 'Netherlands',
  'belgium': 'Belgium',
  'norway': 'Norway',
  'denmark': 'Denmark',
  'austria-hungary': 'Austria-Hungary',
  'serbia': 'Serbia',
  'north-korea': 'North Korea',
  'south-korea': 'South Korea',
  'un-coalition': 'UN coalition',
  'prussia': 'Prussia',
  'austria': 'Austria',
  'spain': 'Spain',
  'portugal': 'Portugal',
  'british-empire': 'British Empire',
  'continental-army': 'Continental Army',
  'mongol': 'Mongol Empire',
  'crusader': 'Crusader States',
  'saracen': 'Saracen forces',
  'byzantine': 'Byzantine Empire',
  'fatimid': 'Fatimid Caliphate',
  'seljuk': 'Seljuk Empire',
  'north-vietnam': 'North Vietnam',
  'south-vietnam': 'South Vietnam',
  'viet-cong': 'Viet Cong',
  'pathet-lao': 'Pathet Lao',
  'khmer-rouge': 'Khmer Rouge',
  'coalition': 'Coalition forces',
  'iraq-saddam': 'Ba’athist Iraq',
  'iraq-government': 'Iraqi government',
  'taliban': 'Taliban',
  'afghan-government': 'Afghan government',
  'imperial-japan': 'Empire of Japan',
  'roc-china': 'Republic of China',
  'mexico': 'Mexico',
  'argentina': 'Argentina',
  'dutch-republic': 'Dutch Republic',
  'habsburg-spain': 'Habsburg Spain',
  'kingdom-france-bourbon': 'Kingdom of France',
  'kingdom-england': 'Kingdom of England',
  'kingdom-scotland': 'Kingdom of Scotland',
  'denmark-norway': 'Denmark-Norway',
  'sweden-empire': 'Swedish Empire',
  'rus': 'Russian forces',
  'cuba-spain': 'Spanish Cuba',
  'us-puerto-rico': 'US-held Puerto Rico',
  'persian-purple': 'Persian sphere',
  'greek-slate': 'Hellenic states',
  'roman-crimson': 'Rome',
  'carthage-purple': 'Carthage',
  'south-korea-blue': 'Western-aligned',
  'prussian-blue': 'Prussia',
  'hamas': 'Hamas',
  'hezbollah': 'Hezbollah',
  'commonwealth': 'Commonwealth',
  'india': 'British India',
  'south-africa': 'South Africa',
};

// findSnapshot returns the territory snapshot in effect for a given war
// at a given decimal year. Returns null only when the war has no snapshots
// or the year predates every snapshot's calendar year. Calendar-year
// matching (Math.floor on both sides) means a year-1939 battle matches the
// September-1939 snapshot encoded as 1939.75; decimal years are preserved
// only for ordering within the same year. When nothing matches, falls
// back to the earliest snapshot so a battle one year before the war's
// recorded opening still gets a sensible starting-state colourmap rather
// than a flat globe.
export function findSnapshot(war: string, decimalYear: number): TerritorySnapshot | null {
  const entry = TERRITORY.find((t) => t.war === war);
  if (!entry || entry.snapshots.length === 0) return null;
  const yFloor = Math.floor(decimalYear);
  let best: TerritorySnapshot | null = null;
  for (const snap of entry.snapshots) {
    if (Math.floor(snap.year) <= yFloor) {
      if (!best || snap.year > best.year) best = snap;
    }
  }
  if (best) return best;
  return entry.snapshots[0];
}

// BLOC_COLORS is the editorial two/three-color palette that drives the
// "red vs blue, with grey neutrals" treatment when a snapshot specifies
// bloc assignments. Saturated enough to read against satellite imagery,
// distinct enough that a colorblind viewer can still tell them apart.
export const BLOC_COLORS: Record<Bloc, string> = {
  A: '#dc2626', // Axis / aggressor / red side
  B: '#1d4ed8', // Allies / coalition / blue side
  C: '#eab308', // third party (Three Kingdoms, Cold War triads, etc.)
  neutral: '#475569', // grey wash for non-belligerent territory in view
};

// buildCountryColorMap converts a snapshot's owner-centric control map
// into the country-centric form BattleGlobe needs ({ "France": "#1d4ed8"
// }). When the snapshot specifies a bloc map (red-side / blue-side
// / third-side / neutral), the bloc color wins so the globe reads as a
// two-color Britannica-style atlas instead of a riot of faction shades.
// Without a bloc map, falls back to per-faction OWNER_COLORS so older
// snapshots keep their existing identity-rich palette.
export function buildCountryColorMap(snapshot: TerritorySnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  const blocMap = snapshot.bloc;
  for (const [owner, countries] of Object.entries(snapshot.control)) {
    let color: string;
    if (blocMap) {
      const bloc = blocMap[owner] ?? 'neutral';
      color = BLOC_COLORS[bloc];
    } else {
      color = OWNER_COLORS[owner] || '#64748b';
    }
    for (const c of countries) {
      out[c] = color;
    }
  }
  return out;
}

// buildCountryOwnerMap returns the country → owner-key map for the
// snapshot. Used to look up the human-readable OWNER_LABEL when painting
// a faction badge on top of each shaded country polygon.
export function buildCountryOwnerMap(snapshot: TerritorySnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [owner, countries] of Object.entries(snapshot.control)) {
    for (const c of countries) {
      out[c] = owner;
    }
  }
  return out;
}
