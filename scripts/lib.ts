import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = resolve(ROOT, '.cache');
export const DIST = resolve(ROOT, 'dist');

/** Parse a YAML file given relative to the repo root. */
export function loadYaml<T>(file: string): T {
  return parse(readFileSync(resolve(ROOT, file), 'utf8')) as T;
}

export function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/^[a-z]{2}:/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Small CLI arg helpers shared by every script. */
export const args = process.argv.slice(2);
export const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
export const flag = (name: string) => args.includes(`--${name}`);
