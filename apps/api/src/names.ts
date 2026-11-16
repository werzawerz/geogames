// Display names show on public leaderboards, so offensive ones are refused on
// rename. A small list, matched after undoing the usual disguises: case, accents,
// leetspeak (5h1t), repeated letters (fuuuck) and spaced-out letters (f u c k,
// f.u.c.k). Words that turn up inside ordinary names and places (Dickens,
// Scunthorpe, Pornic, therapist) only count as a word of their own, and words
// aren't run together (Hiroshi Tanaka).

/** Refused anywhere in a word, even inside a longer one. */
const ANYWHERE = [
  'fuck', 'shit', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'bitch', 'bastard', 'motherf', 'dickhead',
  'cocksuck', 'asshole', 'arsehole', 'wanker', 'retard', 'hitler', 'pedophil', 'paedophil', 'porno', 'pornhub',
  'kkk', 'siegheil', 'jizz', 'blowjob', 'handjob', 'dildo', 'tranny',
];

/** Refused only as a word of its own. */
const WHOLE_WORD = [
  'ass', 'arse', 'dick', 'cock', 'cum', 'cunt', 'cunts', 'fag', 'fags', 'tit', 'tits', 'twat', 'rape', 'rapist',
  'nazi', 'nazis', 'penis', 'vagina', 'anal', 'anus', 'wank', 'pussy', 'pussies', 'porn', 'spic', 'chink', 'kike',
  'coon', 'gook', 'nig',
];

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g',
};

/** Lower case, no accents, leetspeak undone, letters only. */
function letters(text: string): string {
  return [...text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()]
    .map((ch) => LEET[ch] ?? ch)
    .join('')
    .replace(/[^a-z]/g, '');
}

/**
 * A word whose letters may repeat (fuuuck), while a doubled letter stays required
 * (nigger, not Niger). A 1 may have stood for an l as well as an i.
 */
const pattern = (word: string) => [...word].map((ch) => (ch === 'i' || ch === 'l' ? '[il]+' : `${ch}+`)).join('');

const anywhere = new RegExp(ANYWHERE.map(pattern).join('|'));
const wholeWord = new RegExp(`^(?:${WHOLE_WORD.map(pattern).join('|')})$`);

export function isOffensiveName(name: string): boolean {
  // Words are what spaces and punctuation separate; leetspeak symbols stay part of a word.
  const words = name.split(/[\s\-_.,;:/\\'"()[\]{}*~^#&=?<>]+/).map(letters).filter(Boolean);
  // Runs of single letters are read as one word: "f u c k".
  const spelled = words.join(' ').replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');
  return spelled.split(' ').some((word) => anywhere.test(word) || wholeWord.test(word));
}
