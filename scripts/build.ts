/**
 * Compile the YAML into dist/oyl-foods.sqlite (+ dist/manifest.json).
 * This is what OYL ships/loads; the YAML is the editable source of truth.
 *
 *   pnpm build
 *   pnpm build --out path/to/oyl-foods.sqlite
 */
import Database from 'better-sqlite3';
import fg from 'fast-glob';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { DIST, ROOT, flattenCategories, loadRefs, type Food } from './lib.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--out');
const out = i >= 0 ? resolve(args[i + 1]) : resolve(DIST, 'oyl-foods.sqlite');
mkdirSync(resolve(out, '..'), { recursive: true });
rmSync(out, { force: true });

const db = new Database(out);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');
db.exec(readFileSync(resolve(ROOT, 'scripts/schema.sql'), 'utf8'));

const refs = loadRefs();
const started = Date.now();

const tx = db.transaction(() => {
  const insNutrient = db.prepare('INSERT INTO nutrients (id, name, unit, dv, label, parent, note, sort) VALUES (?,?,?,?,?,?,?,?)');
  refs.nutrients.forEach((n, idx) => insNutrient.run(n.id, n.name, n.unit, n.dv, n.label, n.parent ?? null, n.note ?? null, idx));

  const insUnit = db.prepare('INSERT INTO units (id, name, kind, base, aliases) VALUES (?,?,?,?,?)');
  for (const u of refs.units) insUnit.run(u.id, u.name, u.kind, u.base, JSON.stringify(u.aliases));

  const insAllergen = db.prepare('INSERT INTO allergens (id, name, fda) VALUES (?,?,?)');
  for (const a of refs.allergens) insAllergen.run(a.id, a.name, a.fda ? 1 : 0);

  const insCategory = db.prepare('INSERT INTO categories (id, name, parent, sort) VALUES (?,?,?,?)');
  flattenCategories(refs.categories).forEach((c, idx) => insCategory.run(c.id, c.name, c.parent, idx));
});
tx();

const insFood = db.prepare(`INSERT INTO foods (
  id, kind, name, brand, brand_owner, description, gtin, quantity, net_grams, basis, density_g_per_ml,
  serving_size, serving_unit, serving_description, servings_per_container,
  ingredients_text, nova, nutriscore, image_front, image_nutrition, image_ingredients,
  source, source_id, source_url, source_modified, completeness
) VALUES (@id, @kind, @name, @brand, @brand_owner, @description, @gtin, @quantity, @net_grams, @basis, @density,
  @serving_size, @serving_unit, @serving_description, @servings_per_container,
  @ingredients_text, @nova, @nutriscore, @image_front, @image_nutrition, @image_ingredients,
  @source, @source_id, @source_url, @source_modified, @completeness)`);
const insNut = db.prepare('INSERT INTO food_nutrients (food_id, nutrient_id, per_100, per_serving) VALUES (?,?,?,?)');
const insBarcode = db.prepare('INSERT OR IGNORE INTO food_barcodes (barcode, food_id) VALUES (?,?)');
const insAllergenLink = db.prepare('INSERT OR IGNORE INTO food_allergens (food_id, allergen_id, kind) VALUES (?,?,?)');
const insCatLink = db.prepare('INSERT OR IGNORE INTO food_categories (food_id, category_id) VALUES (?,?)');
const insLabel = db.prepare('INSERT OR IGNORE INTO food_labels (food_id, label) VALUES (?,?)');
const insPortion = db.prepare('INSERT INTO food_portions (food_id, description, grams, amount, unit) VALUES (?,?,?,?,?)');
const insFts = db.prepare('INSERT INTO foods_fts (food_id, name, brand, description, ingredients) VALUES (?,?,?,?,?)');

const files = fg.sync(['foods/**/*.yaml'], { cwd: ROOT }).sort();
let count = { product: 0, generic: 0 };
const insertFile = db.transaction((foods: Food[]) => {
  for (const f of foods) {
    insFood.run({
      id: f.id, kind: f.kind, name: f.name, brand: f.brand ?? null, brand_owner: f.brand_owner ?? null,
      description: f.description ?? null, gtin: f.gtin ?? null, quantity: f.quantity ?? null, net_grams: f.net_grams ?? null,
      basis: f.basis ?? '100g', density: f.density_g_per_ml ?? null,
      serving_size: f.serving?.size ?? null, serving_unit: f.serving?.unit ?? null,
      serving_description: f.serving?.description ?? null, servings_per_container: f.serving?.per_container ?? null,
      ingredients_text: f.ingredients?.text ?? null, nova: f.nova ?? null, nutriscore: f.nutriscore ?? null,
      image_front: f.images?.front ?? null, image_nutrition: f.images?.nutrition ?? null, image_ingredients: f.images?.ingredients ?? null,
      source: f.source.name, source_id: f.source.id, source_url: f.source.url ?? null,
      source_modified: f.source.modified ?? null, completeness: f.source.completeness ?? null,
    });
    for (const [nid, v] of Object.entries(f.nutrients)) insNut.run(f.id, nid, v, f.nutrients_per_serving?.[nid] ?? null);
    if (f.gtin) { insBarcode.run(f.gtin, f.id); for (const a of f.gtin_aliases ?? []) insBarcode.run(a, f.id); }
    for (const a of f.allergens ?? []) insAllergenLink.run(f.id, a, 'contains');
    for (const a of f.traces ?? []) insAllergenLink.run(f.id, a, 'traces');
    for (const c of f.categories ?? []) insCatLink.run(f.id, c);
    for (const l of f.labels ?? []) insLabel.run(f.id, l);
    for (const p of f.portions ?? []) insPortion.run(f.id, p.description, p.grams, p.amount ?? null, p.unit ?? null);
    insFts.run(f.id, f.name, f.brand ?? '', f.description ?? '', f.ingredients?.text ?? '');
    count[f.kind]++;
  }
});
for (const [idx, file] of files.entries()) {
  insertFile(parse(readFileSync(resolve(ROOT, file), 'utf8')) as Food[]);
  if (idx % 50 === 0) process.stdout.write(`  ${idx + 1}/${files.length} files\r`);
}

const meta = {
  built_at: new Date().toISOString(),
  schema_version: 1,
  products: count.product,
  generic: count.generic,
  nutrients: refs.nutrients.length,
  categories: flattenCategories(refs.categories).length,
  licenses: { off: 'ODbL-1.0 — https://opendatacommons.org/licenses/odbl/1-0/', fdc: 'CC0 (public domain)' },
};
const insMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?,?)');
for (const [k, v] of Object.entries(meta)) insMeta.run(k, typeof v === 'string' ? v : JSON.stringify(v));
db.exec("INSERT INTO foods_fts(foods_fts) VALUES ('optimize'); VACUUM;");
db.close();

writeFileSync(resolve(out, '..', 'manifest.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`\n${out}: ${count.product.toLocaleString()} products + ${count.generic.toLocaleString()} generic foods in ${((Date.now() - started) / 1000).toFixed(1)}s`);
