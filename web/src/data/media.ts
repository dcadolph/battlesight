// Curated media library — films, books, and series tied to specific wars
// and battles. Resolution at lookup time is two-tier: first match on battle
// id (most specific), then on war name. Entries can list either or both.
//
// Editorial bar: include works widely recognized as either a faithful
// dramatization or a foundational scholarly account. Skip B-tier action
// films where the historical setting is incidental.

export type MediaKind = 'film' | 'series' | 'book' | 'documentary';

export interface MediaEntry {
  // title is the canonical English title.
  title: string;
  // kind drives the icon and label.
  kind: MediaKind;
  // year of release / publication.
  year: number;
  // creator is the director (film/series/doc) or author (book).
  creator: string;
  // wars is the list of war names this entry covers. Match exactly the war
  // names used in the battles table / wars.json so resolution works.
  wars?: string[];
  // battles is the list of battle ids this entry depicts most directly.
  battles?: string[];
  // blurb is a one-line note on what the work captures.
  blurb: string;
  // url is an optional external reference (IMDB, Wikipedia, Goodreads).
  url?: string;
}

export const MEDIA_LIBRARY: MediaEntry[] = [
  // World War II.
  {
    title: 'Saving Private Ryan',
    kind: 'film',
    year: 1998,
    creator: 'Steven Spielberg',
    wars: ['World War II'],
    battles: ['normandy-1944'],
    blurb: 'The Omaha Beach sequence is the canonical filmed depiction of D-Day.',
    url: 'https://www.imdb.com/title/tt0120815/',
  },
  {
    title: 'Band of Brothers',
    kind: 'series',
    year: 2001,
    creator: 'HBO / Spielberg / Hanks',
    wars: ['World War II'],
    blurb: 'Easy Company, 101st Airborne, from Normandy to Berchtesgaden.',
    url: 'https://www.imdb.com/title/tt0185906/',
  },
  {
    title: 'The Pacific',
    kind: 'series',
    year: 2010,
    creator: 'HBO / Spielberg / Hanks',
    wars: ['World War II', 'Pacific War'],
    blurb: 'Marine Corps in the Pacific — Guadalcanal, Peleliu, Iwo Jima, Okinawa.',
    url: 'https://www.imdb.com/title/tt0374463/',
  },
  {
    title: "Schindler's List",
    kind: 'film',
    year: 1993,
    creator: 'Steven Spielberg',
    wars: ['World War II'],
    blurb: 'The Holocaust through the survival of the Schindlerjuden in Kraków.',
    url: 'https://www.imdb.com/title/tt0108052/',
  },
  {
    title: 'Europa Europa',
    kind: 'film',
    year: 1990,
    creator: 'Agnieszka Holland',
    wars: ['World War II'],
    blurb: 'A Jewish boy hides in plain sight inside the Hitler Youth.',
    url: 'https://www.imdb.com/title/tt0099747/',
  },
  {
    title: 'Das Boot',
    kind: 'film',
    year: 1981,
    creator: 'Wolfgang Petersen',
    wars: ['World War II', 'Battle of the Atlantic'],
    blurb: 'U-boat warfare from inside the German submarine fleet.',
    url: 'https://www.imdb.com/title/tt0082096/',
  },
  {
    title: 'Letters from Iwo Jima',
    kind: 'film',
    year: 2006,
    creator: 'Clint Eastwood',
    wars: ['World War II', 'Pacific War'],
    battles: ['iwo-jima-1945'],
    blurb: 'Iwo Jima from the Japanese defenders\' perspective.',
    url: 'https://www.imdb.com/title/tt0498380/',
  },
  {
    title: 'Flags of Our Fathers',
    kind: 'film',
    year: 2006,
    creator: 'Clint Eastwood',
    wars: ['World War II', 'Pacific War'],
    battles: ['iwo-jima-1945'],
    blurb: 'The men behind the iconic Iwo Jima flag-raising photograph.',
    url: 'https://www.imdb.com/title/tt0418689/',
  },
  {
    title: 'The Thin Red Line',
    kind: 'film',
    year: 1998,
    creator: 'Terrence Malick',
    wars: ['World War II', 'Pacific War'],
    battles: ['guadalcanal-1942'],
    blurb: 'Guadalcanal as elegy — soldiers as small lives inside a vast violence.',
    url: 'https://www.imdb.com/title/tt0120863/',
  },
  {
    title: 'Stalingrad',
    kind: 'film',
    year: 1993,
    creator: 'Joseph Vilsmaier',
    wars: ['World War II', 'Eastern Front (World War II)'],
    battles: ['stalingrad-1942'],
    blurb: 'German infantry sucked into and destroyed by the cauldron.',
    url: 'https://www.imdb.com/title/tt0108211/',
  },
  {
    title: 'Enemy at the Gates',
    kind: 'film',
    year: 2001,
    creator: 'Jean-Jacques Annaud',
    wars: ['World War II', 'Eastern Front (World War II)'],
    battles: ['stalingrad-1942'],
    blurb: 'Soviet sniper Vasily Zaitsev in the ruins of Stalingrad.',
    url: 'https://www.imdb.com/title/tt0215750/',
  },
  {
    title: 'Come and See',
    kind: 'film',
    year: 1985,
    creator: 'Elem Klimov',
    wars: ['World War II', 'Eastern Front (World War II)'],
    blurb: 'The Belorussian partisan war and the German atrocity campaign — perhaps the most harrowing war film ever made.',
    url: 'https://www.imdb.com/title/tt0091251/',
  },
  {
    title: 'A Bridge Too Far',
    kind: 'film',
    year: 1977,
    creator: 'Richard Attenborough',
    wars: ['World War II'],
    battles: ['market-garden-1944'],
    blurb: 'Market Garden, Arnhem, and the limits of Allied operational reach.',
    url: 'https://www.imdb.com/title/tt0075784/',
  },
  {
    title: 'The Longest Day',
    kind: 'film',
    year: 1962,
    creator: 'Ken Annakin / Andrew Marton / Bernhard Wicki',
    wars: ['World War II'],
    battles: ['normandy-1944'],
    blurb: 'D-Day on a Cinemascope canvas with the period\'s biggest stars.',
    url: 'https://www.imdb.com/title/tt0056197/',
  },
  {
    title: 'Patton',
    kind: 'film',
    year: 1970,
    creator: 'Franklin J. Schaffner',
    wars: ['World War II'],
    blurb: 'Scott as Patton — generalship, vanity, and the Western Front.',
    url: 'https://www.imdb.com/title/tt0066206/',
  },
  {
    title: 'Dunkirk',
    kind: 'film',
    year: 2017,
    creator: 'Christopher Nolan',
    wars: ['World War II'],
    battles: ['battle-of-dunkirk', 'dunkirk-1940'],
    blurb: 'Dunkirk evacuation from beach, sea, and air, all running on different clocks.',
    url: 'https://www.imdb.com/title/tt5013056/',
  },
  {
    title: 'Tora! Tora! Tora!',
    kind: 'film',
    year: 1970,
    creator: 'Richard Fleischer / Kinji Fukasaku',
    wars: ['World War II', 'Pacific War'],
    battles: ['pearl-harbor-1941'],
    blurb: 'Pearl Harbor from both sides — careful, archival, dual-language.',
    url: 'https://www.imdb.com/title/tt0066473/',
  },
  {
    title: 'Midway',
    kind: 'film',
    year: 2019,
    creator: 'Roland Emmerich',
    wars: ['World War II', 'Pacific War'],
    battles: ['midway-1942'],
    blurb: 'The carrier battle that turned the Pacific.',
    url: 'https://www.imdb.com/title/tt6924650/',
  },
  {
    title: 'Stalingrad',
    kind: 'book',
    year: 1998,
    creator: 'Antony Beevor',
    wars: ['World War II', 'Eastern Front (World War II)'],
    battles: ['stalingrad-1942'],
    blurb: 'The standard modern account, using Soviet archives newly opened in the 1990s.',
  },
  {
    title: 'The Second World War',
    kind: 'book',
    year: 2012,
    creator: 'Antony Beevor',
    wars: ['World War II'],
    blurb: 'A single-volume narrative of the war from a unifying author.',
  },
  {
    title: 'Band of Brothers',
    kind: 'book',
    year: 1992,
    creator: 'Stephen E. Ambrose',
    wars: ['World War II'],
    blurb: 'The Easy Company history that the HBO series adapted.',
  },
  {
    title: 'The Rise and Fall of the Third Reich',
    kind: 'book',
    year: 1960,
    creator: 'William L. Shirer',
    wars: ['World War II'],
    blurb: 'The foundational English-language history of Nazi Germany.',
  },
  {
    title: 'The Liberation Trilogy',
    kind: 'book',
    year: 2002,
    creator: 'Rick Atkinson',
    wars: ['World War II'],
    blurb: 'An Army at Dawn, The Day of Battle, The Guns at Last Light — the US Army from North Africa to Berlin.',
  },
  {
    title: 'Slaughterhouse-Five',
    kind: 'book',
    year: 1969,
    creator: 'Kurt Vonnegut',
    wars: ['World War II'],
    blurb: 'Dresden firebombing through the unstuck-in-time eyes of Billy Pilgrim.',
  },
  {
    title: 'Catch-22',
    kind: 'book',
    year: 1961,
    creator: 'Joseph Heller',
    wars: ['World War II'],
    blurb: 'B-25 crews over Italy — the most influential anti-war novel in English.',
  },
  {
    title: 'The Naked and the Dead',
    kind: 'book',
    year: 1948,
    creator: 'Norman Mailer',
    wars: ['World War II', 'Pacific War'],
    blurb: 'A Pacific island reconnaissance patrol as American social fable.',
  },

  // World War I.
  {
    title: '1917',
    kind: 'film',
    year: 2019,
    creator: 'Sam Mendes',
    wars: ['World War I', 'Western Front (World War I)'],
    blurb: 'A two-corporal courier mission across no-man\'s-land, presented in a continuous-take illusion.',
    url: 'https://www.imdb.com/title/tt8579674/',
  },
  {
    title: 'All Quiet on the Western Front',
    kind: 'film',
    year: 2022,
    creator: 'Edward Berger',
    wars: ['World War I', 'Western Front (World War I)'],
    blurb: 'Remarque\'s novel re-filmed from the German trench perspective.',
    url: 'https://www.imdb.com/title/tt1016150/',
  },
  {
    title: 'Paths of Glory',
    kind: 'film',
    year: 1957,
    creator: 'Stanley Kubrick',
    wars: ['World War I'],
    blurb: 'A French general orders a suicidal assault, then court-martials the survivors.',
    url: 'https://www.imdb.com/title/tt0050825/',
  },
  {
    title: 'Lawrence of Arabia',
    kind: 'film',
    year: 1962,
    creator: 'David Lean',
    wars: ['World War I', 'Middle Eastern theatre of World War I'],
    blurb: 'T.E. Lawrence and the Arab Revolt of 1916–18.',
    url: 'https://www.imdb.com/title/tt0056172/',
  },
  {
    title: 'Gallipoli',
    kind: 'film',
    year: 1981,
    creator: 'Peter Weir',
    wars: ['World War I', 'Gallipoli campaign'],
    blurb: 'Australian Light Horse at the Nek — the foundational ANZAC film.',
    url: 'https://www.imdb.com/title/tt0082432/',
  },
  {
    title: 'All Quiet on the Western Front',
    kind: 'book',
    year: 1929,
    creator: 'Erich Maria Remarque',
    wars: ['World War I'],
    blurb: 'The defining German anti-war novel of the trenches.',
  },
  {
    title: 'The Guns of August',
    kind: 'book',
    year: 1962,
    creator: 'Barbara Tuchman',
    wars: ['World War I'],
    blurb: 'The first month of war — the Schlieffen Plan, the Marne, and how it all went off the rails.',
  },
  {
    title: 'Storm of Steel',
    kind: 'book',
    year: 1920,
    creator: 'Ernst Jünger',
    wars: ['World War I'],
    blurb: 'A German stormtroop officer\'s unsentimental front-line memoir.',
  },
  {
    title: 'Goodbye to All That',
    kind: 'book',
    year: 1929,
    creator: 'Robert Graves',
    wars: ['World War I'],
    blurb: 'A British officer-poet\'s reckoning with the trench generation.',
  },
  {
    title: 'The Sleepwalkers',
    kind: 'book',
    year: 2012,
    creator: 'Christopher Clark',
    wars: ['World War I'],
    blurb: 'How Europe walked into the war in July 1914 — a multipolar pre-history.',
  },

  // Vietnam War.
  {
    title: 'Apocalypse Now',
    kind: 'film',
    year: 1979,
    creator: 'Francis Ford Coppola',
    wars: ['Vietnam War'],
    blurb: 'Conrad\'s Heart of Darkness transplanted to the Mekong; the strongest cinematic image of the war.',
    url: 'https://www.imdb.com/title/tt0078788/',
  },
  {
    title: 'Platoon',
    kind: 'film',
    year: 1986,
    creator: 'Oliver Stone',
    wars: ['Vietnam War'],
    blurb: 'A grunt\'s war in the highlands — Stone\'s autobiographical infantry tour.',
    url: 'https://www.imdb.com/title/tt0091763/',
  },
  {
    title: 'Full Metal Jacket',
    kind: 'film',
    year: 1987,
    creator: 'Stanley Kubrick',
    wars: ['Vietnam War'],
    blurb: 'Parris Island boot camp and Hue in two unified halves.',
    url: 'https://www.imdb.com/title/tt0093058/',
  },
  {
    title: 'We Were Soldiers',
    kind: 'film',
    year: 2002,
    creator: 'Randall Wallace',
    wars: ['Vietnam War'],
    battles: ['ia-drang-1965'],
    blurb: 'The Ia Drang Valley — the first major US ground engagement of the war.',
    url: 'https://www.imdb.com/title/tt0277434/',
  },
  {
    title: 'The Deer Hunter',
    kind: 'film',
    year: 1978,
    creator: 'Michael Cimino',
    wars: ['Vietnam War'],
    blurb: 'Three Pennsylvania steelworkers go to war and come home different.',
    url: 'https://www.imdb.com/title/tt0077416/',
  },
  {
    title: 'Hamburger Hill',
    kind: 'film',
    year: 1987,
    creator: 'John Irvin',
    wars: ['Vietnam War'],
    battles: ['battle-of-hamburger-hill'],
    blurb: 'The 1969 assault on Hill 937 in the A Shau Valley.',
    url: 'https://www.imdb.com/title/tt0093173/',
  },
  {
    title: 'The Things They Carried',
    kind: 'book',
    year: 1990,
    creator: "Tim O'Brien",
    wars: ['Vietnam War'],
    blurb: 'Linked short stories about an infantry platoon, fact braided with fiction.',
  },
  {
    title: 'Dispatches',
    kind: 'book',
    year: 1977,
    creator: 'Michael Herr',
    wars: ['Vietnam War'],
    blurb: 'A war correspondent\'s frontline reportage — the source for much of Apocalypse Now\'s voice.',
  },
  {
    title: 'We Were Soldiers Once… and Young',
    kind: 'book',
    year: 1992,
    creator: 'Hal Moore & Joseph Galloway',
    wars: ['Vietnam War'],
    battles: ['ia-drang-1965'],
    blurb: 'The commander\'s account of the Ia Drang, written with the AP reporter who was there.',
  },

  // Iraq / Afghanistan.
  {
    title: 'The Hurt Locker',
    kind: 'film',
    year: 2008,
    creator: 'Kathryn Bigelow',
    wars: ['Iraq War'],
    blurb: 'An EOD team in Baghdad — the war as a 50-minute clock with no rules.',
    url: 'https://www.imdb.com/title/tt0887912/',
  },
  {
    title: 'American Sniper',
    kind: 'film',
    year: 2014,
    creator: 'Clint Eastwood',
    wars: ['Iraq War'],
    blurb: 'Chris Kyle\'s four-tour memoir of urban combat in Iraq.',
    url: 'https://www.imdb.com/title/tt2179136/',
  },
  {
    title: 'Generation Kill',
    kind: 'series',
    year: 2008,
    creator: 'David Simon / Ed Burns',
    wars: ['Iraq War'],
    blurb: 'First Recon Marines in the 2003 invasion, based on the Rolling Stone reporting.',
    url: 'https://www.imdb.com/title/tt0995832/',
  },
  {
    title: 'Lone Survivor',
    kind: 'film',
    year: 2013,
    creator: 'Peter Berg',
    wars: ['War in Afghanistan (2001–2021)'],
    blurb: 'Operation Red Wings — a SEAL team ambushed in the Kunar mountains.',
    url: 'https://www.imdb.com/title/tt1796960/',
  },
  {
    title: 'Restrepo',
    kind: 'documentary',
    year: 2010,
    creator: 'Sebastian Junger / Tim Hetherington',
    wars: ['War in Afghanistan (2001–2021)'],
    blurb: 'A year with a US infantry platoon at Outpost Restrepo, Korengal Valley.',
    url: 'https://www.imdb.com/title/tt1559549/',
  },
  {
    title: '12 Strong',
    kind: 'film',
    year: 2018,
    creator: 'Nicolai Fuglsig',
    wars: ['War in Afghanistan (2001–2021)'],
    blurb: 'The horseback-mounted ODA 595 advance on Mazar-i-Sharif, October 2001.',
    url: 'https://www.imdb.com/title/tt1413492/',
  },
  {
    title: 'The Forever War',
    kind: 'book',
    year: 2008,
    creator: 'Dexter Filkins',
    wars: ['Iraq War', 'War in Afghanistan (2001–2021)'],
    blurb: 'A NYT correspondent\'s decade in Iraq and Afghanistan.',
  },
  {
    title: 'Generation Kill',
    kind: 'book',
    year: 2004,
    creator: 'Evan Wright',
    wars: ['Iraq War'],
    blurb: 'Embedded with First Recon in the rush to Baghdad.',
  },

  // Gulf War.
  {
    title: 'Jarhead',
    kind: 'film',
    year: 2005,
    creator: 'Sam Mendes',
    wars: ['Gulf War'],
    blurb: 'Anthony Swofford\'s memoir of a Marine sniper team that never fires its rifle.',
    url: 'https://www.imdb.com/title/tt0418763/',
  },
  {
    title: 'Three Kings',
    kind: 'film',
    year: 1999,
    creator: 'David O. Russell',
    wars: ['Gulf War'],
    blurb: 'US soldiers go after Saddam\'s gold in the chaos after the ceasefire.',
    url: 'https://www.imdb.com/title/tt0120188/',
  },

  // Somalia / Mogadishu.
  {
    title: 'Black Hawk Down',
    kind: 'film',
    year: 2001,
    creator: 'Ridley Scott',
    wars: ['Somali Civil War', 'War in Somalia'],
    battles: ['mogadishu-1993'],
    blurb: 'The October 1993 Mogadishu raid that pulled the US out of Somalia.',
    url: 'https://www.imdb.com/title/tt0265086/',
  },
  {
    title: 'Black Hawk Down',
    kind: 'book',
    year: 1999,
    creator: 'Mark Bowden',
    wars: ['Somali Civil War', 'War in Somalia'],
    battles: ['mogadishu-1993'],
    blurb: 'The reporting that the Ridley Scott film adapted.',
  },

  // Algerian War.
  {
    title: 'The Battle of Algiers',
    kind: 'film',
    year: 1966,
    creator: 'Gillo Pontecorvo',
    wars: ['Algerian War'],
    blurb: 'The 1957 Casbah campaign, shot like a newsreel. Studied in counter-insurgency schools.',
    url: 'https://www.imdb.com/title/tt0058946/',
  },

  // Bosnian War.
  {
    title: 'No Man\'s Land',
    kind: 'film',
    year: 2001,
    creator: 'Danis Tanović',
    wars: ['Bosnian War'],
    blurb: 'Two soldiers stuck in the same trench between the lines — black-comic anti-war Oscar winner.',
    url: 'https://www.imdb.com/title/tt0283509/',
  },

  // Korean War.
  {
    title: 'Pork Chop Hill',
    kind: 'film',
    year: 1959,
    creator: 'Lewis Milestone',
    wars: ['Korean War'],
    blurb: 'The brutal 1953 fight for Hill 255, as the armistice talks dragged on.',
    url: 'https://www.imdb.com/title/tt0053183/',
  },
  {
    title: 'Tae Guk Gi: The Brotherhood of War',
    kind: 'film',
    year: 2004,
    creator: 'Kang Je-gyu',
    wars: ['Korean War'],
    blurb: 'Two Korean brothers conscripted into the ROK army during the 1950–53 war.',
    url: 'https://www.imdb.com/title/tt0386064/',
  },

  // Anglo-Zulu War.
  {
    title: 'Zulu',
    kind: 'film',
    year: 1964,
    creator: 'Cy Endfield',
    wars: ['Anglo-Zulu War'],
    battles: ['battle-of-rorkes-drift'],
    blurb: 'Rorke\'s Drift — 150 British defenders holding off a Zulu impi.',
    url: 'https://www.imdb.com/title/tt0058777/',
  },
  {
    title: 'Zulu Dawn',
    kind: 'film',
    year: 1979,
    creator: 'Douglas Hickox',
    wars: ['Anglo-Zulu War'],
    battles: ['battle-of-isandlwana'],
    blurb: 'Isandlwana — the disaster the Rorke\'s Drift stand barely offset.',
    url: 'https://www.imdb.com/title/tt0080040/',
  },

  // American Civil War.
  {
    title: 'Glory',
    kind: 'film',
    year: 1989,
    creator: 'Edward Zwick',
    wars: ['American Civil War'],
    blurb: 'The 54th Massachusetts — the Black regiment\'s assault on Fort Wagner.',
    url: 'https://www.imdb.com/title/tt0097441/',
  },
  {
    title: 'Gettysburg',
    kind: 'film',
    year: 1993,
    creator: 'Ronald F. Maxwell',
    wars: ['American Civil War'],
    battles: ['gettysburg-1863'],
    blurb: 'Faithful to Shaara\'s Killer Angels — Longstreet, Chamberlain, Pickett\'s Charge.',
    url: 'https://www.imdb.com/title/tt0107007/',
  },
  {
    title: 'Lincoln',
    kind: 'film',
    year: 2012,
    creator: 'Steven Spielberg',
    wars: ['American Civil War'],
    blurb: 'The political war for the Thirteenth Amendment, January 1865.',
    url: 'https://www.imdb.com/title/tt0443272/',
  },
  {
    title: 'Cold Mountain',
    kind: 'film',
    year: 2003,
    creator: 'Anthony Minghella',
    wars: ['American Civil War'],
    blurb: 'A Confederate deserter walks home across a collapsing South.',
    url: 'https://www.imdb.com/title/tt0159365/',
  },
  {
    title: 'The Killer Angels',
    kind: 'book',
    year: 1974,
    creator: 'Michael Shaara',
    wars: ['American Civil War'],
    battles: ['gettysburg-1863'],
    blurb: 'The Pulitzer-winning Gettysburg novel — and the Gettysburg film\'s source.',
  },
  {
    title: 'The Civil War',
    kind: 'documentary',
    year: 1990,
    creator: 'Ken Burns',
    wars: ['American Civil War'],
    blurb: 'The PBS series — the foundational popular history of the war.',
  },

  // Napoleonic Wars.
  {
    title: 'Master and Commander: The Far Side of the World',
    kind: 'film',
    year: 2003,
    creator: 'Peter Weir',
    wars: ['Napoleonic Wars', 'French Revolutionary Wars'],
    blurb: 'Royal Navy frigate captain hunting a French privateer around Cape Horn.',
    url: 'https://www.imdb.com/title/tt0311113/',
  },
  {
    title: 'Waterloo',
    kind: 'film',
    year: 1970,
    creator: 'Sergei Bondarchuk',
    wars: ['Napoleonic Wars'],
    battles: ['waterloo-1815'],
    blurb: 'Soviet/Italian co-production with thousands of real Red Army extras.',
    url: 'https://www.imdb.com/title/tt0066549/',
  },
  {
    title: 'Napoleon',
    kind: 'film',
    year: 2023,
    creator: 'Ridley Scott',
    wars: ['Napoleonic Wars', 'French Revolutionary Wars'],
    blurb: 'Toulon, Austerlitz, Russia, Waterloo — Scott\'s sweep across the wars.',
    url: 'https://www.imdb.com/title/tt13287846/',
  },
  {
    title: 'War and Peace',
    kind: 'book',
    year: 1869,
    creator: 'Leo Tolstoy',
    wars: ['Napoleonic Wars'],
    blurb: 'Russia 1805–1820 — the largest novel in the language.',
  },
  {
    title: 'The Sharpe series',
    kind: 'book',
    year: 1981,
    creator: 'Bernard Cornwell',
    wars: ['Napoleonic Wars', 'Peninsular War'],
    blurb: 'Richard Sharpe through Talavera, Badajoz, Salamanca, Waterloo — 24 volumes.',
  },

  // Crusades and medieval.
  {
    title: 'Kingdom of Heaven',
    kind: 'film',
    year: 2005,
    creator: 'Ridley Scott',
    wars: ['Crusades'],
    blurb: 'Balian of Ibelin and the 1187 fall of Jerusalem.',
    url: 'https://www.imdb.com/title/tt0320661/',
  },
  {
    title: '300',
    kind: 'film',
    year: 2006,
    creator: 'Zack Snyder',
    wars: ['Greco-Persian Wars'],
    battles: ['thermopylae-480bc'],
    blurb: 'Thermopylae — wildly stylised, historically loose.',
    url: 'https://www.imdb.com/title/tt0416449/',
  },
  {
    title: 'Alexander',
    kind: 'film',
    year: 2004,
    creator: 'Oliver Stone',
    wars: ['Wars of Alexander the Great'],
    blurb: 'The Macedonian campaigns from Granicus to the Hydaspes and back.',
    url: 'https://www.imdb.com/title/tt0346491/',
  },
  {
    title: 'Henry V',
    kind: 'film',
    year: 1989,
    creator: 'Kenneth Branagh',
    wars: ["Hundred Years' War"],
    battles: ['agincourt-1415'],
    blurb: 'Branagh\'s Henry — Agincourt as a muddy, brutalized triumph.',
    url: 'https://www.imdb.com/title/tt0097499/',
  },
  {
    title: 'Braveheart',
    kind: 'film',
    year: 1995,
    creator: 'Mel Gibson',
    wars: ['Wars of Scottish Independence', 'First War of Scottish Independence'],
    blurb: 'William Wallace, Stirling Bridge, and Falkirk — emotionally true, historically loose.',
    url: 'https://www.imdb.com/title/tt0112573/',
  },
  {
    title: 'Outlaw King',
    kind: 'film',
    year: 2018,
    creator: 'David Mackenzie',
    wars: ['Wars of Scottish Independence', 'First War of Scottish Independence'],
    blurb: 'Robert the Bruce from coronation to Loudoun Hill — tighter and grittier than Braveheart.',
    url: 'https://www.imdb.com/title/tt6679794/',
  },

  // American Revolution / Colonial wars.
  {
    title: 'The Patriot',
    kind: 'film',
    year: 2000,
    creator: 'Roland Emmerich',
    wars: ['American Revolutionary War'],
    blurb: 'A South Carolina militia leader fighting Tarleton through the southern campaign.',
    url: 'https://www.imdb.com/title/tt0187393/',
  },
  {
    title: 'The Last of the Mohicans',
    kind: 'film',
    year: 1992,
    creator: 'Michael Mann',
    wars: ['French and Indian War', "Seven Years' War"],
    blurb: 'The 1757 siege of Fort William Henry and its aftermath.',
    url: 'https://www.imdb.com/title/tt0104691/',
  },

  // English Civil War.
  {
    title: 'Cromwell',
    kind: 'film',
    year: 1970,
    creator: 'Ken Hughes',
    wars: ['First English Civil War', 'English Civil War'],
    blurb: 'Cromwell from Marston Moor through the trial of Charles I.',
    url: 'https://www.imdb.com/title/tt0065593/',
  },

  // Yugoslav / Bosnian and post-Cold-War.
  {
    title: 'Welcome to Sarajevo',
    kind: 'film',
    year: 1997,
    creator: 'Michael Winterbottom',
    wars: ['Bosnian War'],
    blurb: 'Foreign correspondents during the siege of Sarajevo.',
    url: 'https://www.imdb.com/title/tt0120539/',
  },

  // Spanish Civil War.
  {
    title: 'For Whom the Bell Tolls',
    kind: 'book',
    year: 1940,
    creator: 'Ernest Hemingway',
    wars: ['Spanish Civil War'],
    blurb: 'An American dynamiter with the International Brigades behind nationalist lines.',
  },
  {
    title: "Homage to Catalonia",
    kind: 'book',
    year: 1938,
    creator: 'George Orwell',
    wars: ['Spanish Civil War'],
    blurb: 'Orwell\'s account of fighting with the POUM militia and the Barcelona May Days.',
  },

  // Falklands.
  {
    title: 'The Falklands War',
    kind: 'documentary',
    year: 1992,
    creator: 'BBC',
    wars: ['Falklands War'],
    blurb: 'BBC five-part series on the 1982 South Atlantic war.',
  },

  // Russian/Soviet wars.
  {
    title: '9th Company',
    kind: 'film',
    year: 2005,
    creator: 'Fyodor Bondarchuk',
    wars: ['Soviet–Afghan War'],
    blurb: 'A Soviet airborne company holding Hill 3234 in the Khost region.',
    url: 'https://www.imdb.com/title/tt0407732/',
  },

  // Pre-modern Asia.
  {
    title: 'Ran',
    kind: 'film',
    year: 1985,
    creator: 'Akira Kurosawa',
    wars: ['Sengoku period'],
    blurb: 'Kurosawa\'s King Lear set among warring Japanese clans.',
    url: 'https://www.imdb.com/title/tt0089881/',
  },
  {
    title: 'Kagemusha',
    kind: 'film',
    year: 1980,
    creator: 'Akira Kurosawa',
    wars: ['Sengoku period'],
    blurb: 'The shadow-double of a Takeda warlord during the campaigns against Oda Nobunaga.',
    url: 'https://www.imdb.com/title/tt0080979/',
  },
  {
    title: 'Seven Samurai',
    kind: 'film',
    year: 1954,
    creator: 'Akira Kurosawa',
    wars: ['Sengoku period'],
    blurb: 'Sengoku-era farmers hire ronin to defend their village.',
    url: 'https://www.imdb.com/title/tt0047478/',
  },
  {
    title: 'The Last Samurai',
    kind: 'film',
    year: 2003,
    creator: 'Edward Zwick',
    wars: ['Boshin War'],
    blurb: 'An American military advisor caught up in the Satsuma Rebellion-era reforms.',
    url: 'https://www.imdb.com/title/tt0325710/',
  },

  // Cold War / proxy.
  {
    title: 'Bridge of Spies',
    kind: 'film',
    year: 2015,
    creator: 'Steven Spielberg',
    wars: ['Cold War'],
    blurb: 'The 1962 Gary Powers spy swap negotiated by lawyer James Donovan.',
    url: 'https://www.imdb.com/title/tt3682448/',
  },
  {
    title: 'Charlie Wilson\'s War',
    kind: 'film',
    year: 2007,
    creator: 'Mike Nichols',
    wars: ['Soviet–Afghan War'],
    blurb: 'How a Texas congressman steered the CIA arming of the mujahideen.',
    url: 'https://www.imdb.com/title/tt0472062/',
  },
  {
    title: 'The Looming Tower',
    kind: 'book',
    year: 2006,
    creator: 'Lawrence Wright',
    wars: ['War on Terror', 'War in Afghanistan (2001–2021)'],
    blurb: 'The path from Sayyid Qutb to 9/11 — the Pulitzer-winning origin story of al-Qaeda.',
  },

  // Russian Civil War.
  {
    title: 'Doctor Zhivago',
    kind: 'film',
    year: 1965,
    creator: 'David Lean',
    wars: ['Russian Civil War', 'World War I'],
    blurb: 'A Russian doctor-poet swept between Whites, Reds, and the Revolution.',
    url: 'https://www.imdb.com/title/tt0059113/',
  },
  {
    title: 'Reds',
    kind: 'film',
    year: 1981,
    creator: 'Warren Beatty',
    wars: ['Russian Civil War'],
    blurb: 'John Reed in Petrograd during the October Revolution.',
    url: 'https://www.imdb.com/title/tt0082979/',
  },

  // Mexican Revolution.
  {
    title: 'Viva Zapata!',
    kind: 'film',
    year: 1952,
    creator: 'Elia Kazan',
    wars: ['Mexican Revolution'],
    blurb: 'Brando as Emiliano Zapata, the agrarian revolutionary of Morelos.',
    url: 'https://www.imdb.com/title/tt0045296/',
  },

  // Cuban Revolution.
  {
    title: 'Che',
    kind: 'film',
    year: 2008,
    creator: 'Steven Soderbergh',
    wars: ['Cuban Revolution'],
    blurb: 'Two-part Soderbergh biography — Cuba\'s Sierra Maestra and Bolivia\'s collapse.',
    url: 'https://www.imdb.com/title/tt0892255/',
  },

  // North Africa / Maghreb.
  {
    title: 'The Sheltering Sky',
    kind: 'book',
    year: 1949,
    creator: 'Paul Bowles',
    wars: ['Algerian War'],
    blurb: 'Americans adrift in postwar North Africa as the colonial order frays.',
  },
  {
    title: 'The Centurions',
    kind: 'book',
    year: 1960,
    creator: 'Jean Lartéguy',
    wars: ['Algerian War', 'First Indochina War'],
    blurb: 'French paratroopers from Dien Bien Phu to Algiers — the operative bible of counter-insurgency.',
  },

  // First Indochina War.
  {
    title: 'Hell in a Very Small Place',
    kind: 'book',
    year: 1967,
    creator: 'Bernard Fall',
    wars: ['First Indochina War'],
    blurb: 'The 1954 siege of Dien Bien Phu — the foundational English account.',
  },

  // Spanish American War.
  {
    title: 'Rough Riders',
    kind: 'series',
    year: 1997,
    creator: 'John Milius',
    wars: ['Spanish–American War'],
    blurb: 'Theodore Roosevelt\'s volunteer regiment at Las Guásimas and San Juan Hill.',
    url: 'https://www.imdb.com/title/tt0119989/',
  },

  // Boer War.
  {
    title: 'Breaker Morant',
    kind: 'film',
    year: 1980,
    creator: 'Bruce Beresford',
    wars: ['Second Boer War'],
    blurb: 'Australian cavalrymen court-martialed for the killing of Boer POWs.',
    url: 'https://www.imdb.com/title/tt0080310/',
  },

  // Israeli/Palestinian.
  {
    title: 'Waltz with Bashir',
    kind: 'film',
    year: 2008,
    creator: 'Ari Folman',
    wars: ['1982 Lebanon War'],
    blurb: 'Animated memoir of the 1982 Beirut campaign and the Sabra-Shatila massacre.',
    url: 'https://www.imdb.com/title/tt1185616/',
  },
  {
    title: 'Beaufort',
    kind: 'film',
    year: 2007,
    creator: 'Joseph Cedar',
    wars: ['1982 Lebanon War', 'Lebanese Civil War'],
    blurb: 'IDF garrison at Beaufort Castle awaiting the May 2000 withdrawal.',
    url: 'https://www.imdb.com/title/tt0974670/',
  },
  {
    title: 'Munich',
    kind: 'film',
    year: 2005,
    creator: 'Steven Spielberg',
    wars: ['Israeli–Palestinian conflict'],
    blurb: 'Israeli operatives hunting Black September after the 1972 Munich Olympics.',
    url: 'https://www.imdb.com/title/tt0408306/',
  },

  // Greek/Persian/Antiquity.
  {
    title: 'The Persian Boy',
    kind: 'book',
    year: 1972,
    creator: 'Mary Renault',
    wars: ['Wars of Alexander the Great'],
    blurb: 'Alexander\'s eastern campaigns seen through the eyes of Bagoas.',
  },
  {
    title: 'Gates of Fire',
    kind: 'book',
    year: 1998,
    creator: 'Steven Pressfield',
    wars: ['Greco-Persian Wars'],
    blurb: 'Thermopylae as told by the only Spartan survivor — historical fiction with weight.',
  },
  {
    title: 'The Histories',
    kind: 'book',
    year: -440,
    creator: 'Herodotus',
    wars: ['Greco-Persian Wars'],
    blurb: 'The original account of the Greco-Persian wars by the "Father of History".',
  },
  {
    title: 'The Peloponnesian War',
    kind: 'book',
    year: -411,
    creator: 'Thucydides',
    wars: ['Peloponnesian War'],
    blurb: 'The contemporary general\'s account — the founding text of strategic thinking.',
  },

  // Roman.
  {
    title: 'I, Claudius',
    kind: 'series',
    year: 1976,
    creator: 'Jack Pulman / Herbert Wise',
    wars: ['Crisis of the Third Century'],
    blurb: 'Robert Graves\' Julio-Claudian Rome adapted for the BBC.',
    url: 'https://www.imdb.com/title/tt0074006/',
  },
  {
    title: 'Rubicon',
    kind: 'book',
    year: 2003,
    creator: 'Tom Holland',
    wars: ["Caesar's Civil War", 'Gallic Wars'],
    blurb: 'The last decades of the Roman Republic — Marius to Augustus.',
  },
  {
    title: 'Ghost on the Throne',
    kind: 'book',
    year: 2011,
    creator: 'James Romm',
    wars: ['Wars of the Diadochi'],
    blurb: 'The 40-year war for Alexander\'s empire after his death.',
  },

  // Crusades / medieval (more).
  {
    title: 'God\'s War',
    kind: 'book',
    year: 2006,
    creator: 'Christopher Tyerman',
    wars: ['Crusades'],
    blurb: 'The standard one-volume modern history of the Crusades.',
  },
  {
    title: 'Holy War',
    kind: 'book',
    year: 1987,
    creator: 'Karen Armstrong',
    wars: ['Crusades'],
    blurb: 'The Crusades through three perspectives: Christian, Muslim, Jewish.',
  },

  // Reconquista.
  {
    title: 'El Cid',
    kind: 'film',
    year: 1961,
    creator: 'Anthony Mann',
    wars: ['Reconquista'],
    blurb: 'Rodrigo Díaz de Vivar against the Almoravids at Valencia.',
    url: 'https://www.imdb.com/title/tt0054847/',
  },

  // English Civil War (more).
  {
    title: 'The English Civil Wars',
    kind: 'book',
    year: 2009,
    creator: 'Diane Purkiss',
    wars: ['Wars of the Three Kingdoms', 'First English Civil War', 'Second English Civil War'],
    blurb: 'Social and military history of the 1640s war that produced the modern English state.',
  },

  // French Revolutionary Wars.
  {
    title: 'Citizens',
    kind: 'book',
    year: 1989,
    creator: 'Simon Schama',
    wars: ['French Revolution'],
    blurb: 'A single-volume narrative of the Revolution\'s decade.',
  },

  // 1812.
  {
    title: 'Master and Commander',
    kind: 'book',
    year: 1969,
    creator: "Patrick O'Brian",
    wars: ['Napoleonic Wars', 'French Revolutionary Wars'],
    blurb: 'The first Aubrey-Maturin novel — a 20-volume Royal Navy series at sea during the wars.',
  },

  // Crimean War.
  {
    title: 'The Charge of the Light Brigade',
    kind: 'film',
    year: 1968,
    creator: 'Tony Richardson',
    wars: ['Crimean War'],
    battles: ['balaclava-1854'],
    blurb: 'Balaclava\'s catastrophic cavalry charge through Tennyson and ironic Victorian satire.',
    url: 'https://www.imdb.com/title/tt0062794/',
  },
  {
    title: 'The Reason Why',
    kind: 'book',
    year: 1953,
    creator: 'Cecil Woodham-Smith',
    wars: ['Crimean War'],
    blurb: 'The full backstory of how the Light Brigade ended up charging the wrong guns.',
  },

  // Sino-Japanese / Boxer.
  {
    title: '55 Days at Peking',
    kind: 'film',
    year: 1963,
    creator: 'Nicholas Ray',
    wars: ['Boxer Rebellion'],
    blurb: 'The 1900 siege of the foreign legations in Beijing.',
    url: 'https://www.imdb.com/title/tt0056800/',
  },

  // Holocaust / WW2 specifics.
  {
    title: 'The Pianist',
    kind: 'film',
    year: 2002,
    creator: 'Roman Polanski',
    wars: ['World War II'],
    blurb: 'Władysław Szpilman\'s survival through the Warsaw ghetto and Uprising.',
    url: 'https://www.imdb.com/title/tt0253474/',
  },
  {
    title: 'Son of Saul',
    kind: 'film',
    year: 2015,
    creator: 'László Nemes',
    wars: ['World War II'],
    blurb: 'A Sonderkommando at Auschwitz over two days — Cannes Grand Prix winner.',
    url: 'https://www.imdb.com/title/tt3808342/',
  },
  {
    title: 'Generation War',
    kind: 'series',
    year: 2013,
    creator: 'Philipp Kadelbach',
    wars: ['World War II'],
    blurb: 'Five German friends across the Eastern Front, the Holocaust, and home.',
    url: 'https://www.imdb.com/title/tt2890214/',
  },
  {
    title: 'Hyena Road',
    kind: 'film',
    year: 2015,
    creator: 'Paul Gross',
    wars: ['War in Afghanistan (2001–2021)'],
    blurb: 'Canadian forces in Kandahar — counter-insurgency from a sniper team\'s eye.',
    url: 'https://www.imdb.com/title/tt3892006/',
  },

  // Bangladesh / Indo-Pak.
  {
    title: 'A Stranger in My Own Country',
    kind: 'book',
    year: 1994,
    creator: 'Khwaja Khairuddin',
    wars: ['Bangladesh Liberation War', 'Indo-Pakistani War of 1971'],
    blurb: 'A Bengali official\'s memoir of the 1971 break-up of Pakistan.',
  },

  // Korean Independence / Japanese occupation.
  {
    title: 'Pachinko',
    kind: 'series',
    year: 2022,
    creator: 'Soo Hugh',
    wars: ['Korean Independence Movement'],
    blurb: 'A Korean family across Japanese colonial rule, war, and postwar Osaka.',
    url: 'https://www.imdb.com/title/tt10350132/',
  },

  // Khmer Rouge.
  {
    title: 'The Killing Fields',
    kind: 'film',
    year: 1984,
    creator: 'Roland Joffé',
    wars: ['Cambodian Civil War', 'Cambodian–Vietnamese War'],
    blurb: 'NYT correspondent Sydney Schanberg and Cambodian journalist Dith Pran during the fall of Phnom Penh.',
    url: 'https://www.imdb.com/title/tt0087553/',
  },

  // Rwanda.
  {
    title: 'Hotel Rwanda',
    kind: 'film',
    year: 2004,
    creator: 'Terry George',
    wars: ['Rwandan genocide'],
    blurb: 'A hotel manager shelters refugees from the 1994 Tutsi genocide.',
    url: 'https://www.imdb.com/title/tt0395169/',
  },
  {
    title: 'We Wish to Inform You That Tomorrow We Will Be Killed with Our Families',
    kind: 'book',
    year: 1998,
    creator: 'Philip Gourevitch',
    wars: ['Rwandan genocide'],
    blurb: 'The New Yorker writer\'s reporting from post-genocide Rwanda.',
  },

  // Bosnia (more).
  {
    title: 'Quo Vadis, Aida?',
    kind: 'film',
    year: 2020,
    creator: 'Jasmila Žbanić',
    wars: ['Bosnian War'],
    blurb: 'A UN translator inside the Dutch UNPROFOR compound during the Srebrenica massacre.',
    url: 'https://www.imdb.com/title/tt8633462/',
  },
  {
    title: 'The Cellist of Sarajevo',
    kind: 'book',
    year: 2008,
    creator: 'Steven Galloway',
    wars: ['Bosnian War'],
    blurb: 'Three Sarajevans during the 1992-95 siege.',
  },

  // Salvadoran/Cold War Latin America.
  {
    title: 'Salvador',
    kind: 'film',
    year: 1986,
    creator: 'Oliver Stone',
    wars: ['Salvadoran Civil War'],
    blurb: 'A drug-addled journalist in El Salvador as the death-squad war hits its peak.',
    url: 'https://www.imdb.com/title/tt0091886/',
  },

  // Russia-Ukraine.
  {
    title: '20 Days in Mariupol',
    kind: 'documentary',
    year: 2023,
    creator: 'Mstyslav Chernov',
    wars: ['Russo-Ukrainian War'],
    blurb: 'AP team\'s footage from inside besieged Mariupol — Oscar-winning documentary.',
    url: 'https://www.imdb.com/title/tt26439114/',
  },
  {
    title: 'Winter on Fire',
    kind: 'documentary',
    year: 2015,
    creator: 'Evgeny Afineevsky',
    wars: ['Russo-Ukrainian War'],
    blurb: 'The 93 days of the Maidan protests that preceded the war.',
    url: 'https://www.imdb.com/title/tt5078160/',
  },

  // 9/11 / post-9/11.
  {
    title: 'United 93',
    kind: 'film',
    year: 2006,
    creator: 'Paul Greengrass',
    wars: ['War on Terror'],
    blurb: 'The hijacking of Flight 93, almost in real time.',
    url: 'https://www.imdb.com/title/tt0475276/',
  },
  {
    title: 'Zero Dark Thirty',
    kind: 'film',
    year: 2012,
    creator: 'Kathryn Bigelow',
    wars: ['War on Terror'],
    blurb: 'The ten-year CIA hunt for Osama bin Laden.',
    url: 'https://www.imdb.com/title/tt1790885/',
  },

  // Falklands.
  {
    title: 'The Falklands Play',
    kind: 'film',
    year: 2002,
    creator: 'Ian Curteis / Michael Samuels',
    wars: ['Falklands War'],
    blurb: 'Thatcher\'s war cabinet across the 1982 South Atlantic crisis.',
    url: 'https://www.imdb.com/title/tt0301328/',
  },

  // Operation Anthropoid.
  {
    title: 'Anthropoid',
    kind: 'film',
    year: 2016,
    creator: 'Sean Ellis',
    wars: ['World War II'],
    blurb: 'Czechoslovak operatives parachuted to assassinate Reinhard Heydrich in Prague.',
    url: 'https://www.imdb.com/title/tt4190530/',
  },

  // Eastern Front (more).
  {
    title: 'The Cranes Are Flying',
    kind: 'film',
    year: 1957,
    creator: 'Mikhail Kalatozov',
    wars: ['World War II', 'Eastern Front (World War II)'],
    blurb: 'Cannes Palme d\'Or winner — Moscow during the Great Patriotic War.',
    url: 'https://www.imdb.com/title/tt0050634/',
  },
  {
    title: 'Ivan\'s Childhood',
    kind: 'film',
    year: 1962,
    creator: 'Andrei Tarkovsky',
    wars: ['World War II', 'Eastern Front (World War II)'],
    blurb: 'A boy-scout reconnaissance for a Soviet rifle company on the German front.',
    url: 'https://www.imdb.com/title/tt0055032/',
  },

  // Tarawa / Pacific (more).
  {
    title: 'With the Old Breed',
    kind: 'book',
    year: 1981,
    creator: 'E.B. Sledge',
    wars: ['World War II', 'Pacific War'],
    blurb: 'The Marine infantryman\'s memoir of Peleliu and Okinawa — the basis for The Pacific.',
  },
  {
    title: 'Helmet for My Pillow',
    kind: 'book',
    year: 1957,
    creator: 'Robert Leckie',
    wars: ['World War II', 'Pacific War'],
    blurb: 'Marine memoir from Guadalcanal to Peleliu.',
  },

  // North Africa.
  {
    title: 'The Desert Fox',
    kind: 'film',
    year: 1951,
    creator: 'Henry Hathaway',
    wars: ['World War II', 'North African campaign'],
    blurb: 'Rommel from El Alamein through the July 20 plot.',
    url: 'https://www.imdb.com/title/tt0043551/',
  },

  // Italian campaign.
  {
    title: 'The Monuments Men',
    kind: 'film',
    year: 2014,
    creator: 'George Clooney',
    wars: ['World War II'],
    blurb: 'A US-Allied unit recovering Nazi-looted art across Europe.',
    url: 'https://www.imdb.com/title/tt2177771/',
  },

  // Pre-modern (Mongol / Asia).
  {
    title: 'Mongol',
    kind: 'film',
    year: 2007,
    creator: 'Sergei Bodrov',
    wars: ['Mongol invasions and conquests'],
    blurb: 'Genghis Khan\'s rise from captivity to the unification of the Mongol tribes.',
    url: 'https://www.imdb.com/title/tt0416044/',
  },
  {
    title: 'Genghis Khan: His Life and Legacy',
    kind: 'book',
    year: 1991,
    creator: 'Paul Ratchnevsky',
    wars: ['Mongol invasions and conquests'],
    blurb: 'The standard scholarly biography.',
  },

  // Cuban Missile / Cold War.
  {
    title: 'Thirteen Days',
    kind: 'film',
    year: 2000,
    creator: 'Roger Donaldson',
    wars: ['Cuban Missile Crisis', 'Cold War'],
    blurb: 'October 1962 inside the Kennedy White House.',
    url: 'https://www.imdb.com/title/tt0146309/',
  },

  // British Empire / Suez.
  {
    title: 'Lawrence of Arabia',
    kind: 'book',
    year: 1989,
    creator: 'Lawrence James',
    wars: ['Middle Eastern theatre of World War I'],
    blurb: 'Authoritative single-volume Lawrence biography.',
  },

  // Special-ops / Berlin.
  {
    title: 'Stalin\'s War',
    kind: 'book',
    year: 2021,
    creator: 'Sean McMeekin',
    wars: ['World War II', 'Eastern Front (World War II)'],
    blurb: 'A reframing of WW2 with Stalin as a co-architect rather than victim.',
  },

  // Late 20th century African.
  {
    title: 'Blood Diamond',
    kind: 'film',
    year: 2006,
    creator: 'Edward Zwick',
    wars: ['Sierra Leone Civil War'],
    blurb: 'The conflict-diamond trade fueling Sierra Leone\'s 1990s civil war.',
    url: 'https://www.imdb.com/title/tt0450259/',
  },
  {
    title: 'Beasts of No Nation',
    kind: 'film',
    year: 2015,
    creator: 'Cary Fukunaga',
    wars: ['Sierra Leone Civil War', 'First Liberian Civil War'],
    blurb: 'A West African child soldier under a charismatic commandant.',
    url: 'https://www.imdb.com/title/tt1365050/',
  },
  {
    title: 'King Solomon\'s Mines',
    kind: 'book',
    year: 1885,
    creator: 'H. Rider Haggard',
    wars: ['Anglo-Zulu War'],
    blurb: 'The novel that shaped Victorian imagination of southern Africa.',
  },

  // Japanese expansion / occupation.
  {
    title: 'The Wind Rises',
    kind: 'film',
    year: 2013,
    creator: 'Hayao Miyazaki',
    wars: ['Second Sino-Japanese War', 'World War II'],
    blurb: 'The young Jiro Horikoshi designing the Zero fighter as Japan slides into war.',
    url: 'https://www.imdb.com/title/tt2013293/',
  },
  {
    title: 'Grave of the Fireflies',
    kind: 'film',
    year: 1988,
    creator: 'Isao Takahata',
    wars: ['World War II', 'Pacific War'],
    blurb: 'Two children survive the firebombing of Kobe.',
    url: 'https://www.imdb.com/title/tt0095327/',
  },
  {
    title: 'Empire of the Sun',
    kind: 'film',
    year: 1987,
    creator: 'Steven Spielberg',
    wars: ['World War II', 'Pacific War', 'Second Sino-Japanese War'],
    blurb: 'A British boy interned by the Japanese in Shanghai, 1941–1945.',
    url: 'https://www.imdb.com/title/tt0092965/',
  },
  {
    title: 'City of Life and Death',
    kind: 'film',
    year: 2009,
    creator: 'Lu Chuan',
    wars: ['Second Sino-Japanese War'],
    blurb: 'The Rape of Nanking from Chinese, Japanese, and German observer perspectives.',
    url: 'https://www.imdb.com/title/tt1124052/',
  },

  // Spanish Civil War (more).
  {
    title: 'Land and Freedom',
    kind: 'film',
    year: 1995,
    creator: 'Ken Loach',
    wars: ['Spanish Civil War'],
    blurb: 'A British communist in the POUM militia — the inverse of Orwell\'s vantage.',
    url: 'https://www.imdb.com/title/tt0113627/',
  },
  {
    title: 'Pan\'s Labyrinth',
    kind: 'film',
    year: 2006,
    creator: 'Guillermo del Toro',
    wars: ['Spanish Civil War'],
    blurb: 'A child\'s fairy-tale survival inside the Republican guerrilla war against Franco.',
    url: 'https://www.imdb.com/title/tt0457430/',
  },
  {
    title: 'The Battle for Spain',
    kind: 'book',
    year: 2006,
    creator: 'Antony Beevor',
    wars: ['Spanish Civil War'],
    blurb: 'The standard one-volume modern history of the 1936-39 war.',
  },

  // Greek War of Independence.
  {
    title: 'The Cretan Runner',
    kind: 'book',
    year: 1955,
    creator: 'George Psychoundakis',
    wars: ['World War II'],
    blurb: 'A Cretan shepherd\'s memoir of the wartime British SOE resistance on the island.',
  },

  // Pre-Roman antiquity (more).
  {
    title: 'The Roman Revolution',
    kind: 'book',
    year: 1939,
    creator: 'Ronald Syme',
    wars: ["Caesar's Civil War"],
    blurb: 'The classic study of the transition from Republic to Augustus.',
  },
  {
    title: 'The Punic Wars',
    kind: 'book',
    year: 2000,
    creator: 'Adrian Goldsworthy',
    wars: ['First Punic War', 'Second Punic War', 'Third Punic War'],
    blurb: 'The 118-year struggle between Rome and Carthage in one volume.',
  },
  {
    title: 'Carthage Must Be Destroyed',
    kind: 'book',
    year: 2010,
    creator: 'Richard Miles',
    wars: ['First Punic War', 'Second Punic War', 'Third Punic War'],
    blurb: 'Carthaginian civilization through to its annihilation by Rome.',
  },

  // Crusades (more).
  {
    title: 'The First Crusade',
    kind: 'book',
    year: 1995,
    creator: 'Thomas Asbridge',
    wars: ['Crusades', 'First Crusade'],
    blurb: 'The 1095-1099 march from Clermont to the capture of Jerusalem.',
  },

  // American Revolution (more).
  {
    title: '1776',
    kind: 'book',
    year: 2005,
    creator: 'David McCullough',
    wars: ['American Revolutionary War'],
    blurb: 'The single year that decided the Revolution — Trenton, Princeton, the army that held.',
  },

  // Mexican-American War.
  {
    title: 'A Wicked War',
    kind: 'book',
    year: 2012,
    creator: 'Amy S. Greenberg',
    wars: ['Mexican-American War'],
    blurb: 'Polk\'s war and its contested American politics.',
  },

  // Modern insurgency.
  {
    title: 'Sebastian Junger\'s War',
    kind: 'book',
    year: 2010,
    creator: 'Sebastian Junger',
    wars: ['War in Afghanistan (2001–2021)'],
    blurb: 'A year with US infantry at OP Restrepo, Korengal Valley — companion to the Restrepo documentary.',
  },
  {
    title: 'No Easy Day',
    kind: 'book',
    year: 2012,
    creator: 'Mark Owen',
    wars: ['War on Terror'],
    blurb: 'A Navy SEAL\'s firsthand account of the bin Laden raid.',
  },
  {
    title: 'Black Sea',
    kind: 'documentary',
    year: 2024,
    creator: 'BBC',
    wars: ['Russo-Ukrainian War'],
    blurb: 'The maritime side of the Ukraine war — Ukrainian sea drone operations.',
  },

  // Latin America (Mexican Revolution etc.).
  {
    title: 'And the Hippos Were Boiled in Their Tanks',
    kind: 'book',
    year: 1945,
    creator: 'Jack Kerouac & William S. Burroughs',
    wars: ['World War II'],
    blurb: 'The Beats\' WW2-era home-front novel.',
  },

  // Vietnam (more).
  {
    title: 'A Bright Shining Lie',
    kind: 'book',
    year: 1988,
    creator: 'Neil Sheehan',
    wars: ['Vietnam War'],
    blurb: 'John Paul Vann\'s war and Vietnam — the Pulitzer-winning bombshell on the conflict\'s self-deceptions.',
  },
  {
    title: 'Matterhorn',
    kind: 'book',
    year: 2010,
    creator: 'Karl Marlantes',
    wars: ['Vietnam War'],
    blurb: 'A Marine company in I Corps, written by an officer who was there.',
  },
  {
    title: 'The Sympathizer',
    kind: 'book',
    year: 2015,
    creator: 'Viet Thanh Nguyen',
    wars: ['Vietnam War'],
    blurb: 'A North Vietnamese double agent inside the South Vietnamese army and into postwar California — Pulitzer Prize.',
  },

  // Korean (more).
  {
    title: 'The Coldest Winter',
    kind: 'book',
    year: 2007,
    creator: 'David Halberstam',
    wars: ['Korean War'],
    blurb: 'A panoramic account from Inchon to the Yalu and back, by a master narrator.',
  },

  // Battle of Algiers / colonial.
  {
    title: 'A Savage War of Peace',
    kind: 'book',
    year: 1977,
    creator: 'Alistair Horne',
    wars: ['Algerian War'],
    blurb: 'The definitive English account of the 1954-62 French war in Algeria.',
  },

  // Falklands.
  {
    title: 'The Falklands War',
    kind: 'book',
    year: 1983,
    creator: 'Sir Lawrence Freedman',
    wars: ['Falklands War'],
    blurb: 'The official British history — two volumes covering causes and conduct.',
  },

  // WWI (more).
  {
    title: 'The First World War',
    kind: 'book',
    year: 1998,
    creator: 'John Keegan',
    wars: ['World War I'],
    blurb: 'The standard popular one-volume history.',
  },
  {
    title: 'Bury the Chains',
    kind: 'book',
    year: 2005,
    creator: 'Adam Hochschild',
    wars: [],
    blurb: 'The British abolitionist movement — background to the colonial-era African wars.',
  },

  // Hundred Years' War.
  {
    title: 'A Distant Mirror',
    kind: 'book',
    year: 1978,
    creator: 'Barbara Tuchman',
    wars: ["Hundred Years' War"],
    blurb: 'The 14th century — Black Death, Hundred Years\' War, the calamitous medieval crisis.',
  },

  // Sengoku (more).
  {
    title: 'Shōgun',
    kind: 'series',
    year: 2024,
    creator: 'Justin Marks / Rachel Kondo',
    wars: ['Sengoku period'],
    blurb: 'James Clavell\'s 1600 Japan — Toranaga (Tokugawa) consolidating power before Sekigahara.',
    url: 'https://www.imdb.com/title/tt2402157/',
  },

  // 21st-c. Ukraine (more).
  {
    title: 'A Diary of the Russo-Ukrainian War',
    kind: 'book',
    year: 2024,
    creator: 'Olena Stiazhkina',
    wars: ['Russo-Ukrainian War'],
    blurb: 'Ukrainian historian\'s diary across the invasion years.',
  },

  // Cyprus, Greece, Balkans.
  {
    title: 'Bitter Lemons of Cyprus',
    kind: 'book',
    year: 1957,
    creator: 'Lawrence Durrell',
    wars: ['Cyprus Emergency'],
    blurb: 'Durrell\'s lyric memoir of Cyprus during the EOKA insurgency.',
  },

  // Korean Independence.
  {
    title: 'The Birth of Korean Cool',
    kind: 'book',
    year: 2014,
    creator: 'Euny Hong',
    wars: [],
    blurb: 'Modern Korea\'s cultural ascendance — postwar context for the Korean War cinema canon.',
  },

  // Genghis Khan (more).
  {
    title: 'Genghis Khan and the Making of the Modern World',
    kind: 'book',
    year: 2004,
    creator: 'Jack Weatherford',
    wars: ['Mongol invasions and conquests'],
    blurb: 'A revisionist Genghis biography — Mongol institutions as foundational to Eurasia.',
  },
];

