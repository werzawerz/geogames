import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = join(ROOT, '.cache');
export const OFFLINE = process.argv.includes('--offline');

/** Downloads `url` into .cache/`name` (or reuses it with --offline) and returns the bytes. */
export async function cachedFile(name: string, url: string): Promise<Buffer> {
  const file = join(CACHE, name);
  if (OFFLINE) {
    if (!existsSync(file)) throw new Error(`--offline: missing cache file ${file}`);
  } else {
    console.log(`fetch ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFile(file);
}

export async function cachedJson<T>(name: string, url: string): Promise<T> {
  return JSON.parse((await cachedFile(name, url)).toString('utf8')) as T;
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
