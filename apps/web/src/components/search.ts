// Matching logic behind SearchInput, kept free of React so it can be unit-tested.

export interface SearchItem {
  id: string;
  label: string;
  /** Shown after the label to tell items apart, e.g. a city's country. */
  detail?: string;
  /** Flag shown next to the label. */
  iso2?: string;
  /** Other names that should match ("Czech Republic", "Wien", "San Jose" for San Francisco). */
  aliases?: readonly string[];
  /** Short forms (TX, NSW) that match but are never shown as the reason, so a suggestion always reads as the full name. */
  quietAliases?: readonly string[];
  /** Names of the item's country ("United States", "USA", "US"), so "San Jose USA" narrows the list. */
  scope?: readonly string[];
  /** Bigger first among equally good matches (population, prominence). */
  weight?: number;
}

export interface SearchHit {
  item: SearchItem;
  /** The alias that matched, when it wasn't the label (shown so "San Jose → San Francisco" makes sense). */
  via?: string;
}

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Optimal-string-alignment distance (edits incl. swapped neighbours), giving up above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push([i]);
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        rows[0]![j] = j;
        continue;
      }
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = d;
      best = Math.min(best, d);
    }
    if (i > 0 && best > max) return max + 1;
  }
  return rows[a.length]![b.length]!;
}

/** Typos tolerated for a query of this length: none for short ones, so "Rome" doesn't match "Rouen". */
const allowedTypos = (length: number) => (length >= 8 ? 2 : length >= 4 ? 1 : 0);

interface Indexed {
  item: SearchItem;
  names: { raw: string; key: string; words: string[]; isLabel: boolean; quiet: boolean }[];
  scope: Set<string>;
}

export function buildIndex(items: readonly SearchItem[]): Indexed[] {
  return items.map((item) => ({
    item,
    names: [item.label, ...(item.aliases ?? []), ...(item.quietAliases ?? [])].map((raw, i) => ({
      raw,
      quiet: i > (item.aliases?.length ?? 0),
      key: normalize(raw),
      words: raw.split(/[\s\-–/,()[\]]+/).map(normalize).filter(Boolean),
      isLabel: i === 0,
    })),
    scope: new Set((item.scope ?? []).map(normalize)),
  }));
}

/**
 * How well `query` matches one name (lower is better): exact, prefix,
 * word prefix ("jose" in "San José"), contained, or with a typo or two.
 */
function score(query: string, name: Indexed['names'][number]): number | null {
  const typos = allowedTypos(query.length);
  if (name.key === query) return 0;
  if (name.key.startsWith(query)) return 2;
  if (name.words.some((w) => w.startsWith(query))) return 4;
  if (query.length >= 3 && name.key.includes(query)) return 6;
  if (typos > 0) {
    // A typo in a whole name ("Kyev") or in what's been typed so far ("Amstred").
    const whole = editDistance(query, name.key, typos);
    const prefix = editDistance(query, name.key.slice(0, query.length), typos);
    if (Math.min(whole, prefix) <= typos) return 8 + Math.min(whole, prefix);
  }
  return null;
}

/**
 * Splits "San Jose, USA" / "San Jose usa" / "kiev ukraine" into a name part and
 * a country part, when the end of the query names a country some item has.
 */
function countrySplits(text: string, scopes: ReadonlySet<string>): { name: string; country: string }[] {
  const splits: { name: string; country: string }[] = [];
  const comma = text.lastIndexOf(',');
  if (comma > 0) splits.push({ name: text.slice(0, comma), country: text.slice(comma + 1) });
  const words = text.replace(',', ' ').trim().split(/\s+/);
  for (let k = 1; k <= Math.min(3, words.length - 1); k++) {
    splits.push({ name: words.slice(0, -k).join(' '), country: words.slice(-k).join(' ') });
  }
  return splits.filter((s) => {
    const c = normalize(s.country);
    return normalize(s.name) && c.length >= 2 && [...scopes].some((t) => t === c || (c.length >= 3 && t.startsWith(c)));
  });
}

/** Best matches for `text`, best first; `exclude`d ids are left out. */
export function search(index: readonly Indexed[], text: string, exclude: ReadonlySet<string>, limit: number): SearchHit[] {
  const query = normalize(text);
  if (!query) return [];

  const allScopes = new Set(index.flatMap((e) => [...e.scope]));
  const attempts: { name: string; country: string | null }[] = [
    ...countrySplits(text, allScopes).map((s) => ({ name: normalize(s.name), country: normalize(s.country) })),
    { name: query, country: null },
  ];

  const best = new Map<string, { hit: SearchHit; rank: number }>();
  for (const { name, country } of attempts) {
    for (const entry of index) {
      if (exclude.has(entry.item.id)) continue;
      // A country in the query must match the item's country; such hits rank above plain ones.
      if (country && ![...entry.scope].some((t) => t === country || (country.length >= 3 && t.startsWith(country)))) continue;
      let found: { rank: number; via?: string } | null = null;
      for (const n of entry.names) {
        const s = score(name, n);
        if (s === null) continue;
        const rank = s + (n.isLabel ? 0 : 1) - (country ? 0.5 : 0);
        if (!found || rank < found.rank) found = { rank, via: n.isLabel || n.quiet ? undefined : n.raw };
      }
      if (!found) continue;
      const previous = best.get(entry.item.id);
      if (!previous || found.rank < previous.rank) best.set(entry.item.id, { hit: { item: entry.item, via: found.via }, rank: found.rank });
    }
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.hit.item.weight ?? 0) - (a.hit.item.weight ?? 0) ||
        a.hit.item.label.localeCompare(b.hit.item.label),
    )
    .slice(0, limit)
    .map((r) => r.hit);
}

/**
 * The item `text` names exactly (label or alias, honouring a country suffix),
 * if exactly one does; excluded items count, so the game can say why it can't take them.
 */
export function exactMatch(index: readonly Indexed[], text: string): SearchItem | null {
  const query = normalize(text);
  const allScopes = new Set(index.flatMap((e) => [...e.scope]));
  const attempts = [
    ...countrySplits(text, allScopes).map((s) => ({ name: normalize(s.name), country: normalize(s.country) })),
    { name: query, country: null as string | null },
  ];
  for (const { name, country } of attempts) {
    const hits = index.filter(
      (e) =>
        e.names.some((n) => n.key === name) &&
        (!country || [...e.scope].some((t) => t === country || (country.length >= 3 && t.startsWith(country)))),
    );
    if (hits.length === 1) return hits[0]!.item;
    if (hits.length > 1) return null;
  }
  return null;
}
