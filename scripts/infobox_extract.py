"""Extract Wikipedia infobox military conflict fields for every battle in
the DB that has a wikipedia_title.

Pulls wikitext in 50-title batches via the action=query revisions API,
parses with mwparserfromhell, finds the Infobox military conflict
template, and writes back: result/victor, combatant1, combatant2,
commander1, commander2, strength1, strength2, casualties1, casualties2,
date, coordinates.

Idempotent: skips rows whose victor + sides are already populated unless
--force is passed.
"""
import sys
import time
import json
import sqlite3
import argparse
import re
from typing import Optional

import requests
import mwparserfromhell as mw

DB = '/Users/douglasadolph/src/dcadolph/battlesight/data/battlesight.db'
UA = 'BattleSight/1.0 (history visualization; https://github.com/dcadolph/battlesight)'
ENDPOINT = 'https://en.wikipedia.org/w/api.php'
BATCH = 50  # action=query supports up to 50 titles per request for anonymous
SLEEP_S = 1.0


WIKILINK = re.compile(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]')
HTML_TAG = re.compile(r'<[^>]+>')
REF_TAG = re.compile(r'<ref[^>]*>.*?</ref>|<ref[^/]*/>', re.DOTALL)
TEMPLATE_FLAG = re.compile(r'\{\{(?:flag|flagcountry|flagicon|flag\+link|navy)\|([^}|]+)(?:\|[^}]*)?\}\}', re.IGNORECASE)


def strip_wikitext(value: str) -> str:
    """Convert a raw infobox field value to plain prose."""
    if not value:
        return ''
    s = value
    # References
    s = REF_TAG.sub('', s)
    # Flags
    s = TEMPLATE_FLAG.sub(lambda m: m.group(1), s)
    # Try to recursively strip templates by parsing and visiting nodes
    try:
        code = mw.parse(s)
        for tpl in list(code.filter_templates()):
            tname = str(tpl.name).strip().lower()
            if tname.startswith(('unbulleted list', 'ubl', 'plainlist')):
                # Join list params with comma-space
                items = []
                for p in tpl.params:
                    if str(p.name).strip().isdigit():
                        items.append(strip_wikitext(str(p.value)))
                replacement = '; '.join(filter(None, items))
                code.replace(tpl, replacement)
            else:
                # Drop other templates entirely
                try:
                    code.remove(tpl)
                except ValueError:
                    pass
        s = str(code)
    except Exception:
        pass
    # Wikilinks
    s = WIKILINK.sub(r'\1', s)
    # HTML
    s = HTML_TAG.sub(' ', s)
    # Whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    # Stray bullet markers
    s = re.sub(r'^[\*\#\s]+', '', s)
    s = re.sub(r'(?:^|\n)[\*\#]\s*', '; ', s).strip(';, ')
    return s.strip()


def find_infobox(wikitext: str):
    """Return the Infobox military conflict template, or None."""
    try:
        code = mw.parse(wikitext)
    except Exception:
        return None
    for tpl in code.filter_templates():
        name = str(tpl.name).strip().lower()
        if name.startswith('infobox') and ('military' in name or 'civilian' in name):
            return tpl
    return None


def template_value(tpl, *names: str) -> Optional[str]:
    for n in names:
        if tpl.has(n):
            raw = str(tpl.get(n).value)
            cleaned = strip_wikitext(raw)
            if cleaned:
                return cleaned
    return None


def extract_fields(wikitext: str) -> Optional[dict]:
    tpl = find_infobox(wikitext)
    if tpl is None:
        return None
    out = {}
    out['result'] = template_value(tpl, 'result', 'outcome')
    out['combatant1'] = template_value(tpl, 'combatant1', 'combatants_header1')
    out['combatant2'] = template_value(tpl, 'combatant2', 'combatants_header2')
    out['combatant3'] = template_value(tpl, 'combatant3')
    out['commander1'] = template_value(tpl, 'commander1', 'commanders1')
    out['commander2'] = template_value(tpl, 'commander2', 'commanders2')
    out['commander3'] = template_value(tpl, 'commander3')
    out['strength1'] = template_value(tpl, 'strength1')
    out['strength2'] = template_value(tpl, 'strength2')
    out['strength3'] = template_value(tpl, 'strength3')
    out['casualties1'] = template_value(tpl, 'casualties1')
    out['casualties2'] = template_value(tpl, 'casualties2')
    out['casualties3'] = template_value(tpl, 'casualties3')
    out['date'] = template_value(tpl, 'date')
    out['place'] = template_value(tpl, 'place', 'location')
    out['coordinates'] = template_value(tpl, 'coordinates', 'coord')
    out['territory'] = template_value(tpl, 'territory')
    out['casualties_civilian'] = template_value(tpl, 'casualties3', 'casualties_civilian', 'civilian_casualties')
    return out


