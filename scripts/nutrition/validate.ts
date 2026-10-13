/**
 * Validate the nutrition domain: reference tables against their schemas, every food file
 * against food.schema.json, id/gtin uniqueness, and cross-references to the tables.
 * Called by scripts/validate.ts; options come from the CLI there.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { DOMAIN, DOMAIN_DIR, flattenCategories, loadRefs, type Food } from './lib.ts';

export type ValidateOptions = { quick?: boolean; extraDir?: string };

/** Returns the number of errors found (0 = clean). Prints each error as it goes. */
export function validateNutrition({ quick = false, extraDir }: ValidateOptions = {}): number {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  const schemaJson = (name: string) => JSON.parse(readFileSync(resolve(DOMAIN_DIR, `schema/${name}.schema.json`), 'utf8'));
  const schema = (name: string) => ajv.compile(schemaJson(name));

  let errors = 0;
  const fail = (file: string, msg: string) => { errors++; console.error(`✗ ${file}: ${msg}`); };

  // 1. Reference tables
  const refs = loadRefs();
  for (const [name, data] of Object.entries(refs)) {
    const v = schema(name);
    if (!v(data)) fail(`${DOMAIN}/${name}.yaml`, ajv.errorsText(v.errors, { separator: '\n    ' }));
  }
  const nutrientIds = new Set(refs.nutrients.map((n) => n.id));
  const allergenIds = new Set(refs.allergens.map((a) => a.id));
  const categoryIds = new Set(flattenCategories(refs.categories).map((c) => c.id));
  for (const n of refs.nutrients) if (n.parent && !nutrientIds.has(n.parent)) fail(`${DOMAIN}/nutrients.yaml`, `${n.id}: unknown parent ${n.parent}`);
  dupes(refs.nutrients.map((n) => n.id), `${DOMAIN}/nutrients.yaml`);
  dupes(refs.units.map((u) => u.id), `${DOMAIN}/units.yaml`);
  dupes(refs.allergens.map((a) => a.id), `${DOMAIN}/allergens.yaml`);
  dupes(flattenCategories(refs.categories).map((c) => c.id), `${DOMAIN}/categories.yaml`);

  // 2. Food files
  const wrapper = ajv.compile({ type: 'array', items: schemaJson('food') });
  const files = [
    ...fg.sync(quick ? ['foods/generic/**/*.yaml'] : ['foods/**/*.yaml'], { cwd: DOMAIN_DIR, absolute: true }),
    ...(extraDir ? fg.sync(['**/*.yaml'], { cwd: resolve(extraDir), absolute: true }) : []),
  ];
  const ids = new Set<string>();
  const gtins = new Set<string>();
  let foods = 0;
  for (const f of files) {
    const data = parse(readFileSync(f, 'utf8'));
    const rel = f.replace(DOMAIN_DIR + '/', `${DOMAIN}/`);
    if (!wrapper(data)) { fail(rel, ajv.errorsText(wrapper.errors, { separator: '\n    ' })); continue; }
    for (const food of data as Food[]) {
      foods++;
      const where = `${rel} › ${food.id}`;
      if (ids.has(food.id)) fail(where, 'duplicate id'); ids.add(food.id);
      if (food.gtin) { if (gtins.has(food.gtin)) fail(where, `duplicate gtin ${food.gtin}`); gtins.add(food.gtin); }
      for (const k of Object.keys(food.nutrients)) if (!nutrientIds.has(k)) fail(where, `unknown nutrient ${k}`);
      for (const k of Object.keys(food.nutrients_per_serving ?? {})) if (!nutrientIds.has(k)) fail(where, `unknown nutrient ${k}`);
      for (const a of [...(food.allergens ?? []), ...(food.traces ?? [])]) if (!allergenIds.has(a)) fail(where, `unknown allergen ${a}`);
      for (const c of food.categories ?? []) if (!categoryIds.has(c)) fail(where, `unknown category ${c}`);
      if (food.kind === 'product' && !food.id.endsWith(food.gtin!)) fail(where, 'product id should be off:<gtin>');
    }
  }

  console.log(`${DOMAIN}: ${files.length} food files, ${foods.toLocaleString()} foods, ${errors} error(s)`);
  return errors;

  function dupes(list: string[], file: string) {
    const seen = new Set<string>();
    for (const x of list) { if (seen.has(x)) fail(file, `duplicate id ${x}`); seen.add(x); }
  }
}
