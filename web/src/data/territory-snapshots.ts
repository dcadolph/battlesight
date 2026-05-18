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
  'nazi-germany': '#dc2626',
  'imperial-germany': '#b91c1c',
  'germany': '#dc2626',
  'japan': '#ea580c',
  'italy': '#f97316',
  'vichy': '#a16207',
  'ussr': '#0ea5e9',
  'russia': '#7c3aed',
  'us': '#2563eb',
  'uk': '#1d4ed8',
  'canada': '#3b82f6',
  'australia': '#60a5fa',
  'new-zealand': '#60a5fa',
  'france': '#6366f1',
  'china-roc': '#0891b2',
  'china-prc': '#dc2626',
  'china': '#0891b2',
  'poland': '#9333ea',
  'ottoman': '#16a34a',
  'turkey': '#16a34a',
  'syria': '#16a34a',
  'isis': '#000000',
  'hts': '#16a34a',
  'us-union': '#2563eb',
  'us-confederacy': '#9ca3af',
  'rome': '#ca8a04',
  'finland': '#94a3b8',
  'hungary': '#a16207',
  'romania': '#a16207',
  'bulgaria': '#a16207',
  'yugoslavia': '#9333ea',
  'greece': '#0891b2',
  'netherlands': '#f59e0b',
  'belgium': '#f59e0b',
  'norway': '#f59e0b',
  'denmark': '#f59e0b',
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
          'uk': ['United Kingdom', 'India', 'Egypt', 'Sudan', 'Kenya', 'Tanzania', 'Uganda', 'Nigeria', 'Ghana', 'South Africa', 'Malaysia', 'Myanmar'],
          'france': ['France', 'Algeria', 'Tunisia', 'Morocco', 'Mali', 'Niger', 'Chad', 'Senegal', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia'],
          'poland': ['Poland'],
          'italy': ['Italy', 'Albania', 'Libya', 'Eritrea', 'Ethiopia', 'Somalia'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
        },
      },
      {
        year: 1940.5,
        label: 'June 1940: Fall of France',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway'],
          'vichy': ['France', 'Algeria', 'Tunisia', 'Morocco', 'Mali', 'Niger', 'Chad', 'Senegal', 'Madagascar', 'Vietnam', 'Laos', 'Cambodia'],
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'India', 'Egypt', 'Sudan', 'Kenya', 'Tanzania', 'Uganda', 'Nigeria', 'Ghana', 'South Africa', 'Malaysia', 'Myanmar', 'Canada', 'Australia', 'New Zealand'],
          'italy': ['Italy', 'Albania', 'Libya', 'Eritrea', 'Ethiopia', 'Somalia'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
        },
      },
      {
        year: 1941.6,
        label: 'June 1941: Operation Barbarossa',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Macedonia', 'Greece', 'Belarus', 'Lithuania', 'Latvia', 'Estonia'],
          'vichy': ['France', 'Algeria', 'Tunisia', 'Morocco', 'Mali', 'Niger', 'Chad', 'Senegal', 'Madagascar'],
          'ussr': ['Russia', 'Ukraine', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'India', 'Egypt', 'Sudan', 'Kenya', 'Tanzania', 'Uganda', 'Nigeria', 'Ghana', 'South Africa', 'Malaysia', 'Myanmar', 'Canada', 'Australia', 'New Zealand'],
          'italy': ['Italy', 'Albania', 'Libya', 'Eritrea', 'Ethiopia', 'Somalia'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia'],
        },
      },
      {
        year: 1942.7,
        label: 'Autumn 1942: Axis high water mark',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway', 'France', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Macedonia', 'Greece', 'Belarus', 'Lithuania', 'Latvia', 'Estonia', 'Ukraine', 'Moldova', 'Libya', 'Tunisia'],
          'ussr': ['Russia', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'India', 'Egypt', 'Sudan', 'Kenya', 'Tanzania', 'Uganda', 'Nigeria', 'Ghana', 'South Africa', 'Canada', 'Australia', 'New Zealand'],
          'us': ['United States'],
          'italy': ['Italy', 'Albania', 'Eritrea', 'Ethiopia', 'Somalia'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia', 'Myanmar', 'Thailand', 'Malaysia', 'Indonesia', 'Philippines', 'Papua New Guinea'],
        },
      },
      {
        year: 1943.7,
        label: 'Summer 1943: Stalingrad reversed, Italy invaded',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Luxembourg', 'Denmark', 'Norway', 'France', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Greece', 'Belarus', 'Lithuania', 'Latvia', 'Estonia', 'Italy'],
          'ussr': ['Russia', 'Ukraine', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'India', 'Egypt', 'Libya', 'Tunisia', 'Sudan', 'Kenya', 'Tanzania', 'Nigeria', 'South Africa', 'Canada', 'Australia', 'New Zealand', 'Myanmar'],
          'us': ['United States'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia', 'Thailand', 'Malaysia', 'Indonesia', 'Philippines'],
        },
      },
      {
        year: 1944.5,
        label: 'June 1944: D-Day, Bagration',
        control: {
          'nazi-germany': ['Germany', 'Austria', 'Czechia', 'Slovakia', 'Poland', 'Netherlands', 'Belgium', 'Denmark', 'Norway', 'Yugoslavia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Greece', 'Hungary', 'Italy'],
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Moldova', 'Lithuania', 'Latvia', 'Estonia', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan'],
          'uk': ['United Kingdom', 'France', 'India', 'Egypt', 'Libya', 'Sudan', 'Kenya', 'Tanzania', 'Nigeria', 'South Africa', 'Canada', 'Australia', 'New Zealand', 'Myanmar'],
          'us': ['United States', 'Philippines'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia', 'Thailand', 'Malaysia', 'Indonesia'],
        },
      },
      {
        year: 1945.4,
        label: 'May 1945: Victory in Europe',
        control: {
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Moldova', 'Lithuania', 'Latvia', 'Estonia', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan', 'Poland', 'Czechia', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Macedonia', 'Germany', 'Austria'],
          'uk': ['United Kingdom', 'France', 'Italy', 'Netherlands', 'Belgium', 'Denmark', 'Norway', 'Greece', 'India', 'Egypt', 'Libya', 'Sudan', 'Kenya', 'Tanzania', 'Nigeria', 'South Africa', 'Canada', 'Australia', 'New Zealand', 'Myanmar'],
          'us': ['United States', 'Philippines', 'Germany', 'Austria'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea', 'Vietnam', 'Laos', 'Cambodia', 'Thailand', 'Malaysia', 'Indonesia'],
        },
      },
      {
        year: 1945.7,
        label: 'September 1945: Victory in the Pacific',
        control: {
          'us': ['United States', 'Japan', 'South Korea', 'Philippines'],
          'ussr': ['Russia', 'Belarus', 'Ukraine', 'Moldova', 'Lithuania', 'Latvia', 'Estonia', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan', 'Poland', 'Czechia', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Yugoslavia', 'Serbia', 'Croatia', 'Bosnia and Herzegovina', 'Slovenia', 'Macedonia', 'North Korea'],
          'uk': ['United Kingdom', 'France', 'Italy', 'Netherlands', 'Belgium', 'Denmark', 'Norway', 'Greece', 'India', 'Egypt', 'Libya', 'Sudan', 'Kenya', 'Tanzania', 'Nigeria', 'South Africa', 'Canada', 'Australia', 'New Zealand', 'Myanmar', 'Malaysia'],
          'china-roc': ['China', 'Taiwan'],
        },
      },
    ],
  },
  {
    war: 'Russia-Ukraine War',
    snapshots: [
      {
        year: 2014.2,
        label: 'February 2014: Crimea annexed',
        control: {
          'russia': ['Russia'],
        },
      },
      {
        year: 2022.16,
        label: 'February 24, 2022: Full-scale invasion',
        control: {
          'russia': ['Russia'],
        },
      },
      {
        year: 2022.7,
        label: 'September 2022: Kharkiv counteroffensive',
        control: {
          'russia': ['Russia'],
        },
      },
      {
        year: 2025.5,
        label: 'Mid-2025: Stalemate along the eastern front',
        control: {
          'russia': ['Russia'],
        },
      },
    ],
  },
];

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

// buildCountryColorMap converts a snapshot's owner-centric control map
// into the country-centric form BattleGlobe needs ({ "France": "#dc2626"
// }), using OWNER_COLORS to look up each owner's accent.
export function buildCountryColorMap(snapshot: TerritorySnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [owner, countries] of Object.entries(snapshot.control)) {
    const color = OWNER_COLORS[owner] || '#64748b';
    for (const c of countries) {
      out[c] = color;
    }
  }
  return out;
}
