"""Derive era classification from year for any battle missing one or
holding the deprecated 'modern' tag. Idempotent and conservative.

Era ranges aligned with the rest of the app:
  ancient        -3000..500
  medieval       501..1500
  early-modern   1501..1788
  napoleonic     1789..1815
  industrial     1816..1913
  world-war-1    1914..1918
  interwar       1919..1938
  world-war-2    1939..1945
  cold-war       1946..1990
  contemporary   1991..present
"""
import sqlite3

DB = '/Users/douglasadolph/src/dcadolph/battlesight/data/battlesight.db'

# Valid eras the rest of the app recognises. 'modern' is a stale label
# from the original import; remap by year.
VALID = {
    'ancient', 'medieval', 'early-modern', 'napoleonic', 'industrial',
    'world-war-1', 'interwar', 'world-war-2', 'cold-war', 'contemporary',
}


def era_for_year(year: int) -> str:
    if year <= 500:
        return 'ancient'
    if year <= 1500:
        return 'medieval'
    if year <= 1788:
        return 'early-modern'
    if year <= 1815:
        return 'napoleonic'
    if year <= 1913:
        return 'industrial'
    if year <= 1918:
        return 'world-war-1'
    if year <= 1938:
        return 'interwar'
    if year <= 1945:
        return 'world-war-2'
    if year <= 1990:
        return 'cold-war'
    return 'contemporary'


def main():
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("SELECT id, year, era FROM battles")
    rows = cur.fetchall()
    blank = 0
    remapped = 0
    for bid, year, era in rows:
        if year == 0:
            continue
        if era and era in VALID:
            continue
        new_era = era_for_year(year)
        if new_era == era:
            continue
        cur.execute('UPDATE battles SET era = ? WHERE id = ?', (new_era, bid))
        if era == '' or era is None:
            blank += 1
        else:
            remapped += 1
    con.commit()
    con.close()
    print(f'filled blank era: {blank}, remapped legacy era: {remapped}', flush=True)


if __name__ == '__main__':
    main()
