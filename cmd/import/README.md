<p align="center">
  <img src="../../internal/logo/battlesight.png" alt="BattleSight" width="200" />
</p>

<h1 align="center">battlesight-import</h1>

<p align="center"><em>Catalog ingestion + enrichment pipeline. Pulls battles from Wikidata, fills metadata from Wikipedia, validates curated JSON, and writes everything into the SQLite catalog the API server reads from.</em></p>

---

> **⚠ Before you start:** the importer hits Wikidata's public SPARQL
> endpoint and Wikipedia's REST API. A full pull is ~10-15 minutes the
> first time and uses ~80 MB of disk cache in `data/.wikicache/`.
> Subsequent runs are fast because of the cache; pass `-network=false`
> to refuse new network calls entirely.

## Quick Start

```bash
# Full pull + every enrichment stage, into the default DB:
go run ./cmd/import -all

# Just re-run infobox enrichment for battles already in the catalog:
go run ./cmd/import -infobox

# Validate the curated JSON sidecars without writing to the DB:
go run ./cmd/import -validate
```

## Pipeline Stages

The importer is a pipeline of independent stages. Each stage idempotently
updates the rows it owns. You can run a single stage or chain them with
`-all`.

| Stage | Flag | What it does |
| --- | --- | --- |
| Wikidata pull | `-wikidata` | SPARQL query for all entities of type `military operation` with coordinates. Inserts/updates `battles` rows. |
| Wikipedia enrichment | `-enrich` | Fetches REST API summary for each battle. Populates `wikipedia_title`, `wikipedia_extract`. |
| Infobox parse | `-infobox` | Pulls the Wikipedia article wikitext, parses the `{{Infobox military conflict}}` template, populates `sides`, `commanders`, `casualties`, `strength`. |
| Significance | `-significance` | Mines the "Aftermath" / "Legacy" sections for prose; stores in `significance` column. |
| References | `-references` | Extracts citation URLs into `battle_references` (one row per source). |
| Wars enrichment | `-wars` | For every war with ≥3 battles, fetches a Wikipedia summary and writes `outcome` / `aftermath` / `keyTerms` into `data/wars.json`. |
| Curated JSON seed | `-json <path>` | Insert/update from a hand-curated JSON file. Used for editorial overrides. |
| Validate only | `-validate` | Parses every curated file (phases.json, wars.json, territory snapshots) and exits non-zero on any error. CI uses this. |

The `-all` flag chains: `-wikidata -enrich -infobox -significance -references -wars`.

## Global Flags

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `-db` | string | `data/battlesight.db` | Path to the SQLite catalog. Created if missing. |
| `-json` | string | `""` | Optional curated battles JSON file to merge in. |
| `-wars-file` | string | `data/wars.json` | Output path for `-wars` enrichment. |
| `-network` | bool | `true` | Allow Wikipedia/Wikidata HTTP calls. Set `=false` to use only the on-disk cache. |
| `-all` | bool | `false` | Run all import and enrichment steps. |
| `-validate` | bool | `false` | Validate curated JSON without writing to the DB. Mutually exclusive with all other stages. |

## Per-Command Flags

| Flag | Type | Meaning |
| --- | --- | --- |
| `-wikidata` | bool | Run the Wikidata SPARQL pull stage. |
| `-enrich` | bool | Run the Wikipedia summary enrichment stage. |
| `-infobox` | bool | Run the Wikipedia infobox parse stage. |
| `-significance` | bool | Run the significance / aftermath text mining stage. |
| `-references` | bool | Run the citation extraction stage. |
| `-wars` | bool | Run the wars.json enrichment stage. |

## Cache

The Wikipedia/Wikidata cache lives at `data/.wikicache/`. Each upstream
response is keyed by URL and stored verbatim. The cache is the reason
re-running the importer is fast — and it's gitignored, so don't worry
about size locally. Delete the directory to force a full re-fetch.

## Output

Each stage logs a one-line summary on completion:

```
2026/05/19 17:42:01 wikidata: pulled 13,218 battles, 226 verified
2026/05/19 17:42:38 wikipedia: enriched 11,841 battles (1,377 already had summaries)
2026/05/19 17:44:12 infobox: parsed 9,408 sides, 6,221 commanders, 5,113 casualty strings
2026/05/19 17:45:01 wars: enriched 312 wars in data/wars.json
```

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | Database open / migration failure. |
| `2` | Validation failed (`-validate` mode). |
| `3` | Network refused or unreachable and no cache hit (`-network=false` with empty cache). |
| `4` | Curated JSON parse error. |

## FAQ

<details>
<summary>How fresh is the Wikidata pull?</summary>

Wikidata is updated continuously by editors. The SPARQL query runs
against the live endpoint so the snapshot is current at run time. Cache
the result if you need reproducibility — the on-disk cache makes
subsequent runs deterministic until the cache is cleared.
</details>

<details>
<summary>I see "broken sides" in the catalog — what are those?</summary>

When the Wikipedia infobox parser can't fully resolve a template
parameter (`|combatant2 = {{flagicon|...}} ...`), it leaves a fragment
of wikitext in the `sides` row. The cleansing pass at server boot
flags these as "broken" and they're hidden from the cinematic. Run
`go run ./cmd/quality` to see the count.
</details>

<details>
<summary>Can I import only a specific war?</summary>

Not yet via the CLI. The Wikidata query pulls everything by design so
the catalog stays globally consistent. If you want a one-war import,
edit `internal/importer/wikidata.go`'s query and add a `FILTER` clause
on `?conflict`.
</details>
