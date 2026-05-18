// Curated set of historical beats anchoring the "Play history" sweep. When
// the year playhead crosses one of these years, the sweep pauses and flashes
// a title card. Coverage is intentionally global. Europe stays well-represented
// but Asia, the Middle East, the Americas, and Africa each get their own
// landmark moments so the 2,500-year sweep does not collapse into a single
// civilizational story.
//
// Each beat is anchored to the canonical English year for the event. battleId
// links the beat to a curated battle entry when one exists in the catalog so
// the user can dive in.

export interface HistoryBeat {
  // year is the calendar year the beat fires on, negative for BC.
  year: number;
  // headline is the punch line, set in the era display font on the card.
  headline: string;
  // sub is one or two sentences of dossier context.
  sub: string;
  // era is the era key (matches ERA_LABELS keys) so the card themes itself.
  era: string;
  // region is the broad geographic theatre the beat belongs to. Surfaces as a
  // small chip on the card so the user reads the global rhythm of history at
  // a glance, not only the chronological one.
  region: 'Europe' | 'Middle East' | 'Asia' | 'Africa' | 'Americas' | 'Mediterranean' | 'Atlantic';
  // date is the canonical date string used on the card when day-precision is
  // known. Falls back to the year display when omitted.
  date?: string;
  // battleId optionally links the beat to a specific battle entry so the
  // user can jump into it after the card. Not all beats are battles.
  battleId?: string;
}

