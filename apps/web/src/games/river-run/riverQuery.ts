import { normalize } from '../../components/search.ts';

/** Words players add around a river's name: "Volga River", "River Thames", "Rio Paraná", "Fleuve Congo". */
const FILLERS = new Set(['river', 'rio', 'fleuve', 'fluss', 'reka']);

/**
 * What to search for: the text without a leading or trailing "River" (or Rio,
 * Río, Fleuve, Fluss, Reka), unless that word is part of a real name. "Rio
 * Grande River" becomes "Rio Grande"; "Rio Negro" and "Red River" stay.
 * `names` holds every river name and alias, normalised.
 */
export function riverQuery(text: string, names: ReadonlySet<string>): string {
  let words = text.trim().split(/\s+/);
  const known = (w: readonly string[]) => names.has(normalize(w.join(' ')));
  if (known(words)) return text;
  if (words.length > 1 && FILLERS.has(normalize(words.at(-1)!))) {
    words = words.slice(0, -1);
    if (known(words)) return words.join(' ');
  }
  if (words.length > 1 && FILLERS.has(normalize(words[0]!))) words = words.slice(1);
  return words.join(' ');
}
