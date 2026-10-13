# oyl-data

Seed data for [OYL](https://github.com/hynding/oyl), organized as YAML and compiled to
SQLite. Nutrition is the first domain: everything a US Nutrition Facts label carries, plus
ingredients, allergens, barcodes, categories and household portions, for branded products
(Open Food Facts) and generic foods (USDA). Other domains will follow the same pattern —
see [CLAUDE.md](CLAUDE.md) for the conventions.

YAML is the source of truth and what you edit or review. `pnpm build` compiles every
domain into one `dist/oyl-data.sqlite`, which is what OYL actually loads.

```
nutrition/                  the nutrition domain
  nutrients.yaml            canonical nutrient ids, units, FDA Daily Values, OFF/USDA key mapping
  units.yaml                g/mg/mcg/ml/oz/cup/tbsp… with conversion factors and aliases
  allergens.yaml            FDA big-9 + common extras, mapped from OFF tags
  categories.yaml           OYL's own shallow category tree, mapped from OFF/USDA
  schema/                   JSON Schema for each of the above and for Food records
  foods/generic/            unbranded foods (USDA FDC) — hand-curated YAML lists
  foods/products/           branded US products (Open Food Facts) — generated, 1,000 shards by GTIN
scripts/
  lib.ts                    paths, YAML loader, CLI helpers shared by every domain
  validate.ts, build.ts     orchestrators: call each domain's validate/build, write the manifest
  nutrition/                extract-off.{ts,sql} → shard-products.ts → validate.ts → build.ts + schema.sql
tests/fixtures/<domain>/    a tiny source sample that `pnpm test` runs end to end
.github/workflows/          check on PRs/main; release (SQLite as a GitHub Release asset) on v* tags
.cache/                     gitignored: the 8 GB food.parquet, extracted JSONL, previews
dist/                       gitignored: oyl-data.sqlite + manifest.json
```

A second domain gets its own top-level directory, `scripts/<domain>/`, and its tables in the
same SQLite — see [CLAUDE.md](CLAUDE.md) for the recipe.

## Setup

```sh
pnpm install
pnpm test        # shard the fixture, validate it — proves the toolchain works
```

## Loading products from Open Food Facts

```sh
pnpm fetch:off                       # 1. download food.parquet (a few GB, resumable) to .cache/
pnpm extract:off --describe          # 2. print the Parquet schema (sanity check after OFF changes)
pnpm extract:off --limit 2000        # 3. sample → .cache/off-us.jsonl (US, English, completeness ≥ 0.5, scans ≥ 2)
pnpm shard:off --out .cache/preview  # 4. look at the YAML before committing to it
pnpm extract:off && pnpm shard:off   # 5. the real thing → nutrition/foods/products/**
pnpm check                           # 6. typecheck, validate everything, build dist/oyl-data.sqlite
```

### How much to seed

OFF has ~290k US products with usable nutrition data — ~500 MB of YAML, too much for a
git repo and mostly long tail. `extract:off` therefore defaults to products that at least
two different people have scanned (`unique_scans_n ≥ 2`): ~28k products, ~55 MB. Run
`pnpm extract:off --stats` to see the counts at other cutoffs and pass `--min-scans N`
to change it (`1` ≈ 70k / 130 MB; `0` disables the filter). For a barcode that isn't seeded, OYL should fall
back to the OFF API (`https://world.openfoodfacts.org/api/v2/product/<code>`) and cache
the result; this repo is the hot set, not the universe.

`extract:off` uses `.cache/food.parquet` when it exists. Without it, DuckDB streams the
file from Hugging Face with HTTP range requests, which works for a `--describe` but gets
rate-limited (HTTP 429) quickly — hence the one-time download. The filters live in
`scripts/nutrition/extract-off.sql`; columns marked `-- optional` are nulled if OFF drops them.

After a shard run, the script prints the most common OFF category tags that mapped to
`other`. Add them to `nutrition/categories.yaml` and rerun; it's deliberate that the tree starts small.

### How values are normalized

- Nutrients are stored **per 100 g** (or per 100 ml for liquids — see `basis`), in the
  unit declared in `nutrition/nutrients.yaml`. OFF stores every mass value in grams; `scale` rescales
  to mg/mcg. `nutrients_per_serving` is only filled when the source states it.
- Barcodes are normalized to **GTIN-14**; `gtin_aliases` lists the UPC-A/EAN-13 forms a
  scanner emits, and the SQLite `food_barcodes` table resolves any of them.
- Every record carries `source` (name, id, url, modified date, completeness, license).

## Refreshing

Quarterly is plenty. Re-download, re-run, let git show the diff:

```sh
pnpm fetch:off && pnpm extract:off && pnpm shard:off && pnpm check
git add nutrition/foods/products && git commit -m "Refresh OFF seed $(date +%Y-%m-%d)"
```

`shard:off` compares against the existing `nutrition/foods/products/` first and prints
`refresh: 27,053 → 27,410 products (+900 new, −543 gone)`. If the count would drop more
than 20% it refuses — that almost always means OFF changed its export or the filter broke,
not that products vanished — and `--force` overrides. Ids are `off:<gtin14>` and never
change, so anything in OYL that references a food survives a refresh; OYL should mark a
food that disappears from the seed as archived rather than delete it.

To publish a build, tag the commit: `git tag v2026.10 && git push --tags`. The release
workflow runs `pnpm check` and attaches `oyl-data.sqlite.gz`, `manifest.json` and
checksums to a GitHub Release. OYL pins a tag and checks `schema_version` in the manifest.

## Generic foods (USDA)

OFF is barcode-centric and thin on "banana" or "chicken breast", which is most of what
people log by hand. `nutrition/foods/generic/` fills that gap from USDA FoodData Central (public
domain). It's hand-curated for now; a `scripts/nutrition/extract-usda.ts` over the FDC CSV
export (Foundation + SR Legacy, with their `food_portion` table) is the next step.

## Using the build

```sql
-- scan a barcode (any form)
SELECT f.* FROM food_barcodes b JOIN foods f ON f.id = b.food_id WHERE b.barcode = '041196010183';

-- search by name/brand/ingredients
SELECT food_id, name FROM foods_fts WHERE foods_fts MATCH 'peanut butter' ORDER BY rank LIMIT 20;

-- Nutrition Facts for one serving, with %DV, in label order
-- (prefer the label-stated per-serving value; derive from per-100 otherwise)
SELECT n.name,
       coalesce(fn.per_serving, fn.per_100 * f.serving_size / 100) AS amount, n.unit,
       100 * coalesce(fn.per_serving, fn.per_100 * f.serving_size / 100) / n.dv AS dv_pct
FROM foods f JOIN food_nutrients fn ON fn.food_id = f.id JOIN nutrients n ON n.id = fn.nutrient_id
WHERE f.gtin = '00041196010183' AND n.label = 'required' ORDER BY n.sort;

-- a generic food by household portion
SELECT p.description, n.name, round(fn.per_100 * p.grams / 100, 1) AS amount, n.unit
FROM foods f JOIN food_portions p ON p.food_id = f.id
JOIN food_nutrients fn ON fn.food_id = f.id JOIN nutrients n ON n.id = fn.nutrient_id
WHERE f.id = 'fdc:173944' AND n.id IN ('energy', 'protein', 'fiber');
```

`manifest.json` next to the SQLite carries a top-level `schema_version`, per-domain versions
and counts, and a build timestamp; check `schema_version` before loading.

## Licenses

Code: MIT. Data: see [LICENSE-DATA.md](LICENSE-DATA.md) — Open Food Facts content is
ODbL 1.0 (attribution + share-alike for derived databases); USDA FDC is public domain.