export const HISTORY_BEATS: HistoryBeat[] = [
  // ANCIENT WORLD
  {
    year: -490,
    headline: 'Marathon',
    sub: 'The Athenian phalanx halts the Persian landing on the plain north of the city. Greek hoplite warfare announces itself.',
    era: 'ancient',
    region: 'Mediterranean',
    date: 'September, 490 BC',
    battleId: 'marathon-490bc',
  },
  {
    year: -480,
    headline: 'Salamis',
    sub: 'Themistocles lures the Persian fleet into the narrows. Three hundred triremes shatter an armada twice their size and Xerxes watches his invasion break apart from the shore.',
    era: 'ancient',
    region: 'Mediterranean',
    date: 'September, 480 BC',
  },
  {
    year: -331,
    headline: 'Gaugamela',
    sub: 'Alexander pivots a single wing through the Persian line and ends the Achaemenid Empire in a single afternoon. The known world tilts east.',
    era: 'ancient',
    region: 'Middle East',
    date: '1 October 331 BC',
  },
  {
    year: -216,
    headline: 'Cannae',
    sub: "Hannibal annihilates a Roman army of 86,000 with a double envelopment that every general since has tried to imitate.",
    era: 'ancient',
    region: 'Mediterranean',
    date: '2 August 216 BC',
    battleId: 'cannae-216bc',
  },
  {
    year: -53,
    headline: 'Carrhae',
    sub: "Parthian horse archers ride a Roman legion to a standstill in the Mesopotamian sun. Crassus is killed and Rome learns the eastern frontier will not be a triumph.",
    era: 'ancient',
    region: 'Middle East',
    date: '6 May 53 BC',
  },
  {
    year: 208,
    headline: 'Red Cliffs',
    sub: 'Allied southern fleets burn Cao Cao on the Yangtze. China splits into Three Kingdoms and a thousand years of imperial unity slips for a generation.',
    era: 'ancient',
    region: 'Asia',
    date: 'Winter, 208 AD',
  },
  {
    year: 378,
    headline: 'Adrianople',
    sub: 'Gothic cavalry rides over the eastern Roman field army. The emperor Valens dies in the line and the western empire begins its slow unmaking.',
    era: 'ancient',
    region: 'Europe',
    date: '9 August 378',
  },
  {
    year: 410,
    headline: 'Rome Sacked',
    sub: 'Alaric and the Visigoths breach the Aurelian Walls. The first time the city has fallen in eight centuries.',
    era: 'medieval',
    region: 'Europe',
    date: '24 August 410',
  },

  // MEDIEVAL
  {
    year: 636,
    headline: 'Yarmouk',
    sub: 'Arab armies crush the Byzantine field force on the Syrian frontier. Within a generation the entire Levant, Egypt, and Persia speak a new language and pray to a new God.',
    era: 'medieval',
    region: 'Middle East',
    date: 'August, 636',
  },
  {
    year: 680,
    headline: 'Karbala',
    sub: "Husayn ibn Ali and seventy companions are killed on the plain west of the Euphrates. The Sunni–Shia rupture is sealed in his grandson's blood.",
    era: 'medieval',
    region: 'Middle East',
    date: '10 October 680',
  },
  {
    year: 732,
    headline: 'Tours',
    sub: "Charles Martel halts the Umayyad advance into Francia between Tours and Poitiers. The northern limit of Islamic Europe is fixed for a thousand years.",
    era: 'medieval',
    region: 'Europe',
    date: 'October, 732',
  },
  {
    year: 751,
    headline: 'Talas',
    sub: 'The Abbasid Caliphate meets the Tang Empire on a river in Central Asia. Tang power retreats from the steppe and, with the captured artisans, papermaking begins its journey west.',
    era: 'medieval',
    region: 'Asia',
    date: 'July, 751',
  },
  {
    year: 1066,
    headline: 'Hastings',
    sub: 'William of Normandy kills Harold at the foot of Senlac Hill and takes the English throne.',
    era: 'medieval',
    region: 'Europe',
    date: '14 October 1066',
    battleId: 'hastings-1066',
  },
  {
    year: 1071,
    headline: 'Manzikert',
    sub: 'Seljuk Turks rout the Byzantine army and capture the emperor. Anatolia opens. The First Crusade is being written in advance.',
    era: 'medieval',
    region: 'Middle East',
    date: '26 August 1071',
  },
  {
    year: 1187,
    headline: 'Hattin',
    sub: "Saladin traps the Crusader army on a waterless ridge above the Sea of Galilee. Jerusalem falls within months and Europe answers with the Third Crusade.",
    era: 'medieval',
    region: 'Middle East',
    date: '4 July 1187',
  },
  {
    year: 1241,
    headline: 'Mohi',
    sub: 'Subutai destroys the Hungarian army on the Sajó. The Mongol storm reaches the Adriatic, and only the death of the Great Khan saves western Europe from finding out what comes next.',
    era: 'medieval',
    region: 'Europe',
    date: '11 April 1241',
  },
  {
    year: 1258,
    headline: 'Baghdad',
    sub: "Hulagu's siege engines crack the walls of the City of Peace. The caliph is rolled in a carpet and trampled. Five hundred years of Abbasid rule end in a week.",
    era: 'medieval',
    region: 'Middle East',
    date: '10 February 1258',
  },
  {
    year: 1453,
    headline: 'Constantinople',
    sub: "The Theodosian Walls fall to Mehmed II's bombards after 53 days. The Roman Empire ends.",
    era: 'medieval',
    region: 'Mediterranean',
    date: '29 May 1453',
  },

  // EARLY MODERN
  {
    year: 1521,
    headline: 'Tenochtitlan',
    sub: 'Cortés and his Tlaxcalan allies starve out the lake city of the Mexica. A continent passes into the Spanish account books in a single summer.',
    era: 'early-modern',
    region: 'Americas',
    date: '13 August 1521',
  },
  {
    year: 1526,
    headline: 'Mohács',
    sub: "Suleiman the Magnificent's janissaries cut down Louis II and the Hungarian nobility in an afternoon. The Ottoman tide rolls toward Vienna.",
    era: 'early-modern',
    region: 'Europe',
    date: '29 August 1526',
  },
  {
    year: 1571,
    headline: 'Lepanto',
    sub: 'The Holy League galley fleet smashes the Ottoman navy in the Gulf of Patras. The legend of Ottoman invincibility at sea dies in one afternoon of cannon smoke.',
    era: 'early-modern',
    region: 'Mediterranean',
    date: '7 October 1571',
  },
  {
    year: 1588,
    headline: 'The Armada',
    sub: 'Drake and the weather wreck the Spanish Armada in the North Sea. The Protestant succession in England is safe.',
    era: 'early-modern',
    region: 'Atlantic',
    date: 'July–August 1588',
  },
  {
    year: 1592,
    headline: 'Hansando',
    sub: 'Admiral Yi Sun-sin lures the Japanese invasion fleet into the strait and rains turtle-ship fire on it in a crane-wing formation. Korea is saved by a man who never lost a sea fight.',
    era: 'early-modern',
    region: 'Asia',
    date: '14 August 1592',
  },
  {
    year: 1600,
    headline: 'Sekigahara',
    sub: "Tokugawa Ieyasu wins Japan in an October fog. Two and a half centuries of shogunate peace begin with one defection in the rain.",
    era: 'early-modern',
    region: 'Asia',
    date: '21 October 1600',
  },
  {
    year: 1683,
    headline: 'Vienna Relieved',
    sub: 'Jan Sobieski leads the largest cavalry charge in history down the Kahlenberg into the Ottoman siege lines. The high tide of Ottoman Europe goes out and never comes back.',
    era: 'early-modern',
    region: 'Europe',
    date: '12 September 1683',
  },

  // LONG EIGHTEENTH CENTURY
  {
    year: 1757,
    headline: 'Plassey',
    sub: "Robert Clive bribes one general and beats another in a mango grove east of Calcutta. The East India Company inherits Bengal, and from Bengal, the world.",
    era: 'napoleonic',
    region: 'Asia',
    date: '23 June 1757',
  },
  {
    year: 1759,
    headline: 'Quebec',
    sub: 'Wolfe climbs the cliffs of the St Lawrence in the dark and forms his line on the Plains of Abraham at first light. France loses North America by the end of the morning.',
    era: 'napoleonic',
    region: 'Americas',
    date: '13 September 1759',
  },
  {
    year: 1776,
    headline: 'Independence',
    sub: 'A breakaway British colony declares itself a republic and goes to war for it.',
    era: 'napoleonic',
    region: 'Americas',
    date: '4 July 1776',
  },
  {
    year: 1781,
    headline: 'Yorktown',
    sub: 'A French fleet seals the bay. Washington and Rochambeau dig in. Cornwallis stacks arms to a band playing the world turned upside down.',
    era: 'napoleonic',
    region: 'Americas',
    date: '19 October 1781',
  },
  {
    year: 1805,
    headline: 'Trafalgar',
    sub: "Nelson cuts the Franco-Spanish line in two off Cape Trafalgar and dies on his quarterdeck. Britain holds the oceans for a century.",
    era: 'napoleonic',
    region: 'Atlantic',
    date: '21 October 1805',
  },
  {
    year: 1815,
    headline: 'Waterloo',
    sub: "Wellington and Blücher break Napoleon's last army south of Brussels. The Hundred Days end.",
    era: 'napoleonic',
    region: 'Europe',
    date: '18 June 1815',
    battleId: 'waterloo-1815',
  },

  // INDUSTRIAL AGE
  {
    year: 1862,
    headline: 'Antietam',
    sub: 'The bloodiest day in American history. McClellan stops Lee in Maryland and Lincoln walks out of the cabinet room with the Emancipation Proclamation in his hand.',
    era: 'industrial',
    region: 'Americas',
    date: '17 September 1862',
  },
  {
    year: 1863,
    headline: 'Gettysburg',
    sub: 'Three days on a Pennsylvania fishhook mark the high water of the Confederacy.',
    era: 'industrial',
    region: 'Americas',
    date: '1–3 July 1863',
    battleId: 'gettysburg-1863',
  },
  {
    year: 1870,
    headline: 'Sedan',
    sub: "Moltke encircles Napoleon III and a French army of 100,000 in the Ardennes. A German Empire is proclaimed in the Hall of Mirrors before the snow melts.",
    era: 'industrial',
    region: 'Europe',
    date: '1–2 September 1870',
  },
  {
    year: 1879,
    headline: 'Isandlwana',
    sub: "A Zulu impi overruns a British camp at the foot of the sphinx-rock. The empire learns that a rifle line is not invincible after all.",
    era: 'industrial',
    region: 'Africa',
    date: '22 January 1879',
  },
  {
    year: 1896,
    headline: 'Adwa',
    sub: "Menelik II's army shatters an invading Italian column in the Ethiopian highlands. An African state defeats a European empire in open battle and keeps its independence.",
    era: 'industrial',
    region: 'Africa',
    date: '1 March 1896',
  },
  {
    year: 1905,
    headline: 'Tsushima',
    sub: "Togo crosses the Russian Baltic Fleet's T in the Korea Strait and annihilates it in an afternoon. A non-European power has just sunk a great-power navy.",
    era: 'industrial',
    region: 'Asia',
    date: '27–28 May 1905',
  },

  // GREAT WAR
  {
    year: 1914,
    headline: 'The Great War',
    sub: 'A pistol shot in Sarajevo brings down four empires and ends the long European peace.',
    era: 'world-war-1',
    region: 'Europe',
    date: 'July–August 1914',
  },
  {
    year: 1915,
    headline: 'Gallipoli',
    sub: 'Allied landings on the Dardanelles peninsula bog down under Ottoman fire. Mustafa Kemal makes his name on a ridge above the Aegean, and a Turkish republic begins to exist in his head.',
    era: 'world-war-1',
    region: 'Middle East',
    date: 'April 1915 – January 1916',
  },
  {
    year: 1916,
    headline: 'Verdun',
    sub: "Falkenhayn tries to bleed France white at the gates of the city. Ten months later both sides are still bleeding and nothing has moved.",
    era: 'world-war-1',
    region: 'Europe',
    date: 'February–December 1916',
  },
  {
    year: 1916,
    headline: 'The Somme',
    sub: "Sixty thousand British casualties on the first day. Industrial war shows what it can do to a generation in a few hours.",
    era: 'world-war-1',
    region: 'Europe',
    date: '1 July 1916',
  },

  // WORLD WAR TWO
  {
    year: 1939,
    headline: 'The Second War',
    sub: 'Wehrmacht armor crosses the Polish border at dawn on the first of September.',
    era: 'world-war-2',
    region: 'Europe',
    date: '1 September 1939',
  },
  {
    year: 1942,
    headline: 'Singapore',
    sub: 'Yamashita bluffs an army twice his size into surrender. Eighty thousand British and Commonwealth troops walk into captivity. The colonial era has just ended, even if London does not yet know it.',
    era: 'world-war-2',
    region: 'Asia',
    date: '15 February 1942',
  },
  {
    year: 1942,
    headline: 'Stalingrad',
    sub: 'The 6th Army drives to the Volga. Six months later it surrenders in the basement of a department store.',
    era: 'world-war-2',
    region: 'Europe',
    date: 'August 1942 – February 1943',
    battleId: 'stalingrad-1942',
  },
  {
    year: 1942,
    headline: 'El Alamein',
    sub: "Montgomery breaks Rommel at the Egyptian railhead. The Axis tide in North Africa goes out and Churchill orders the church bells rung.",
    era: 'world-war-2',
    region: 'Africa',
    date: 'October–November 1942',
  },
  {
    year: 1943,
    headline: 'Kursk',
    sub: "The largest tank battle ever fought ends with the Wehrmacht's armored fist permanently broken. From here the Red Army does not stop until Berlin.",
    era: 'world-war-2',
    region: 'Europe',
    date: 'July–August 1943',
  },
  {
    year: 1944,
    headline: 'Normandy',
    sub: '156,000 men cross the Channel and land on five Norman beaches. The largest amphibious operation in history.',
    era: 'world-war-2',
    region: 'Europe',
    date: '6 June 1944',
    battleId: 'normandy-1944',
  },
  {
    year: 1945,
    headline: 'Iwo Jima',
    sub: 'Six men raise a flag on Suribachi. Six thousand Marines and twenty thousand Japanese are killed before the island goes quiet. The Pacific war is in its final dark act.',
    era: 'world-war-2',
    region: 'Asia',
    date: 'February–March 1945',
  },
  {
    year: 1945,
    headline: 'Berlin',
    sub: 'The Reich Chancellery flies the red flag. The European war is over.',
    era: 'world-war-2',
    region: 'Europe',
    date: '16 April – 2 May 1945',
    battleId: 'berlin-1945',
  },

  // MODERN
  {
    year: 1950,
    headline: 'Inchon',
    sub: "MacArthur lands at the worst tide-port on the peninsula and severs the North Korean army at the waist. The Korean War swings overnight, and then swings back again at the Yalu.",
    era: 'cold-war',
    region: 'Asia',
    date: '15 September 1950',
  },
  {
    year: 1954,
    headline: 'Dien Bien Phu',
    sub: 'Giap drags artillery up mountains the French believed unscalable and pounds the garrison into surrender. French Indochina ends in a valley in the north.',
    era: 'cold-war',
    region: 'Asia',
    date: '13 March – 7 May 1954',
  },
  {
    year: 1967,
    headline: 'Six Days',
    sub: 'Israeli pilots wreck three Arab air forces on the ground before breakfast. By the end of the week the map of the Middle East has been redrawn for fifty years.',
    era: 'cold-war',
    region: 'Middle East',
    date: '5–10 June 1967',
  },
  {
    year: 1968,
    headline: 'Tet',
    sub: "On the lunar new year the Viet Cong attack a hundred cities at once. The offensive is a military disaster for the North and a political catastrophe for the South.",
    era: 'cold-war',
    region: 'Asia',
    date: '30 January 1968',
  },
  {
    year: 1973,
    headline: 'Yom Kippur',
    sub: 'Egyptian armor crosses the Suez Canal on the holiest day of the Jewish calendar. The myth of Israeli invincibility cracks. Henry Kissinger flies into the rubble.',
    era: 'cold-war',
    region: 'Middle East',
    date: '6–25 October 1973',
  },
  {
    year: 1975,
    headline: 'Saigon',
    sub: "T-54s push through the gates of the presidential palace. The last American helicopter lifts from a rooftop and the longest war ends in a single photograph.",
    era: 'cold-war',
    region: 'Asia',
    date: '30 April 1975',
  },
  {
    year: 1991,
    headline: 'Desert Storm',
    sub: "A coalition of thirty-five nations ejects the Iraqi army from Kuwait in a hundred-hour ground war. Precision weapons, satellite reconnaissance, and live television. A new way of war announces itself.",
    era: 'contemporary',
    region: 'Middle East',
    date: '17 January – 28 February 1991',
  },
  {
    year: 2001,
    headline: 'Tora Bora',
    sub: 'US special operations corner al-Qaeda in the White Mountains south of Jalalabad. The strongholds fall but Osama bin Laden slips across the border into Pakistan and the war stretches into a generation.',
    era: 'contemporary',
    region: 'Asia',
    date: '30 November – 17 December 2001',
    battleId: 'tora-bora-2001',
  },
  {
    year: 2003,
    headline: 'Baghdad',
    sub: 'US armoured columns make two thunder runs into central Baghdad and the regime collapses by the second one. The conventional war ends. The insurgency that defines the next decade starts inside the same week.',
    era: 'contemporary',
    region: 'Middle East',
    date: '3–12 April 2003',
    battleId: 'baghdad-2003',
  },
  {
    year: 2017,
    headline: 'Mosul',
    sub: 'Nine months of urban warfare end the territorial caliphate. The Old City falls block by block. Drone reconnaissance, suicide drones, and improvised armour come of age in the rubble.',
    era: 'contemporary',
    region: 'Middle East',
    date: 'October 2016 – July 2017',
    battleId: 'mosul-2016-2017',
  },
  {
    year: 2022,
    headline: 'Ukraine',
    sub: 'Russian columns cross the border in the largest interstate war in Europe since 1945.',
    era: 'contemporary',
    region: 'Europe',
    date: '24 February 2022',
  },
  {
    year: 2022,
    headline: 'Hostomel',
    sub: 'A Russian airborne force lifts from Belarus on the first morning of the war and drops onto the airport twenty miles from Kyiv. Ukrainian defenders crater the runway by nightfall and the original plan to crack the capital in seventy-two hours dies on the tarmac.',
    era: 'contemporary',
    region: 'Europe',
    date: '24 February 2022',
    battleId: 'hostomel-airport-2022',
  },
  {
    year: 2022,
    headline: 'Mariupol',
    sub: 'Encircled in week one and reduced to its steelworks by week eight. The port that opened the land bridge to Crimea also made the human cost of the war visible to the world.',
    era: 'contemporary',
    region: 'Europe',
    date: '24 February – 20 May 2022',
    battleId: 'mariupol-2022',
  },
];
