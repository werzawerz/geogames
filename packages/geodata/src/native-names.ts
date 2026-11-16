export interface NativeName {
  /** The country's ISO 3166-1 alpha-3 id. */
  id: string;
  /** The country's name for itself, in the script of its main national language. */
  name: string;
  /** CLDR locale of the name ("zh-Hant"), for the page's lang attribute, which picks Chinese or Japanese glyphs. */
  lang: string;
  /** English name of that language ("Georgian"). */
  language: string;
  /** "Latin", "Cyrillic", "Arabic", "Greek"... Han is split into "Han" (simplified), "Han (traditional)" and "Japanese". */
  script: string;
  /** Written right to left. */
  rtl?: true;
  /** The name reads like the English one once accents go (Mexico, Ghana): no puzzle in it. */
  looksEnglish: boolean;
}

/** data/native-names.json (scripts/build-native-names.ts). */
export interface NativeNameData {
  source: string;
  version: string;
  licence: string;
  /** Names changed by hand from CLDR's, by ISO 3166-1 alpha-2 code, with the reason. */
  overrides: Record<string, string>;
  names: NativeName[];
}

import version from '../data/native-names-version.json' with { type: 'json' };

/** The CLDR release the names come from: part of the dataset version, so a server only replays runs made on the same names. */
export const NATIVE_NAMES_VERSION: string = `cldr${version.cldr}`;

/** The names of Native Tongue, loaded only when it's played. */
export async function loadNativeNames(): Promise<NativeNameData> {
  const m = await import('../data/native-names.json', { with: { type: 'json' } });
  return m.default as unknown as NativeNameData;
}
