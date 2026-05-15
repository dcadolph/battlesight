# Data Sources

BattleTrace uses battle data from the following sources. We are grateful to the
maintainers of these projects.

## Wikidata

- **Source:** https://www.wikidata.org
- **License:** CC0 1.0 Universal (Public Domain)
- **What we use:** Battle locations, dates, and associated conflict names queried
  via the Wikidata SPARQL endpoint. Wikidata is maintained by the Wikimedia
  Foundation and its global community of contributors.

## CDB90 (Concepts Analysis Agency Database of Battles)

- **Source:** https://github.com/jrnold/CDB90
- **Original data:** U.S. Army Concepts Analysis Agency, "Database of Battles,
  Version 1990" (CAA-RP-90-7)
- **Compiled by:** Jeffrey B. Arnold
- **License:** Public domain (U.S. Government work)
- **What we use:** Battle metadata for conflicts from 1600 to 1973 including
  force sizes, casualties, and outcomes.

## Curated Dataset

- **Source:** Hand-curated by the BattleTrace maintainers
- **What it covers:** 29 landmark battles from Marathon (490 BC) through
  73 Easting (1991) with detailed summaries, significance, and references
  to published books and films.
- **References:** All book and film citations refer to real, published works.
  See `data/references.json` for the full list.
