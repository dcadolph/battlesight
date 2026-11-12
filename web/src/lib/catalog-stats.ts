// NameCount pairs a label with its battle count.
export interface NameCount {
  name: string;
  count: number;
}

// WarCount is one war row of the stats payload.
export interface WarCount {
  name: string;
  count: number;
  minYear: number;
  casualties: number;
  // humanDeaths is the curated point-estimate including civilians, famine,
  // genocide, and disease. Zero when the war has no curated override.
  // Preferred over casualties for display when present. An estimate,
  // never a count.
  humanDeaths?: number;
  // deathsLow / deathsHigh bound the published range of death estimates;
  // when present the list renders the range instead of one figure.
  deathsLow?: number;
  deathsHigh?: number;
  // deathsNote states what the death figure includes.
  deathsNote?: string;
  // deathsSource attributes the death figure itself.
  deathsSource?: string;
  parent?: string;
  rolledCount: number;
  rolledCasualties: number;
  // rolledHumanDeaths is the curated-first total summed across the war and
  // every descendant theater / campaign, falling back to descendant battle
  // sums where no curated number exists. Zero when nothing rolled up.
  rolledHumanDeaths?: number;
  // rolledDeathsBasis is the provenance class of rolledHumanDeaths:
  // "curated", "battle-sum", or "mixed" when the roll-up added figures of
  // differing provenance. Mixed totals are starred in the list.
  rolledDeathsBasis?: string;
  countries?: string[];
}

// CatalogStats is the /api/battles/stats payload.
export interface CatalogStats {
  totalBattles: number;
  verifiedBattles: number;
  documentedBattles: number;
  indexedBattles: number;
  replayCount: number;
  yearRange: [number, number];
  eras: NameCount[];
  wars: WarCount[];
  battleTypes: NameCount[];
}

// pending holds the one in-flight or settled stats request for the page.
let pending: Promise<CatalogStats> | null = null;

// loadCatalogStats fetches the catalog stats once per page and shares the
// result with every caller. A failed request is forgotten so the next caller
// tries again.
export function loadCatalogStats(): Promise<CatalogStats> {
  if (!pending) {
    pending = fetch('/api/battles/stats')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CatalogStats>;
      })
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}
