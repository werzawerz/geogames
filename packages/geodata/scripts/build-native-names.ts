// Builds data/native-names.json for Native Tongue: each country's name for
// itself, in the language and script of its main national language.
//
//   node scripts/build-native-names.ts --cldr <dir>/package/main
//
// Source: Unicode CLDR 49, the `cldr-localenames-full` package (territory names
// in each language, vetted by native speakers; Unicode licence v3, free to use
// including commercially). Get it with `npm pack cldr-localenames-full@49.0.0`
// and unpack it anywhere; it isn't a dependency, since only this build reads it.
//
// One rule for countries with several national languages: the one most of the
// people speak, or the one the state calls itself in (Switzerland: German,
// India: Hindi, Belgium: Dutch). The table below is that choice, by hand.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/fetch.ts';
import type { NativeName, NativeNameData } from '../src/native-names.ts';

const CLDR_VERSION = '49.0.0';

/** ISO 3166-1 alpha-2 code → CLDR locale to take the country's own name from. */
const LOCALES: Record<string, string> = {
  AF: 'fa', AL: 'sq', DZ: 'ar', AD: 'ca', AO: 'pt', AG: 'en', AR: 'es', AM: 'hy', AU: 'en', AT: 'de', AZ: 'az',
  BS: 'en', BH: 'ar', BD: 'bn', BB: 'en', BY: 'be', BE: 'nl', BZ: 'en', BJ: 'fr', BT: 'dz', BO: 'es', BA: 'bs',
  BW: 'en', BR: 'pt', BN: 'ms', BG: 'bg', BF: 'fr', BI: 'rn', CV: 'pt', KH: 'km', CM: 'fr', CA: 'en', CF: 'sg',
  TD: 'ar', CL: 'es', CN: 'zh', CO: 'es', KM: 'ar', CG: 'fr', CD: 'fr', CR: 'es', CI: 'fr', HR: 'hr', CU: 'es',
  CY: 'el', CZ: 'cs', DK: 'da', DJ: 'fr', DM: 'en', DO: 'es', EC: 'es', EG: 'ar', SV: 'es', GQ: 'es', ER: 'ti',
  EE: 'et', SZ: 'en', ET: 'am', FJ: 'en', FI: 'fi', FR: 'fr', GA: 'fr', GM: 'en', GE: 'ka', DE: 'de', GH: 'en',
  GR: 'el', GD: 'en', GT: 'es', GN: 'fr', GW: 'pt', GY: 'en', HT: 'fr', HN: 'es', HU: 'hu', IS: 'is', IN: 'hi',
  ID: 'id', IR: 'fa', IQ: 'ar', IE: 'ga', IL: 'he', IT: 'it', JM: 'en', JP: 'ja', JO: 'ar', KZ: 'kk', KE: 'sw',
  KI: 'en', KP: 'ko', KR: 'ko', XK: 'sq', KW: 'ar', KG: 'ky', LA: 'lo', LV: 'lv', LB: 'ar', LS: 'st', LR: 'en',
  LY: 'ar', LI: 'de', LT: 'lt', LU: 'lb', MG: 'mg', MW: 'en', MY: 'ms', ML: 'fr', MT: 'mt', MH: 'en', MR: 'ar',
  MU: 'en', MX: 'es', FM: 'en', MD: 'ro', MC: 'fr', MN: 'mn', ME: 'sr-Latn', MA: 'ar', MZ: 'pt', MM: 'my',
  NA: 'en', NR: 'en', NP: 'ne', NL: 'nl', NZ: 'en', NI: 'es', NE: 'fr', NG: 'en', MK: 'mk', NO: 'nb', OM: 'ar',
  PK: 'ur', PW: 'en', PS: 'ar', PA: 'es', PG: 'en', PY: 'es', PE: 'es', PH: 'fil', PL: 'pl', PT: 'pt', QA: 'ar',
  RO: 'ro', RU: 'ru', RW: 'rw', KN: 'en', LC: 'en', VC: 'en', WS: 'en', SM: 'it', ST: 'pt', SA: 'ar', SN: 'fr',
  RS: 'sr', SC: 'en', SL: 'en', SG: 'ms', SK: 'sk', SI: 'sl', SB: 'en', SO: 'so', ZA: 'en', SS: 'en',
  ES: 'es', LK: 'si', SD: 'ar', SR: 'nl', SE: 'sv', CH: 'de', SY: 'ar', TW: 'zh-Hant', TJ: 'tg', TZ: 'sw',
  TH: 'th', TL: 'pt', TG: 'fr', TO: 'en', TT: 'en', TN: 'ar', TR: 'tr', TM: 'tk', TV: 'en', UG: 'en', UA: 'uk',
  AE: 'ar', GB: 'en', US: 'en', UY: 'es', UZ: 'uz', VU: 'fr', VA: 'it', VE: 'es', VN: 'vi', YE: 'ar', ZM: 'en',
  ZW: 'en', MV: 'en',
};

