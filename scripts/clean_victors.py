"""Clean up the raw victor strings written by the infobox extractor.

The infobox `result` field is freeform text. Common patterns:
  "Decisive Roman victory"               -> "Roman"
  "Pyrrhic Greek victory"                -> "Greek"
  "Soviet victory"                       -> "Soviet"
  "Tactical Confederate victory;
   strategic Union victory"              -> first side wins by mention
  "Inconclusive" / "Stalemate"           -> clear (no victor)
  "See aftermath" / "Disputed"           -> clear

Strips qualifier prefixes, drops non-result phrases, and writes the
cleaned victor back. Idempotent and conservative — leaves the cell
empty rather than guess when the text is too noisy.
"""
import re
import sqlite3

DB = '/Users/douglasadolph/src/dcadolph/battlesight/data/battlesight.db'

QUALIFIERS = re.compile(
    r'^(decisive|pyrrhic|narrow|tactical|strategic|major|minor|complete|partial|qualified|disputed)\s+',
    re.IGNORECASE,
)
NON_RESULTS = {
    'inconclusive', 'stalemate', 'indecisive', 'see aftermath', 'see results',
    'disputed', 'contested', 'unclear', 'unknown', 'mutual', 'truce',
    'see below', 'see article', 'see article text', 'see body',
    'both sides claim victory', 'both sides claimed victory',
}
TRAILING = re.compile(r'\s*(?:victory|win|wins|won|triumph|success|defeat).*$', re.IGNORECASE)


def clean_victor(raw: str) -> str:
    if not raw:
        return ''
    s = raw.strip()
    # Drop everything from the first semicolon, comma+newline, or bullet
    s = re.split(r'\s*[;|]\s*|\s*\n\s*|\s*•\s*', s)[0].strip()
    # If the whole string is a non-result phrase, blank it
    if s.lower().strip('.') in NON_RESULTS:
        return ''
    # Strip leading qualifier ("Decisive ", "Tactical ", etc.)
    s = QUALIFIERS.sub('', s).strip()
    # Strip trailing "victory" et al.
    s = TRAILING.sub('', s).strip()
    # Remove possessive apostrophe-s
    s = re.sub(r"'s$", '', s).strip()
    # Drop stray punctuation
    s = s.strip(' .,:;-')
    # Sanity: too long suggests it's still prose, blank it
    if len(s) > 80:
        return ''
    if len(s) < 2:
        return ''
    # If it ends with "and" or starts with junk like "[", blank
    if s.lower().endswith(' and') or s.startswith('['):
        return ''
    return s


def main():
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("SELECT id, victor FROM battles WHERE victor != ''")
    rows = cur.fetchall()
    changed = 0
    blanked = 0
    for bid, raw in rows:
        cleaned = clean_victor(raw)
        if cleaned != raw:
            cur.execute('UPDATE battles SET victor = ? WHERE id = ?', (cleaned, bid))
            if cleaned == '':
                blanked += 1
            else:
                changed += 1
    con.commit()
    con.close()
    print(f'cleaned: {changed} updated, {blanked} blanked', flush=True)


if __name__ == '__main__':
    main()
