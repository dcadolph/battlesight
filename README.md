<p align="center">
  <img src="internal/logo/battlesight.png" alt="BattleSight" width="320" />
</p>

# BattleSight

A world atlas of human conflict. About 12,000 battles from 3000 BC to
today on a 3D globe, with 121 hand-crafted phase replays of the iconic
ones and an auto-stepping war cinematic mode that walks you through any
conflict end to end.

## Quickstart

Requirements: Go 1.26+, Node 20+.

```bash
make run            # API on :8080
make web            # UI on :5173 (run in a second terminal)
```

Open http://localhost:5173. `make help` lists every target including
`import` (full Wikidata pull) and `test`.

## Docs

- [HTTP API](docs/api.md)
- [URL hash and keyboard shortcuts](docs/usage.md)
- [Data quality and trust tiers](docs/data-quality.md)
- [Data sources and licenses](DATA_SOURCES.md)
