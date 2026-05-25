"""Wikipedia backfill for battles with no summary/victor/significance.

Uses the action API with 50-title batches and conservative pacing so we
don't get rate-limited. Pulls intro extract as summary text. Idempotent.
"""
import sqlite3
import urllib.parse
import urllib.request
import json
import time

DB = '/Users/douglasadolph/src/dcadolph/battlesight/data/battlesight.db'
UA = 'BattleSight/1.0 (history visualization; https://github.com/dcadolph/battlesight)'
ACTION = 'https://en.wikipedia.org/w/api.php'
BATCH = 50  # action API maximum is 50 for anonymous clients
SLEEP_S = 1.2  # ~40 titles/s effective; well under any rate limit


def title_for(row) -> str | None:
    bid, name, year, war, wiki_title = row
    if wiki_title:
        return wiki_title
    if not name:
        return None
    return name


def fetch_batch(titles: list[str]) -> dict[str, str]:
    params = {
        'action': 'query',
        'prop': 'extracts',
        'exintro': '1',
        'explaintext': '1',
        'redirects': '1',
        'titles': '|'.join(titles),
        'format': 'json',
        'formatversion': '2',
    }
    qs = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        f'{ACTION}?{qs}',
        headers={'User-Agent': UA, 'Accept': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read())
    except Exception as e:
        print(f'  batch error: {e}', flush=True)
        return {}
    out: dict[str, str] = {}
    # The action API includes a `normalized` map (input title -> canonical)
    # and `redirects` map (canonical -> redirect target). Walk both so we
    # can look up the original input title.
    normalized = {n['from']: n['to'] for n in payload.get('query', {}).get('normalized', [])}
    redirects = {r['from']: r['to'] for r in payload.get('query', {}).get('redirects', [])}
    pages = payload.get('query', {}).get('pages', [])
    title_to_extract: dict[str, str] = {}
    for p in pages:
        if p.get('missing') or p.get('invalid'):
            continue
        t = p.get('title', '')
        e = (p.get('extract') or '').strip()
        if t and e:
            title_to_extract[t] = e
    for orig in titles:
        # Walk: orig -> normalized -> redirect -> page
        t = normalized.get(orig, orig)
        t = redirects.get(t, t)
        if t in title_to_extract:
            out[orig] = title_to_extract[t]
    return out


def main():
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("""
        SELECT id, name, year, war, wikipedia_title
        FROM battles
        WHERE victor = '' AND significance = '' AND summary = ''
    """)
    rows = cur.fetchall()
    print(f'blank battles: {len(rows)}', flush=True)

    work = []  # (id, title)
    for row in rows:
        title = title_for(row)
        if not title:
            continue
        work.append((row[0], title))

    print(f'with title: {len(work)}', flush=True)
    if not work:
        return

    filled = 0
    missing = 0
    start = time.time()

    for batch_start in range(0, len(work), BATCH):
        chunk = work[batch_start:batch_start + BATCH]
        ids_by_title: dict[str, list[str]] = {}
        for bid, title in chunk:
            ids_by_title.setdefault(title, []).append(bid)
        titles = list(ids_by_title.keys())
        result = fetch_batch(titles)
        for title, extract in result.items():
            for bid in ids_by_title[title]:
                cur.execute(
                    "UPDATE battles SET summary = ?, wikipedia_title = ? WHERE id = ?",
                    (extract, title, bid),
                )
                filled += 1
        for title in titles:
            if title not in result:
                missing += len(ids_by_title[title])
        con.commit()
        done = batch_start + len(chunk)
        elapsed = time.time() - start
        rate = done / elapsed if elapsed > 0 else 0
        eta = (len(work) - done) / rate if rate > 0 else 0
        print(
            f'  {done}/{len(work)}  filled={filled}  missing={missing}  '
            f'{rate:.1f} t/s  eta={eta:.0f}s',
            flush=True,
        )
        time.sleep(SLEEP_S)

    con.close()
    print(f'done: filled={filled}  missing={missing}', flush=True)


if __name__ == '__main__':
    main()
