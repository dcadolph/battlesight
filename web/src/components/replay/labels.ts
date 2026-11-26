// Map labels for the Map view of a replay. A hand-built label often carries a note
// in parentheses ("Ewell (declining to assault)"). The map shows the short name and
// keeps the note for hover and tap. Pure, so the page and the Node checks share it.

// SplitLabel is a label taken apart into what the map shows and what hover adds.
export interface SplitLabel {
  // name is the text drawn on the map, as authored, with no parentheses.
  name: string;
  // note is what the parentheses held, joined by commas, or empty.
  note: string;
}

const PAREN = /\(([^()]*)\)/g;

// tidy collapses runs of white space and trims stray joiners left at either end.
function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim();
}

// splitLabel returns the map name and the hover note of a raw label. A label that is
// nothing but a parenthesis keeps its inside as the name.
export function splitLabel(raw: string): SplitLabel {
  const notes: string[] = [];
  let rest = raw;
  // Inner groups first, so a nested parenthesis comes out whole.
  for (let guard = 0; guard < 4 && /[()]/.test(rest); guard++) {
    const next = rest.replace(PAREN, (_, inner: string) => {
      const n = tidy(inner);
      if (n) notes.push(n);
      return ' ';
    });
    if (next === rest) break;
    rest = next;
  }
  let name = tidy(rest.replace(/[()]/g, ' '));
  let note = notes.join(', ');
  if (!name) {
    name = note;
    note = '';
  }
  return { name, note };
}
