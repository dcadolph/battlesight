# FAQ

The questions that come up most often, with honest answers.

## Data

<details>
<summary>How many battles are in the catalog?</summary>

About 13,200, imported from Wikidata (every entity tagged as a military
operation with coordinates). Of those, ~226 are hand-verified and ~143
have hand-crafted phase replays. The rest are imported stubs of varying
metadata quality.
</details>

<details>
<summary>Why are some battles obviously mistagged?</summary>

The Wikidata import uses the `P607 conflict` property to assign each
battle to a war. That property is editor-maintained and noisy. Battles
like the Yeonpyeong incidents (1999-2010) end up tagged "Korean War"
because Wikidata says so. We run an audit pass that strips obvious
year-outliers from their war assignment, but it doesn't catch
everything.

The path to "perfect" is hand-curation of the top wars. See
[Quality tiers](data-quality.md).
</details>

<details>
<summary>Why do casualty totals on the war card sometimes seem wildly different from Wikipedia?</summary>

Three numbers can be in play:

- `casualties` — sum of every battle's parsed casualty string. Often
  undercounts (civilians, famine, genocide aren't in battle records).
- `humanDeaths` — curator-authored total including civilians. This is
  what the war card shows when present.
- Wikipedia's prose total — what you usually see when you search.

When the curated `humanDeaths` is set, that's the displayed number.
Wikipedia's number is usually within the same ballpark. When
`humanDeaths` isn't set, the battle-sum is shown — and that can be
way smaller than reality.
</details>

<details>
<summary>How current is the catalog?</summary>

Wikidata is live — the snapshot is current at import time. Re-run
`go run ./cmd/import -all` to refresh. Most curated narratives are
manually updated; check `data/wars.json` git history.
</details>

## Cinematic

<details>
<summary>I picked a war and got 3 battles. Where's the rest?</summary>

The cinematic plays only hand-crafted phase replays (S-tier). For
under-covered wars, that filter strips most of the catalog. Browse via
the dossier instead, or contribute a phase replay (see
[authoring.md](authoring.md)).
</details>

<details>
<summary>Cinematic froze on a battle. Now what?</summary>

Manual Next / Previous buttons sit on every cinematic outro card; tap
Next to push forward. The freeze is usually a paused inner replay that
the war timer can't recover from. If you can reproduce it, file an
issue with the war name and battle name.
</details>

<details>
<summary>Why does the globe shading sometimes flicker between battles?</summary>

Most likely it doesn't anymore — there's a snapshot dedupe that stops
the polygon transition from restarting when two consecutive battles
share the same snapshot window. If you still see flicker, it means
two battles in the same year are in different snapshots; the curator
needs to add a snapshot at the right calendar boundary.
</details>

<details>
<summary>Why is Wehrmacht shaded olive-green (feldgrau) on the territory map but black on the arrows?</summary>

Different layers, different purposes. Territory shading reads at the
campaign scale — feldgrau is the Wehrmacht's actual uniform color and
distinguishes German-held territory from Soviet red on the same map.
Arrows read at the tactical scale — SS-black is iconic and pairs
cleanly with Allied colors.
</details>

## Visuals

<details>
<summary>Why are arrows sometimes just a chevron with nothing behind them?</summary>

Long campaign paths (Barbarossa, Bagration) can leave gaps in the
dashed march layer. There's now a thin solid spine under the marching
dashes that's always visible. If the spine isn't showing, your browser
might have dropped the trace animation — try a hard refresh.
</details>

<details>
<summary>Why does the cinematic never advance to the next battle?</summary>

See "Cinematic froze" above. If the manual Next button is also dead,
something's broken — file an issue.
</details>

<details>
<summary>The arrowhead and the line look mismatched in size — bug?</summary>

The chevron arrowhead scales with stroke width but the relationship
isn't 1:1 by design. The chevron should always look "weighty" enough
to convey direction at a glance, even on thin retreat arrows.
</details>

## Authoring

<details>
<summary>How do I add a new battle to the catalog?</summary>

For a battle that already exists on Wikidata, just re-run
`go run ./cmd/import -all`. For a battle that doesn't, add it to the
curated JSON seed and run with `-json`. See
[authoring.md](authoring.md).
</details>

<details>
<summary>How do I author a phase replay?</summary>

Edit `data/phases.json`, add an entry keyed by battle slug, save. The
server hot-reloads within 1s. Schema in [authoring.md](authoring.md).
</details>

<details>
<summary>How do I curate a war's human-deaths total?</summary>

Edit `data/wars.json`, add `"humanDeaths": <number>` to the war's
entry. Save. Server reloads. The war card updates on next render.
</details>

## Operating

<details>
<summary>The server failed to start with "database is locked." What now?</summary>

Probably another process is holding the SQLite file. `lsof data/battlesight.db`
will tell you. Kill the holder, restart.
</details>

<details>
<summary>How do I run on a different port?</summary>

`-port 9090` or `BATTLESIGHT_PORT=9090`. The Vite dev server's API
proxy points at `:8080` by default; update `web/vite.config.ts` to
match.
</details>

<details>
<summary>Can I deploy this as a static site?</summary>

The frontend builds to a static bundle (`make web-build`), but the
backend is a long-running HTTP server with a SQLite database. Deploy
the binary anywhere Go runs; serve the static bundle from any web
host pointed at the API.
</details>
