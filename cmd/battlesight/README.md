<p align="center">
  <img src="../../internal/logo/battlesight.png" alt="BattleSight" width="200" />
</p>

<h1 align="center">battlesight</h1>

<p align="center"><em>HTTP API + curated content server for the BattleSight world atlas of human conflict.</em></p>

---

> **⚠ Before you start:** the server reads from a SQLite database at
> `data/battlesight.db`. If the file is empty or missing, the server
> seeds it from `data/battles.json` on first boot. For a full historical
> catalog, run `make import` first (full Wikidata pull, ~10 minutes).

## Quick Start

```bash
make run                       # default: :8080, data/battlesight.db
go run ./cmd/battlesight       # equivalent direct invocation
```

Hit `http://localhost:8080/api/battles/stats` to verify the API is up.

## Commands Overview

`battlesight` is a single long-running HTTP server — there are no
subcommands. Configuration is via flags and environment variables.

| Resource | Path | Purpose |
| --- | --- | --- |
| Stats | `GET /api/battles/stats` | Era / war / battle-type counts; war list with rolled totals. |
| Battles | `GET /api/battles` | Paginated battle list with filters. |
| Battle | `GET /api/battles/{id}` | Single battle dossier. |
| Replay | `GET /api/battles/{id}/replay` | Phase replay JSON. |
| Search | `GET /api/battles/search` | Full-text search. |
| War summary | `GET /api/wars/{name}/summary` | Computed + curated war card. |
| Health | `GET /api/health` | Liveness probe (returns `{"status":"ok"}`). |

Full schema in [docs/api.md](../../docs/api.md).

## Global Flags

| Flag | Type | Default | Meaning |
| --- | --- | --- | --- |
| `-port` | int | `8080` | TCP port the HTTP server binds to. |
| `-db` | string | `data/battlesight.db` | Path to the SQLite catalog. Created if missing. WAL mode is enabled at first open. |
| `-seed` | string | `data/battles.json` | JSON file to seed the database from when it's empty. Pass `""` to skip seeding. |
| `-phases` | string | `data/phases.json` | Hand-crafted phase replays. Watched for changes (1s poll). Pass `""` to disable replays. |
| `-wars` | string | `data/wars.json` | Curated war narratives + casualty totals + hierarchy. Watched for changes (1s poll). Pass `""` to disable. |

## Environment Variables

All flags can be set via environment variables using the `BATTLESIGHT_`
prefix. Dashes become underscores.

| Variable | Equivalent flag |
| --- | --- |
| `BATTLESIGHT_PORT` | `-port` |
| `BATTLESIGHT_DB` | `-db` |
| `BATTLESIGHT_SEED` | `-seed` |
| `BATTLESIGHT_PHASES` | `-phases` |
| `BATTLESIGHT_WARS` | `-wars` |

Flag values take precedence over environment values.

## Hot-reload

`data/phases.json` and `data/wars.json` are polled for changes once per
second while the server is running. When the mtime advances, the file is
re-parsed and the in-memory registry is swapped under a write lock.
Curators can edit, save, and reload the browser to see changes without
restarting.

Schema validation runs on every reload. Parse errors are logged but do
not crash the server — the previous valid version stays loaded.

## Health

```bash
curl -fsS http://localhost:8080/api/health
# {"status":"ok"}
```

The endpoint is intentionally cheap: it doesn't touch the database.
For a real "is the catalog loaded" check, use `/api/battles/stats` and
verify `totalBattles > 0`.

## Output

All responses are JSON. CORS is permissive for `localhost` development.
Errors return a JSON body with a `message` field and the appropriate
HTTP status:

```jsonc
{ "message": "battle not found" }
```

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Graceful shutdown (SIGINT / SIGTERM). |
| `1` | Failed to open or migrate the SQLite database. |
| `2` | Failed to load `phases.json` or `wars.json` and they were declared required. |
| `3` | Port already in use or bind failed. |

## FAQ

<details>
<summary>The server logs say "loaded 0 battle replays" — why?</summary>

`data/phases.json` is missing, empty, or in the wrong path. Pass
`-phases /path/to/phases.json` or place the file at the default location.
The server runs fine without replays; only the cinematic and the
"Watch the battle" affordance go quiet.
</details>

<details>
<summary>I edited phases.json and the change didn't appear. Why?</summary>

Two reasons. (a) The hot-reload poller only sees changes the filesystem
reports — some editors write to a temp file and rename atomically. Try
saving directly to the file. (b) Schema parse failed and the previous
version stayed loaded; check the server log for `wars hot-reload failed`
or `phases hot-reload failed`.
</details>

<details>
<summary>How do I run the API on a different port?</summary>

`-port 9090` or `BATTLESIGHT_PORT=9090`. The frontend's Vite proxy
points at `:8080` by default — change `web/vite.config.ts` to match if
you move the backend.
</details>

<details>
<summary>Where is the data actually stored?</summary>

SQLite at `data/battlesight.db` plus the JSON sidecars (`phases.json`,
`wars.json`, `territory-snapshots.ts`). The SQLite file is gitignored;
the JSON files are checked in.
</details>
