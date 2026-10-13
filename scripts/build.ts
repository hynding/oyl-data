/**
 * Compile every domain's YAML into dist/oyl-data.sqlite (+ dist/manifest.json).
 * This is what OYL ships/loads; the YAML is the editable source of truth.
 *
 *   pnpm build
 *   pnpm build --out path/to/oyl-data.sqlite
 *
 * Each domain exports build<Domain>(db) from scripts/<domain>/build.ts, creating its own
 * tables and returning counts for the manifest. This file owns the SQLite file, the meta
 * table and the manifest.
 */
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIST, opt } from './lib.ts';
import { buildNutrition, NUTRITION_SCHEMA_VERSION } from './nutrition/build.ts';

/** Bump when any domain changes its SQLite layout in a way OYL must know about. */
export const SCHEMA_VERSION = 1;

const out = opt('out') ? resolve(opt('out')!) : resolve(DIST, 'oyl-data.sqlite');
mkdirSync(resolve(out, '..'), { recursive: true });
rmSync(out, { force: true });

const started = Date.now();
const db = new Database(out);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');
db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

const nutrition = buildNutrition(db);

const meta = {
  built_at: new Date().toISOString(),
  schema_version: SCHEMA_VERSION,
  domains: {
    nutrition: { schema_version: NUTRITION_SCHEMA_VERSION, ...nutrition },
  },
  licenses: {
    off: 'ODbL-1.0 — https://opendatacommons.org/licenses/odbl/1-0/',
    fdc: 'CC0 (public domain)',
  },
};
const insMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(meta)) insMeta.run(k, typeof v === 'string' ? v : JSON.stringify(v));
db.exec('VACUUM');
db.close();

writeFileSync(resolve(out, '..', 'manifest.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`\n${out}: nutrition ${nutrition.products.toLocaleString()} products + ${nutrition.generic.toLocaleString()} generic foods, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
