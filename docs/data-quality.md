# Data quality

BattleSight runs three tiers of trust. The badge in the UI tells you
which one you're looking at.

| Tier&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Source | What to trust |
|---|---|---|
| Reconstructed&nbsp;&nbsp; | Hand-built phase replay + curated dossier | Narration, sides, outcome, references. Treat as primary. |
| Documented&nbsp;&nbsp;&nbsp;&nbsp; | Curated JSON or Wikipedia infobox enrichment | Sides, war, casualty estimate, coordinates. Read the sources. |
| Indexed&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | Wikidata pointer only | A starting point. Follow the Wikipedia link. |

The default filter is **Documented and above**. The Reconstructed
filter shrinks the dataset to battles with a hand-built phase replay
(currently 121). The Indexed filter exposes the sparser Wikidata
pointers for completeness.

## Heuristics that may go wrong

- **Casualties.** The parser picks a representative number from freeform
  Wikipedia strings. "50,000 killed/wounded" becomes 50000. A range like
  "15,000-20,000" becomes 17500. The parser is conservative about
  overflow and unit confusion but it is not a substitute for primary
  sources. Trust the number you can read in the references on the
  battle's panel.
- **War attribution.** Auto-imported records inherit their war from the
  Wikipedia template tree. Some Wikipedia articles use ambiguous
  templates. The Documented filter excludes records whose war metadata
  failed validation.
- **Coordinates.** Pulled from Wikipedia GeoData or Wikidata P625.
  Accuracy varies. Battles in the ocean with no clear shore point are
  filtered out by the importer.
- **Dates.** ISO placeholders like `YYYY-01-01` or `YYYY-12-31` are
  treated as year-only. The UI shows just the year in that case.

## Spotting an indexed record

If the battle panel says "indexed" in the tier badge, the only fields
you can trust are name, year, coordinates, and the Wikipedia link.
Everything else is a parse from text. Cross-reference before quoting.
