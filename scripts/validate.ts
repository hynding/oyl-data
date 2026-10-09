/**
 * Validate every YAML file against its JSON Schema and cross-check ids.
 *   pnpm validate            # everything
 *   pnpm validate --quick    # reference tables + generic foods only (skips product shards)
 *   pnpm validate --dir X    # also validate food YAML under directory X (used by `pnpm test`)
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { ROOT, flattenCategories, loadRefs, type Food } from './lib.ts';

const quick = process.argv.includes('--quick');
const extraDir = process.argv[process.argv.indexOf('--dir') + 1];
const hasExtra = process.argv.includes('--dir');
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const schema = (name: string) => ajv.compile(JSON.parse(readFileSync(resolve(ROOT, `schema/${name}.schema.json`), 'utf8')));

let errors = 0;
const fail = (file: string, msg: string) => { errors++; console.error(`✗ ${file}: ${msg}`); };

// 1. Reference tables
const refs = loadRefs();
for (const [name, data] of Object.entries(refs)) {
  const v = schema(name);
  if (!v(data)) fail(`${name}.yaml`, ajv.errorsText(v.errors, { separator: '\n    ' }));
}
const nutrientIds = new Set(refs.nutrients.map((n) => n.id));
const allergenIds = new Set(refs.allergens.map((a) => a.id));
const categoryIds = new Set(flattenCategories(refs.categories).map((c) => c.id));
for (const n of refs.nutrients) if (n.parent && !nutrientIds.has(n.parent)) fail('nutrients.yaml', `${n.id}: unknown parent ${n.parent}`);
dupes(refs.nutrients.map((n) => n.id), 'nutrients.yaml');
dupes(refs.units.map((u) => u.id), 'units.yaml');
dupes(refs.allergens.map((a) => a.id), 'allergens.yaml');
dupes([...flattenCategories(refs.categories)].map((c) => c.id), 'categories.yaml');

// 2. Food files
const foodSchema = JSON.parse(readFileSync(resolve(ROOT, 'schema/food.schema.json'), 'utf8'));
const wrapper = ajv.compile({ type: 'array', items: foodSchema });
const files = [
  ...fg.sync(quick ? ['foods/generic/**/*.yaml'] : ['foods/**/*.yaml'], { cwd: ROOT }),
  ...(hasExtra ? fg.sync(['**/*.yaml'], { cwd: resolve(extraDir), absolute: true }) : []),
];
const ids = new Set<string>();
const gtins = new Set<string>();
let foods = 0;
for (const f of files) {
  const data = parse(readFileSync(resolve(ROOT, f), 'utf8')); // absolute paths pass through resolve unchanged
  if (!wrapper(data)) { fail(f, ajv.errorsText(wrapper.errors, { separator: '\n    ' })); continue; }
  for (const food of data as Food[]) {
    foods++;
    const where = `${f} › ${food.id}`;
    if (ids.has(food.id)) fail(where, 'duplicate id'); ids.add(food.id);
    if (food.gtin) { if (gtins.has(food.gtin)) fail(where, `duplicate gtin ${food.gtin}`); gtins.add(food.gtin); }
    for (const k of Object.keys(food.nutrients)) if (!nutrientIds.has(k)) fail(where, `unknown nutrient ${k}`);
    for (const k of Object.keys(food.nutrients_per_serving ?? {})) if (!nutrientIds.has(k)) fail(where, `unknown nutrient ${k}`);
    for (const a of [...(food.allergens ?? []), ...(food.traces ?? [])]) if (!allergenIds.has(a)) fail(where, `unknown allergen ${a}`);
    for (const c of food.categories ?? []) if (!categoryIds.has(c)) fail(where, `unknown category ${c}`);
    if (food.kind === 'product' && !food.id.endsWith(food.gtin!)) fail(where, 'product id should be off:<gtin>');
  }
}

console.log(`${files.length} food files, ${foods.toLocaleString()} foods, ${errors} error(s)`);
process.exit(errors ? 1 : 0);

function dupes(list: string[], file: string) {
  const seen = new Set<string>();
  for (const x of list) { if (seen.has(x)) fail(file, `duplicate id ${x}`); seen.add(x); }
}