/** Script of a name, by the first letter that isn't Latin or punctuation; Han splits by language. */
const SCRIPTS: [string, RegExp][] = [
  ['Greek', /\p{Script=Greek}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Lao', /\p{Script=Lao}/u],
  ['Khmer', /\p{Script=Khmer}/u],
  ['Myanmar', /\p{Script=Myanmar}/u],
  ['Ethiopic', /\p{Script=Ethiopic}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Bengali', /\p{Script=Bengali}/u],
  ['Sinhala', /\p{Script=Sinhala}/u],
  ['Tibetan', /\p{Script=Tibetan}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Han', /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u],
  ['Latin', /\p{Script=Latin}/u],
];
const RTL = new Set(['Arabic', 'Hebrew']);

const scriptOf = (name: string) => SCRIPTS.find(([, re]) => re.test(name))![0];
/** For "same as English" tests: lower case, no accents. */
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');

const cldrArg = process.argv.indexOf('--cldr');
if (cldrArg < 0) throw new Error('Pass --cldr <dir>/package/main (see the top of this file).');
const CLDR = process.argv[cldrArg + 1]!;

async function names(locale: string, file: 'territories' | 'languages'): Promise<Record<string, string>> {
  const json = JSON.parse(await readFile(join(CLDR, locale, `${file}.json`), 'utf8'));
  return json.main[locale].localeDisplayNames[file];
}

const countries: { id: string; iso2: string; name: string; sovereignty: string; metrics: { area?: { value: number } } }[] = JSON.parse(
  await readFile(join(ROOT, 'data', 'countries.json'), 'utf8'),
).countries;
const languageNames = await names('en', 'languages');
const cache = new Map<string, Record<string, string>>();

const out: NativeName[] = [];
for (const c of countries) {
  if (c.sovereignty === 'territory') continue;
  // CLDR's Korean has the South's name for the North (북한, "the North"), not the North's own (조선): not an endonym, so left out.
  if (c.iso2 === 'KP') continue;
  const locale = LOCALES[c.iso2];
  if (!locale) {
    console.warn(`No locale chosen for ${c.iso2} ${c.name}: left out`);
    continue;
  }
  if (!cache.has(locale)) cache.set(locale, await names(locale, 'territories'));
  const native = cache.get(locale)![c.iso2];
  if (!native) throw new Error(`CLDR ${locale} has no name for ${c.iso2}`);
  const script = scriptOf(native);
  const lang = locale.split('-')[0]!;
  out.push({
    id: c.id,
    name: native,
    // CLDR says "Chinese (Traditional)" for zh-Hant; the language name is enough for players.
    language: (languageNames[locale] ?? languageNames[lang]!).replace(/ \(.*\)$/, ''),
    script: script === 'Han' && lang === 'ja' ? 'Japanese' : script === 'Han' && locale === 'zh-Hant' ? 'Han (traditional)' : script,
    ...(RTL.has(script) ? { rtl: true } : {}),
    // Names that read like the English one (Mexico, Chile, Ghana) make no puzzle.
    looksEnglish: plain(native) === plain(c.name),
  });
}

const data: NativeNameData = {
  source: 'Unicode CLDR, cldr-localenames-full',
  version: CLDR_VERSION,
  licence: 'Unicode License v3 (free to use, including commercially)',
  names: out.sort((a, b) => a.id.localeCompare(b.id)),
};
await writeFile(join(ROOT, 'data', 'native-names.json'), JSON.stringify(data) + '\n');
await writeFile(join(ROOT, 'data', 'native-names-version.json'), JSON.stringify({ cldr: CLDR_VERSION }) + '\n');
console.log(`${out.length} countries, ${out.filter((n) => !n.looksEnglish).length} that don't look like their English name`);
for (const n of out.filter((n) => !n.looksEnglish)) console.log(n.id, n.script.padEnd(10), n.language.padEnd(12), n.name);
