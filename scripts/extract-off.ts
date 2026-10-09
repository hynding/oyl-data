/**
 * Extract US products from the Open Food Facts Parquet export into .cache/off-us.jsonl.
 *
 *   pnpm fetch:off                         # one-time download of food.parquet to .cache/ (resumable)
 *   pnpm extract:off                       # reads .cache/food.parquet if present, else streams from Hugging Face
 *   pnpm extract:off --source other.parquet
 *   pnpm extract:off --limit 2000          # sample run
 *   pnpm extract:off --describe            # print the live Parquet schema and exit
 *
 * Output is one JSON object per line with the raw OFF columns selected in
 * extract-off.sql. shard-products.ts turns that into YAML.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { CACHE, ROOT } from './lib.ts';

const HF_URL = 'https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
// Prefer a local copy (pnpm fetch:off) — Hugging Face rate-limits DuckDB's many range reads over HTTP.
const LOCAL = resolve(CACHE, 'food.parquet');
const source = opt('source') ?? (existsSync(LOCAL) ? LOCAL : HF_URL);
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

// Always read the live schema first: it's cheap (Parquet footer only) and lets us
// degrade gracefully when OFF renames or drops a column.
const schemaRows = await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet('${source}')`).then((r) => r.getRows()).catch((e: Error) => {
  if (/429/.test(e.message)) {
    console.error('Hugging Face rate-limited the request. Download the file once instead:\n  pnpm fetch:off\nthen rerun this command (it picks up .cache/food.parquet automatically).');
    process.exit(2);
  }
  throw e;
});
const schemaLines = schemaRows.map(([name, type]) => `${name}: ${type}`);
writeFileSync(resolve(CACHE, 'off-schema.txt'), schemaLines.join('\n') + '\n');
const liveColumns = new Set(schemaRows.map(([name]) => String(name)));
if (describe) {
  console.log(schemaLines.join('\n'));
  console.log(`\n(saved to ${resolve(CACHE, 'off-schema.txt')})`);
  process.exit(0);
}

// English text from OFF's list<struct<lang, text>> columns, falling back to the 'main' entry.
await conn.run(`CREATE MACRO en_text(l) AS coalesce(list_filter(l, x -> x.lang = 'en')[1].text, list_filter(l, x -> x.lang = 'main')[1].text)`);

const missing: string[] = [];
const sql = readFileSync(resolve(ROOT, 'scripts/extract-off.sql'), 'utf8')
  .split('\n')
  .map((line) => {
    if (!/--\s*optional/.test(line)) return line;
    const col = optionalColumn(line);
    if (!col || liveColumns.has(col)) return line;
    missing.push(col);
    if (/^\s*AND\b/.test(line)) return '  AND true';
    const alias = line.match(/\bAS\s+([a-z_]+)/)?.[1] ?? col;
    return `  NULL AS ${alias},`;
  })
  .join('\n')
  .replaceAll('{{SOURCE}}', source)
  .replaceAll('{{LIMIT}}', limit ? `LIMIT ${Number(limit)}` : '');
if (missing.length) console.log(`not in this Parquet (left NULL): ${missing.join(', ')}`);

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

/** The column an `-- optional` SQL line depends on: the argument of en_text()/to_json()/coalesce(), else the first identifier. */
function optionalColumn(line: string): string | null {
  const fn = line.match(/\b(?:en_text|to_json|coalesce)\(\s*([a-z_]+)/);
  if (fn) return fn[1];
  return line.replace(/^\s*AND\s+/, '').match(/^\s*([a-z_]+)/)?.[1] ?? null;
}

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
