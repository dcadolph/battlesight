"""Wikidata supplement: list battles Wikidata knows about that we don't.

Queries the Wikidata SPARQL endpoint for every entity whose instance-of
chain includes Q178561 (battle) with its key properties: label, time,
conflict, coordinates, English Wikipedia article title. Compares to the
local DB on wikipedia_title and approximate (name, year) match. Writes
the gap to a CSV the user can review before bulk import.

Idempotent. Read-only against the DB; writes to data/wikidata-gap.csv.
"""
import csv
import sqlite3
import time
import sys

import requests

DB = '/Users/douglasadolph/src/dcadolph/battlesight/data/battlesight.db'
OUT = '/Users/douglasadolph/src/dcadolph/battlesight/data/wikidata-gap.csv'
ENDPOINT = 'https://query.wikidata.org/sparql'
UA = 'BattleSight/1.0 (history visualization; https://github.com/dcadolph/battlesight)'

# Walk all subclasses of battle (Q178561). Includes naval battles,
# pitched battles, sieges, skirmishes, etc. Page through with LIMIT/OFFSET.
SPARQL = """
SELECT ?battle ?battleLabel ?point_in_time ?conflictLabel ?coord ?article WHERE {
  ?battle wdt:P31/wdt:P279* wd:Q178561 .
  OPTIONAL { ?battle wdt:P585 ?point_in_time . }
  OPTIONAL { ?battle wdt:P607 ?conflict . }
  OPTIONAL { ?conflict rdfs:label ?conflictLabel . FILTER(LANG(?conflictLabel) = "en") }
  OPTIONAL { ?battle wdt:P625 ?coord . }
  OPTIONAL {
    ?article schema:about ?battle ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ?battle
LIMIT %d OFFSET %d
"""


def run_query(limit: int, offset: int):
    session = requests.Session()
    params = {'query': SPARQL % (limit, offset), 'format': 'json'}
    r = session.get(ENDPOINT, params=params, headers={'User-Agent': UA, 'Accept': 'application/json'}, timeout=120)
    r.raise_for_status()
    data = r.json()
    return data.get('results', {}).get('bindings', [])


def normalize_title(url: str) -> str:
    if not url:
        return ''
    if url.startswith('https://en.wikipedia.org/wiki/'):
        slug = url[len('https://en.wikipedia.org/wiki/'):]
        from urllib.parse import unquote
        return unquote(slug).replace('_', ' ')
    return ''


def load_known_titles() -> set[str]:
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("SELECT LOWER(wikipedia_title) FROM battles WHERE wikipedia_title != ''")
    known = {r[0] for r in cur.fetchall()}
    cur.execute("SELECT LOWER(name) FROM battles")
    for (n,) in cur.fetchall():
        known.add(n)
    con.close()
    return known


def main():
    known = load_known_titles()
    print(f'known titles in DB: {len(known)}', flush=True)
    out_rows = []
    seen_qids: set[str] = set()
    offset = 0
    page = 500  # smaller pages; SPARQL endpoint times out at 5000
    while True:
        try:
            results = run_query(page, offset)
        except Exception as e:
            print(f'query error at offset {offset}: {e}', flush=True)
            # Try once more after a longer wait
            time.sleep(5)
            try:
                results = run_query(page, offset)
            except Exception as e2:
                print(f'second error at offset {offset}: {e2}', flush=True)
                break
        if not results:
            break
        for row in results:
            qid = row.get('battle', {}).get('value', '').rsplit('/', 1)[-1]
            if not qid or qid in seen_qids:
                continue
            seen_qids.add(qid)
            label = row.get('battleLabel', {}).get('value', '')
            if not label or label.startswith('Q'):
                continue
            time_iso = row.get('point_in_time', {}).get('value', '')
            year = ''
            if time_iso:
                # Wikidata datetime format: -0044-03-15T00:00:00Z
                # First 5 chars are the year with sign for BCE/CE
                yr = time_iso[:5]
                try:
                    year = str(int(yr))
                except ValueError:
                    year = ''
            article = normalize_title(row.get('article', {}).get('value', ''))
            conflict = row.get('conflictLabel', {}).get('value', '')
            coord = row.get('coord', {}).get('value', '')
            # Skip if we already have it
            key = (article or label).lower()
            if key in known:
                continue
            out_rows.append({
                'qid': qid,
                'label': label,
                'year': year,
                'conflict': conflict,
                'coord': coord,
                'article': article,
            })
        offset += page
        print(f'  offset={offset} seen={len(seen_qids)} gap={len(out_rows)}', flush=True)
        time.sleep(1)
        if offset > 200000:
            print('safety stop at 200000', flush=True)
            break

    with open(OUT, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['qid', 'label', 'year', 'conflict', 'coord', 'article'])
        w.writeheader()
        w.writerows(out_rows)
    print(f'wrote {len(out_rows)} gap rows to {OUT}', flush=True)


if __name__ == '__main__':
    main()
