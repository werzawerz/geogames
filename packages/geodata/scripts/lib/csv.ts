/** Parses one RFC 4180 CSV line (quoted fields, doubled quotes). Fields never span lines in our sources. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Iterates CSV rows as objects keyed by header. */
export function* csvRecords(text: string): Generator<Record<string, string>> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = parseCsvLine(lines[0] ?? '');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    if (cols.length !== header.length) throw new Error(`CSV line ${i + 1}: expected ${header.length} fields, got ${cols.length}`);
    yield Object.fromEntries(header.map((h, j) => [h, cols[j]!]));
  }
}