// WAR_PARENTS lets resolveMediaFor walk upward from sub-war/theater names to
// the parent war so a Battle of Stalingrad (tagged Eastern Front / WW2) also
// surfaces general WW2 media. Maintained by hand because the data side's
// parent field is for casualty roll-up, which is a slightly different
// inheritance: a sub-campaign's casualties should sum to the parent, but its
// media should ALSO inherit. Keeping the two separate avoids surprises.
const WAR_PARENTS: Record<string, string[]> = {
  'Eastern Front (World War II)': ['World War II'],
  'Western Front (World War II)': ['World War II'],
  'Pacific War': ['World War II'],
  'North African campaign': ['World War II'],
  'Italian campaign (World War II)': ['World War II'],
  'Battle of the Atlantic': ['World War II'],
  'Battle of Britain': ['World War II'],
  'Norwegian Campaign': ['World War II'],
  'Invasion of Poland': ['World War II'],
  'World War II in Yugoslavia': ['World War II'],
  'Second Sino-Japanese War': ['World War II'],
  'Winter War': ['World War II'],
  'Continuation War': ['World War II'],
  'Western Front (World War I)': ['World War I'],
  'Eastern Front (World War I)': ['World War I'],
  'Gallipoli campaign': ['World War I'],
  'Middle Eastern theatre of World War I': ['World War I'],
  'War in Donbas (2014–2022)': ['Russo-Ukrainian War'],
  'War in Iraq (2013–2017)': ['Iraq War', 'War on Terror'],
  'War in Afghanistan (2001–2021)': ['War on Terror'],
  'Iraq War': ['War on Terror'],
  'First English Civil War': ['English Civil War', 'Wars of the Three Kingdoms'],
  'Second English Civil War': ['English Civil War', 'Wars of the Three Kingdoms'],
  'First Crusade': ['Crusades'],
  'Second Crusade': ['Crusades'],
  'Third Crusade': ['Crusades'],
  'Fourth Crusade': ['Crusades'],
  'First War of Scottish Independence': ['Wars of Scottish Independence'],
  'Second War of Scottish Independence': ['Wars of Scottish Independence'],
  'First Punic War': ['Punic Wars'],
  'Second Punic War': ['Punic Wars'],
  'Third Punic War': ['Punic Wars'],
  'Peninsular War': ['Napoleonic Wars'],
  'War of the First Coalition': ['French Revolutionary Wars'],
  'War of the Second Coalition': ['French Revolutionary Wars'],
  'War of the Third Coalition': ['Napoleonic Wars'],
  'War of the Fourth Coalition': ['Napoleonic Wars'],
  'War of the Fifth Coalition': ['Napoleonic Wars'],
  'War of the Sixth Coalition': ['Napoleonic Wars'],
  'Hundred Days': ['Napoleonic Wars'],
  'French invasion of Russia': ['Napoleonic Wars'],
  "Russo-Turkish War (1877–1878)": ['Russo-Turkish Wars'],
  "Russo-Turkish War (1768–1774)": ['Russo-Turkish Wars'],
  "Russo-Turkish War (1787–1792)": ['Russo-Turkish Wars'],
};

