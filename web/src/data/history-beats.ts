// Curated set of historical beats anchoring the "Play history" sweep. When
// the year playhead crosses one of these years, the sweep pauses briefly and
// flashes a title card. The list is intentionally short so the 90-second
// sweep still feels like a sweep, not a slideshow.
//
// Picked for narrative anchoring, not exhaustiveness. Coverage spans every
// era so each region of the timeline gets a moment of context. Anchored to
// the canonical English year for the event.

export interface HistoryBeat {
  // year is the calendar year the beat fires on, negative for BC.
  year: number;
  // headline is the punch line, set in the era display font on the card.
  headline: string;
  // sub is one sentence of dossier context.
  sub: string;
  // era is the era key (matches ERA_LABELS keys) so the card themes itself.
  era: string;
  // battleId optionally links the beat to a specific battle entry so the
  // user can jump into it after the card. Not all beats are battles.
  battleId?: string;
}

export const HISTORY_BEATS: HistoryBeat[] = [
  {
    year: -490,
    headline: 'Marathon',
    sub: 'The Athenian phalanx halts the Persian landing on the plain of Marathon.',
    era: 'ancient',
    battleId: 'marathon-490bc',
  },
  {
    year: -216,
    headline: 'Cannae',
    sub: "Hannibal annihilates a Roman army of 86,000 with a double envelopment that every general since has tried to imitate.",
    era: 'ancient',
    battleId: 'cannae-216bc',
  },
  {
    year: 410,
    headline: 'Rome Sacked',
    sub: 'Alaric and the Visigoths breach the Aurelian Walls. The first time the city has fallen in eight centuries.',
    era: 'medieval',
  },
  {
    year: 1066,
    headline: 'Hastings',
    sub: 'William of Normandy kills Harold at the foot of Senlac Hill and takes the English throne.',
    era: 'medieval',
    battleId: 'hastings-1066',
  },
  {
    year: 1453,
    headline: 'Constantinople',
    sub: "The Theodosian Walls fall to Mehmed II's bombards after 53 days. The Roman Empire ends.",
    era: 'medieval',
  },
  {
    year: 1588,
    headline: 'The Armada',
    sub: 'Drake and the weather wreck the Spanish Armada in the North Sea. The Protestant succession in England is safe.',
    era: 'early-modern',
  },
  {
    year: 1776,
    headline: 'Independence',
    sub: 'A breakaway British colony declares itself a republic and goes to war for it.',
    era: 'early-modern',
  },
  {
    year: 1815,
    headline: 'Waterloo',
    sub: "Wellington and Blücher break Napoleon's last army south of Brussels. The Hundred Days end.",
    era: 'napoleonic',
    battleId: 'waterloo-1815',
  },
  {
    year: 1863,
    headline: 'Gettysburg',
    sub: 'Three days on a Pennsylvania fishhook mark the high water of the Confederacy.',
    era: 'industrial',
    battleId: 'gettysburg-1863',
  },
  {
    year: 1914,
    headline: 'The Great War',
    sub: 'A pistol shot in Sarajevo brings down four empires and ends the long European peace.',
    era: 'world-war-1',
  },
  {
    year: 1939,
    headline: 'The Second War',
    sub: 'Wehrmacht armor crosses the Polish border at dawn on the first of September.',
    era: 'world-war-2',
  },
  {
    year: 1942,
    headline: 'Stalingrad',
    sub: 'The 6th Army drives to the Volga. Six months later it surrenders in the basement of a department store.',
    era: 'world-war-2',
    battleId: 'stalingrad-1942',
  },
  {
    year: 1944,
    headline: 'Normandy',
    sub: '156,000 men cross the Channel and land on five Norman beaches. The largest amphibious operation in history.',
    era: 'world-war-2',
    battleId: 'normandy-1944',
  },
  {
    year: 1945,
    headline: 'Berlin',
    sub: 'The Reich Chancellery flies the red flag. The European war is over.',
    era: 'world-war-2',
    battleId: 'berlin-1945',
  },
  {
    year: 2022,
    headline: 'Ukraine',
    sub: 'Russian columns cross the border in the largest interstate war in Europe since 1945.',
    era: 'modern',
  },
];
