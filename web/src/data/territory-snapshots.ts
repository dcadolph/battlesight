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
  // World War II Axis. Nazis read black (SS uniform) so red stays free for
  // the Soviet sphere; Imperial Japan reads as blood crimson; Italy reads
  // as fascist green. Each Axis power has its own distinct silhouette on
  // the European map at peak occupation.
  // Nazi Germany painted as feldgrau — the Wehrmacht's actual uniform
  // color. Distinct enough from Soviet bright red that the Eastern Front
  // reads as two competing forces, not one red blob. Visible on dark
  // satellite imagery and historically iconic.
  'nazi-germany': '#6b5d2e',
  'imperial-germany': '#5c4a2a',
  'germany': '#6b5d2e',
  'japan': '#9b1c1c',
  'italy': '#16732b',
  'vichy': '#a16207',
  // Soviet sphere reads as bright Red Army red. Modern Russia keeps a
  // darker blood red so the two eras don't look identical when adjacent.
  'ussr': '#dc2626',
  'russia': '#a5121b',
  'ukraine': '#0c5fdb',
  // Western Allies palette: each gets a different cool tone so France,
  // UK, and the US stay distinguishable when they're side-by-side on
  // the map (e.g. occupied Germany 1945).
  'us': '#1d4ed8',
  'uk': '#1e3a8a',
  'canada': '#0ea5e9',
  'australia': '#06b6d4',
  'new-zealand': '#67e8f9',
  'france': '#3b82f6',
  'french-empire': '#6366f1',
  'china-roc': '#1e40af',
  'china-prc': '#b91c1c',
  'china': '#0891b2',
  'poland': '#9333ea',
  'ottoman': '#9f1239',
  'turkey': '#15803d',
  'syria': '#15803d',
  'isis': '#0f1116',
  'hts': '#475569',
  'us-union': '#1e3a8a',
  'us-confederacy': '#6b7280',
  'rome': '#b91c1c',
  'finland': '#94a3b8',
  // Axis-aligned minor powers cluster in mustard/amber tones so they
  // read as "with the Axis but not Germany" at a glance.
  'hungary': '#854d0e',
  'romania': '#a16207',
  'bulgaria': '#854d0e',
  'yugoslavia': '#9333ea',
  'greece': '#0891b2',
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
  'south-korea': '#1d4ed8',
  'un-coalition': '#0ea5e9',
  'prussia': '#1e2a4a',
  'austria': '#e5e7eb',
  'spain': '#16a34a',
  'portugal': '#22c55e',
  'british-empire': '#dc2626',
  'continental-army': '#1e40af',
  'mongol': '#b45309',
  'crusader': '#eab308',
  'saracen': '#15803d',
  'byzantine': '#7c3aed',
  'fatimid': '#16a34a',
  'seljuk': '#15803d',
  'north-vietnam': '#dc2626',
  'south-vietnam': '#1d4ed8',
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
        label: 'February 2014: Crimea annexed, Donbas insurgency',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
        },
      },
      {
        year: 2022.16,
        label: 'February 24 2022: Full-scale invasion',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
        },
      },
      {
        year: 2022.7,
        label: 'September 2022: Kharkiv counter-offensive',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
        },
      },
      {
        year: 2023.5,
        label: 'Summer 2023: Ukrainian counter-offensive grinds south',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
        },
      },
      {
        year: 2024.2,
        label: 'February 2024: Avdiivka falls, Russia presses west',
        control: {
          'russia': ['Russia', 'Belarus'],
          'ukraine': ['Ukraine'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana', 'South Africa', 'Canada', 'Australia', 'New Zealand'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana', 'South Africa', 'Canada', 'Australia', 'New Zealand'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana', 'South Africa', 'Canada', 'Australia', 'New Zealand'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana', 'South Africa', 'Canada', 'Australia', 'New Zealand'],
          'italy': ['Italy', 'Libya', 'Eritrea', 'Somalia'],
          'us': ['United States'],
          'japan': ['Japan', 'Taiwan', 'North Korea', 'South Korea'],
        },
      },
      {
        year: 1918.9,
        label: 'November 1918: Armistice, Central Powers collapse',
        control: {
          'uk': ['United Kingdom', 'Ireland', 'India', 'Egypt', 'Sudan', 'Kenya', 'Nigeria', 'Ghana', 'South Africa', 'Canada', 'Australia', 'New Zealand', 'Iraq', 'Israel', 'Jordan'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Canada', 'Australia'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Canada', 'Australia'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Canada', 'Australia', 'Portugal'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Canada', 'Australia'],
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
          'uk': ['United Kingdom', 'Ireland', 'India', 'Canada', 'Australia', 'Belgium', 'Netherlands', 'Luxembourg'],
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
          'uk': ['United Kingdom', 'Canada', 'Australia', 'New Zealand'],
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
          'uk': ['United Kingdom', 'Canada', 'Australia', 'New Zealand'],
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
          'uk': ['United Kingdom', 'Canada', 'Australia', 'New Zealand'],
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
          'uk': ['United Kingdom', 'Canada', 'Australia', 'New Zealand'],
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
          'uk': ['United Kingdom', 'Canada', 'Australia', 'New Zealand'],
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
    war: 'Mexican–American War',
    snapshots: [
      {
        year: 1846.4,
        label: 'May 1846: United States declares war',
        control: {
          'us': ['United States'],
          'mexico': ['Mexico'],
          'uk': ['Canada'],
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
