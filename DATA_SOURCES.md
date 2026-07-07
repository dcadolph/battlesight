# Data Sources and Credits

BattleSight stands on the shoulders of open knowledge, open mapping, and open
source. Every record in the system is traceable to one of the sources below.
We are grateful to the maintainers, contributors, and donors of each.

If you reuse BattleSight's data, preserve the attribution and licensing of the
underlying sources. The combined database is not redistributed as a single
licensed work. Each row inherits the license of the source it came from.

---

## Battle data

### Wikidata

- **Source:** https://www.wikidata.org
- **License:** [CC0 1.0 Universal (Public Domain Dedication)](https://creativecommons.org/publicdomain/zero/1.0/)
- **What we use:** Battle list, coordinates (`wdt:P625`), point-in-time
  dates (`wdt:P585`), start and end dates (`wdt:P580` / `wdt:P582`), parent
  conflict (`wdt:P607`), and links to the English Wikipedia article. Queried
  via the public SPARQL endpoint at `https://query.wikidata.org/sparql`.
- **Coverage in BattleSight:** Approximately 12,000 records form the bulk
  dataset. About 8,400 have usable coordinates and appear on the globe.
- **Attribution:** Wikidata is maintained by the Wikimedia Foundation and its
  global community of editors.

### Wikipedia (English)

- **Source:** https://en.wikipedia.org
- **License:** Article text and infobox content are dual-licensed under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and
  the [GNU Free Documentation License](https://www.gnu.org/licenses/fdl-1.3.html).
  GeoData coordinates are exported separately and are effectively in the
  same content pool.
- **What we use:** Article infoboxes parsed into structured fields. Sides,
  commanders, strength, casualties, victor, parent conflict, location, date.
  Coordinates pulled either from the GeoData API (`prop=coordinates`) or by
  regex from the `{{coord}}` template in the article wikitext.
- **Attribution:** Each enriched battle preserves a `wikipediaTitle` field
  that points to the source article. The Wikipedia button in the battle
  panel deep-links back so a reader can verify any number themselves.
- **Notice:** Wikipedia is written by volunteers. Treat any single infobox
  number as a hypothesis, not a verdict. BattleSight's tier system marks
  Wikipedia-derived records as **Documented**, not **Reconstructed**.

### CDB90. Concepts Analysis Agency Database of Battles

- **Compiled by:** Jeffrey B. Arnold, https://github.com/jrnold/CDB90
- **Underlying data:** U.S. Army Concepts Analysis Agency, "Database of
  Battles, Version 1990" (CAA-RP-90-7)
- **License:** Public domain (U.S. Government work)
- **What we use:** Battle metadata for conflicts from 1600 to 1973
  including force sizes, casualties, and outcomes where available.

### Curated dataset (project authors)

- **What it covers:** 95 hand-verified battles from Marathon (490 BC) through
  Second Fallujah (2004), with sides, commanders, strength, casualties,
  victor, summary, significance, and Wikipedia title. Authored from
  general-purpose scholarly references.
- **Source-of-truth file:** `data/battles.json` is the canonical record;
  the JSON importer uses UPSERT so corrections in the JSON propagate to the
  database on every import run.
- **References (books, films, documentaries):** Each curated battle may
  list further reading and watching in `data/references.json`. Every entry
  is a real, published work. These citations are descriptive metadata
  about the published work and do not redistribute the work itself.

### Phase replays (project authors)

- **What it covers:** 41 hand-crafted phase-by-phase tactical reenactments
  in `data/phases.json`. Each replay is a sequence of 4-6 named phases with
  narration, time markers, terrain features, unit positions, and animated
  movement arrows.
- **Sourcing:** Narration is written from standard scholarly accounts of
  each battle. Positions on the tactical map are schematic, not surveyed.
  The goal is to convey shape and pacing, not survey-grade geography.
- **License:** The phase replay text and structure are original work by the
  BattleSight authors. The underlying historical facts are not copyrightable.

---

## Cartography and rendering

### world-atlas (Mike Bostock)

- **Source:** https://github.com/topojson/world-atlas
- **License:** [ISC License](https://opensource.org/licenses/ISC)
- **What we use:** 110-meter TopoJSON country polygons (`countries-110m.json`)
  for the country overlay layer on the globe.

### NASA Blue Marble

- **Source:** https://visibleearth.nasa.gov (via the three-globe sample assets)
- **License:** Public domain. NASA imagery is not subject to copyright
  protection.
- **What we use:** Earth surface texture rendered on the globe sphere
  (`earth-blue-marble.jpg`).

### three-globe night sky

- **Source:** https://github.com/vasturiano/three-globe (`example/img/night-sky.png`)
- **License:** MIT (the wrapper). The image itself is public domain stellar
  imagery from various NASA/ESA sources.
- **What we use:** Background star field behind the globe.

---

## Third-party libraries

### Front end

- **React**. https://react.dev. MIT
- **react-globe.gl**. https://github.com/vasturiano/react-globe.gl. MIT
- **three.js**. https://threejs.org. MIT
- **three-globe**. https://github.com/vasturiano/three-globe. MIT
- **Tailwind CSS**. https://tailwindcss.com. MIT
- **Vite**. https://vitejs.dev. MIT

### Back end

- **modernc.org/sqlite**. https://gitlab.com/cznic/sqlite. BSD-3-Clause.
  Pure-Go SQLite port. Ships without CGO so the binary is portable.
- **google/go-cmp**. https://github.com/google/go-cmp. BSD-3-Clause. Used
  in tests for structured comparisons.

---

## How to credit BattleSight in turn

If you use BattleSight's data or screenshots:

- Cite the underlying source (Wikipedia, Wikidata, CDB90) for any specific
  number you reproduce. Those are the authoritative records.
- A link back to the project is welcome but not required.

If you fork the curated set, please retain `DATA_SOURCES.md` and preserve the
attribution chain for any record whose origin is downstream of a CC-licensed
source.
