/**
 * Extract generic foods from USDA FoodData Central CSV bundles into .cache/usda.jsonl.
 *
 *   scripts/nutrition/fetch-usda.sh        # one-time download → .cache/usda/{sr_legacy,foundation,survey}/
 *   pnpm extract:usda                      # all three datasets found under .cache/usda/
 *   pnpm extract:usda --source dir         # a directory containing <dataset>/ subdirs (used by pnpm test)
 *   pnpm extract:usda --stats              # food counts per dataset and category
 *   pnpm extract:usda --limit 500          # per dataset
 *
 * Output is one JSON object per food with raw FDC nutrient ids/units and portions;
 * shard-generic.ts maps those onto nutrients.yaml and writes nutrition/foods/generic/**.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, mkdirSync, readFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { CACHE, ROOT, args, opt } from './lib.ts';

const DATASETS = ['foundation', 'sr_legacy', 'survey'] as const;
const sourceRoot = resolve(opt('source') ?? resolve(CACHE, 'usda'));
const out = opt('out') ?? resolve(CACHE, 'usda.jsonl');
const limit = opt('limit');
const stats = args.includes('--stats');

mkdirSync(resolve(out, '..'), { recursive: true });
const found = DATASETS.filter((d) => existsSync(resolve(sourceRoot, d, 'food.csv')));
if (!found.length) {
  console.error(`no datasets under ${sourceRoot} — run scripts/nutrition/fetch-usda.sh first`);
  process.exit(2);
}

const db = await DuckDBInstance.create(':memory:');
const conn = await db.connect();
const template = readFileSync(resolve(ROOT, 'scripts/nutrition/extract-usda.sql'), 'utf8');

/** FNDDS categorizes via WWEIA codes; SR Legacy / Foundation via food_category. Build whichever exists. */
function categoryCte(dir: string): string {
  const csv = (f: string) => `read_csv('${dir}/${f}', all_varchar = true, header = true)`;
  if (existsSync(resolve(dir, 'survey_fndds_food.csv')) && existsSync(resolve(dir, 'wweia_food_category.csv'))) {
    return `SELECT s.fdc_id, w.wweia_food_category_description AS category
            FROM ${csv('survey_fndds_food.csv')} s
            LEFT JOIN ${csv('wweia_food_category.csv')} w ON w.wweia_food_category = s.wweia_category_code`;
  }
  if (existsSync(resolve(dir, 'food_category.csv'))) {
    return `SELECT f.fdc_id, fc.description AS category
            FROM ${csv('food.csv')} f
            JOIN ${csv('food_category.csv')} fc ON fc.id = f.food_category_id`;
  }
  return `SELECT NULL AS fdc_id, NULL AS category WHERE false`;
}

const ws = stats ? null : createWriteStream(out);
const started = Date.now();
let total = 0;
for (const dataset of found) {
  const dir = resolve(sourceRoot, dataset);
  const sql = template
    .replaceAll('{{DIR}}', dir)
    .replaceAll('{{DATASET}}', dataset)
    .replaceAll('{{CATEGORY_CTE}}', categoryCte(dir))
    .replaceAll('{{LIMIT}}', limit ? `LIMIT ${Number(limit)}` : '');

  if (stats) {
    const r = await conn.runAndReadAll(`SELECT category, count(*) AS n FROM (${sql.replace(/ORDER BY fdc_id\s*$/m, '')}) GROUP BY category ORDER BY n DESC`);
    const rows = r.getRows() as [string | null, bigint][];
    const n = rows.reduce((a, [, c]) => a + Number(c), 0);
    console.log(`\n${dataset}: ${n.toLocaleString()} foods in ${rows.length} categories`);
    for (const [cat, c] of rows.slice(0, 40)) console.log(`  ${String(Number(c)).padStart(6)}  ${cat ?? '(none)'}`);
    if (rows.length > 40) console.log(`  … ${rows.length - 40} more`);
    continue;
  }

  const result = await conn.stream(sql);
  const columns = result.columnNames();
  let n = 0;
  for (;;) {
    const chunk = await result.fetchChunk();
    if (!chunk || chunk.rowCount === 0) break;
    for (const row of chunk.getRows()) {
      const obj: Record<string, unknown> = {};
      columns.forEach((c, i) => { obj[c] = normalize(row[i]); });
      ws!.write(JSON.stringify(obj) + '\n');
      n++;
    }
  }
  total += n;
  console.log(`${dataset}: ${n.toLocaleString()} foods`);
}
if (ws) {
  ws.end();
  console.log(`${total.toLocaleString()} foods → ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

/** DuckDB values → plain JSON (BigInt, LIST, STRUCT wrappers). */
function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === 'object') {
    const anyV = v as { items?: unknown[]; entries?: Record<string, unknown>; toString?: () => string };
    if (Array.isArray(anyV.items)) return anyV.items.map(normalize);
    if (anyV.entries && typeof anyV.entries === 'object') {
      return Object.fromEntries(Object.entries(anyV.entries).map(([k, x]) => [k, normalize(x)]));
    }
    return anyV.toString ? anyV.toString() : v;
  }
  return v;
}
