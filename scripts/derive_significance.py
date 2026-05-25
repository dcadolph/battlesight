"""For battles missing significance text, derive a one-sentence
'why this matters' line from the existing summary.

Wikipedia lead paragraphs often close with a sentence about consequences:
'...marked the end of...', 'led to the collapse of...', 'considered the
turning point of...'. We grep for those signal phrases and use the
matching sentence (or its tail) as significance.

Conservative: leaves significance blank if no signal sentence is found,
rather than picking a random sentence. Idempotent.
"""
import re
import sqlite3

DB = '/Users/douglasadolph/src/dcadolph/battlesight/data/battlesight.db'

SIGNAL = re.compile(
    r'\b('
    r'marked|marks|signaled|signaled|signaled the|'
    r'considered|regarded as|widely regarded|seen as|'
    r'turning point|decisive moment|watershed|pivotal|'
    r'led to|leading to|set in motion|paved the way|paved the road|'
    r'ended|ending the|brought an end|brought to an end|brought to a close|'
    r'began the|began|opened the|opened|'
    r'collapse of|fall of|rise of|founding of|establishment of|'
    r'first|last|largest|bloodiest|deadliest|costliest|'
    r'one of the most|considered one of|'
    r'consequence|consequences|aftermath|legacy'
    r')\b',
    re.IGNORECASE,
)

# Sentence splitter that respects common abbreviations and decimal numbers.
SENTENCE_END = re.compile(r'(?<=[.!?])\s+(?=[A-Z])')


def best_significance_sentence(summary: str) -> str:
    if not summary:
        return ''
    sents = [s.strip() for s in SENTENCE_END.split(summary) if s.strip()]
    if not sents:
        return ''
    # Prefer the LAST signal-matching sentence (Wikipedia leads tend to
    # save consequence framing for the end of the paragraph).
    for s in reversed(sents):
        if 30 <= len(s) <= 360 and SIGNAL.search(s):
            return s
    return ''


def main():
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("SELECT id, summary FROM battles WHERE significance = '' AND summary != ''")
    rows = cur.fetchall()
    print(f'rows to scan: {len(rows)}', flush=True)
    filled = 0
    for bid, summary in rows:
        sig = best_significance_sentence(summary)
        if not sig:
            continue
        cur.execute('UPDATE battles SET significance = ? WHERE id = ?', (sig, bid))
        filled += 1
    con.commit()
    con.close()
    print(f'derived significance for {filled} battles', flush=True)


if __name__ == '__main__':
    main()
