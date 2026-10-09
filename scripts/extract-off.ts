/**
 * Extract US products from the Open Food Facts Parquet export into .cache/off-us.jsonl.
 *
 *   pnpm extract:off                       # streams from Hugging Face (only needed columns are fetched)
 *   pnpm extract:off --source food.parquet # local copy (faster if you'll rerun)
 *   pnpm extract:off --limit 2000          # sample run
 *   pnpm extract:off --describe            # print the live Parquet schema and exit
 *
 * Output is one JSON object per line with the raw OFF columns selected in
 * extract-off.sql. shard-products.ts turns that into YAML.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { CACHE, ROOT } from './lib.ts';

const HF_URL = 'https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const source = opt('source') ?? HF_URL;
const limit = opt('limit');
const describe = args.includes('--describe');
const out = opt('out') ?? resolve(CACHE, 'off-us.jsonl');

mkdirSync(CACHE, { recursive: true });

const db = await DuckDBInstance.create(':memory:');
const conn = await db.connect();
if (/^https?:/.test(source)) {
  await conn.run('INSTALL httpfs; LOAD httpfs;');
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (proxy) {
    const u = new URL(proxy);
    await conn.run(`SET http_proxy='${u.host}'`);
    if (u.username) await conn.run(`SET http_proxy_username='${decodeURIComponent(u.username)}'`);
    if (u.password) await conn.run(`SET http_proxy_password='${decodeURIComponent(u.password)}'`);
  }
}

if (describe) {
  const r = await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet('${source}')`);
  const lines = r.getRows().map(([name, type]) => `${name}: ${type}`);
  const file = resolve(CACHE, 'off-schema.txt');
  writeFileSync(file, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  console.log(`\n(saved to ${file})`);
  process.exit(0);
}

const sql = readFileSync(resolve(ROOT, 'scripts/extract-off.sql'), 'utf8')
  .replace('{{SOURCE}}', source)
  .replace('{{LIMIT}}', limit ? `LIMIT ${Number(limit)}` : '');

console.log(`source: ${source}`);
console.log(`output: ${out}`);
const started = Date.now();

const result = await conn.stream(sql);
const columns = result.columnNames();
const ws = createWriteStream(out);
let n = 0;
for (;;) {
  const chunk = await result.fetchChunk();
  if (!chunk || chunk.rowCount === 0) break;
  for (const row of chunk.getRows()) {
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => { obj[c] = normalize(row[i]); });
    ws.write(JSON.stringify(obj) + '\n');
    n++;
  }
  if (n % 50_000 < chunk.rowCount) process.stdout.write(`  ${n.toLocaleString()} rows\r`);
}
ws.end();
console.log(`\n${n.toLocaleString()} products in ${((Date.now() - started) / 1000).toFixed(0)}s`);

/** DuckDB values → plain JSON (BigInt, LIST, STRUCT wrappers). */
function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === 'object') {
    const anyV = v as { items?: unknown[]; entries?: Record<string, unknown>; toString?: () => string };
    if (Array.isArray(anyV.items)) return anyV.items.map(normalize);          // DuckDBListValue
    if (anyV.entries && typeof anyV.entries === 'object') {                   // DuckDBStructValue
      return Object.fromEntries(Object.entries(anyV.entries).map(([k, x]) => [k, normalize(x)]));
    }
    return anyV.toString ? anyV.toString() : v;
  }
  return v;
}