// resolveMediaFor returns up to `max` entries relevant to the given war and/or
// battle id. Battle matches rank ahead of direct war matches; parent-war
// matches rank last so the most specific cohort surfaces first.
export function resolveMediaFor(opts: { war?: string; battleId?: string; max?: number }): MediaEntry[] {
  const max = opts.max ?? 6;
  const battleId = opts.battleId;
  const war = opts.war;
  // Build the set of war names to match against: the war itself, plus any
  // parents declared in WAR_PARENTS.
  const warSet = new Set<string>();
  if (war) {
    warSet.add(war);
    for (const parent of WAR_PARENTS[war] ?? []) warSet.add(parent);
  }
  const byBattle: MediaEntry[] = [];
  const byWar: MediaEntry[] = [];
  const byParent: MediaEntry[] = [];
  for (const m of MEDIA_LIBRARY) {
    let isBattle = false;
    let warMatch: 'direct' | 'parent' | 'none' = 'none';
    if (battleId && m.battles && m.battles.includes(battleId)) isBattle = true;
    if (m.wars && war) {
      if (m.wars.includes(war)) warMatch = 'direct';
      else if (m.wars.some((w) => warSet.has(w))) warMatch = 'parent';
    }
    if (isBattle) byBattle.push(m);
    else if (warMatch === 'direct') byWar.push(m);
    else if (warMatch === 'parent') byParent.push(m);
  }
  return [...byBattle, ...byWar, ...byParent].slice(0, max);
}