def fetch_wikitext(titles: list[str], session: requests.Session) -> dict[str, str]:
    """Fetch wikitext for up to 50 titles. Returns title -> wikitext."""
    out: dict[str, str] = {}
    if not titles:
        return out
    params = {
        'action': 'query',
        'prop': 'revisions',
        'rvprop': 'content',
        'rvslots': 'main',
        'titles': '|'.join(titles),
        'redirects': '1',
        'format': 'json',
        'formatversion': '2',
    }
    try:
        r = session.get(ENDPOINT, params=params, headers={'User-Agent': UA}, timeout=30)
        r.raise_for_status()
        payload = r.json()
    except Exception as e:
        print(f'  batch error: {e}', flush=True)
        return out
    normalized = {n['from']: n['to'] for n in payload.get('query', {}).get('normalized', [])}
    redirects = {r['from']: r['to'] for r in payload.get('query', {}).get('redirects', [])}
    pages = payload.get('query', {}).get('pages', [])
    page_by_title: dict[str, str] = {}
    for p in pages:
        if p.get('missing') or p.get('invalid'):
            continue
        t = p.get('title', '')
        revs = p.get('revisions') or []
        if revs and 'slots' in revs[0]:
            wt = revs[0]['slots'].get('main', {}).get('content', '')
            if wt:
                page_by_title[t] = wt
    for orig in titles:
        t = normalized.get(orig, orig)
        t = redirects.get(t, t)
        if t in page_by_title:
            out[orig] = page_by_title[t]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='limit number of battles (0 = all)')
    ap.add_argument('--force', action='store_true', help='re-fetch even when victor populated')
    ap.add_argument('--only-missing-victor', action='store_true')
    args = ap.parse_args()

    con = sqlite3.connect(DB)
    cur = con.cursor()
    where = ["wikipedia_title != ''"]
    if args.only_missing_victor:
        where.append("victor = ''")
    elif not args.force:
        where.append("(victor = '' OR significance = '')")
    sql = f"SELECT id, name, wikipedia_title FROM battles WHERE {' AND '.join(where)}"
    if args.limit:
        sql += f' LIMIT {args.limit}'
    cur.execute(sql)
    rows = cur.fetchall()
    print(f'rows to process: {len(rows)}', flush=True)
    if not rows:
        return

    title_to_ids: dict[str, list[str]] = {}
    titles_in_order: list[str] = []
    for bid, name, wt in rows:
        title_to_ids.setdefault(wt, []).append(bid)
        if wt not in titles_in_order:
            titles_in_order.append(wt)

    print(f'unique titles: {len(titles_in_order)}', flush=True)

    session = requests.Session()
    start = time.time()
    n_done = 0
    n_with_infobox = 0
    n_updated = 0
    n_victor_filled = 0
    n_sides_filled = 0
    n_significance_filled = 0

    for batch_start in range(0, len(titles_in_order), BATCH):
        chunk = titles_in_order[batch_start:batch_start + BATCH]
        wt_by_title = fetch_wikitext(chunk, session)
        for title in chunk:
            wt = wt_by_title.get(title)
            n_done += 1
            if not wt:
                continue
            fields = extract_fields(wt)
            if fields is None:
                continue
            n_with_infobox += 1
            for bid in title_to_ids[title]:
                # Build the new values to write.
                new_victor = fields.get('result') or ''
                # Sides JSON: try to assemble combatant/commander/strength/casualties
                sides = []
                for i in (1, 2, 3):
                    name_val = fields.get(f'combatant{i}')
                    if not name_val:
                        continue
                    sides.append({
                        'name': name_val,
                        'commander': fields.get(f'commander{i}') or '',
                        'strength': fields.get(f'strength{i}') or '',
                        'casualties': fields.get(f'casualties{i}') or '',
                    })
                # Build a significance line from territory if present.
                significance = fields.get('territory') or ''
                # Conditional updates
                cur.execute('SELECT victor, significance FROM battles WHERE id = ?', (bid,))
                row = cur.fetchone()
                if not row:
                    continue
                cur_victor, cur_sig = row
                updates = {}
                if not cur_victor and new_victor:
                    updates['victor'] = new_victor
                    n_victor_filled += 1
                if not cur_sig and significance:
                    updates['significance'] = significance
                    n_significance_filled += 1
                # battle_sides write — only if no sides exist for this battle
                if sides:
                    cur.execute('SELECT COUNT(*) FROM battle_sides WHERE battle_id = ?', (bid,))
                    have = cur.fetchone()[0]
                    if have == 0:
                        for idx, s in enumerate(sides):
                            cur.execute(
                                'INSERT INTO battle_sides (battle_id, side_index, name, commander, strength, casualties) VALUES (?, ?, ?, ?, ?, ?)',
                                (bid, idx, s['name'][:200], s['commander'][:200], s['strength'][:200], s['casualties'][:300]),
                            )
                        n_sides_filled += 1
                if updates:
                    sets = ', '.join(f'{k} = ?' for k in updates)
                    cur.execute(f'UPDATE battles SET {sets} WHERE id = ?', (*updates.values(), bid))
                    n_updated += 1
        con.commit()
        elapsed = time.time() - start
        rate = n_done / elapsed if elapsed > 0 else 0
        eta = (len(titles_in_order) - n_done) / rate if rate > 0 else 0
        print(
            f'  {n_done}/{len(titles_in_order)}  infobox={n_with_infobox} '
            f'victors+={n_victor_filled} sides+={n_sides_filled} sig+={n_significance_filled} '
            f'{rate:.1f}t/s eta={eta:.0f}s',
            flush=True,
        )
        time.sleep(SLEEP_S)

    con.close()
    print(
        f'done: infobox={n_with_infobox} victors+={n_victor_filled} sides+={n_sides_filled} sig+={n_significance_filled}',
        flush=True,
    )


if __name__ == '__main__':
    main()
