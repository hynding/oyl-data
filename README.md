# oyl-data

Seed data for [OYL](https://github.com/hynding/oyl). Nutrition first: everything a US
Nutrition Facts label carries, plus ingredients, allergens, barcodes, categories and
household portions, for both branded products (Open Food Facts) and generic foods (USDA).

YAML is the source of truth and what you edit or review. `pnpm build` compiles it into
`dist/oyl-foods.sqlite`, which is what OYL actually loads.

```
nutrients.yaml      canonical nutrient ids, units, FDA Daily Values, OFF/USDA key mapping
units.yaml          g/mg/mcg/ml/oz/cup/tbsp… with conversion factors and aliases
allergens.yaml      FDA big-9 + common extras, mapped from OFF tags
categories.yaml     OYL's own shallow category tree, mapped from OFF/USDA
schema/             JSON Schema for each of the above and for Food records
foods/generic/      unbranded foods (USDA FDC) — hand-curated YAML lists
foods/products/     branded US products (Open Food Facts) — generated, sharded by GTIN
scripts/            extract → shard → validate → build
dist/               build output (gitignored): oyl-foods.sqlite + manifest.json
```

## Setup

```sh
pnpm install
pnpm test        # shard the fixture, validate it — proves the toolchain works
```

## Loading products from Open Food Facts

```sh
pnpm extract:off --describe          # 1. print the live Parquet schema (sanity check after OFF changes)
pnpm extract:off --limit 2000        # 2. sample: US, English, completeness ≥ 0.5 → .cache/off-us.jsonl
pnpm shard:off --out .cache/preview  # 3. look at the YAML before committing to it
pnpm extract:off && pnpm shard:off   # 4. the real thing → foods/products/**
pnpm check                           # 5. validate everything, build dist/oyl-foods.sqlite
```

`extract:off` streams the Parquet from Hugging Face with DuckDB and only fetches the
columns it selects. If you'll rerun it, download `food.parquet` once and pass
`--source path/to/food.parquet`. The filters live in `scripts/extract-off.sql`.

After a shard run, the script prints the most common OFF category tags that mapped to
`other`. Add them to `categories.yaml` and rerun; it's deliberate that the tree starts small.

### How values are normalized

- Nutrients are stored **per 100 g** (or per 100 ml for liquids — see `basis`), in the
  unit declared in `nutrients.yaml`. OFF stores every mass value in grams; `scale` rescales
  to mg/mcg. `nutrients_per_serving` is only filled when the source states it.
- Barcodes are normalized to **GTIN-14**; `gtin_aliases` lists the UPC-A/EAN-13 forms a
  scanner emits, and the SQLite `food_barcodes` table resolves any of them.
- Every record carries `source` (name, id, url, modified date, completeness, license).

## Generic foods (USDA)

OFF is barcode-centric and thin on "banana" or "chicken breast", which is most of what
people log by hand. `foods/generic/` fills that gap from USDA FoodData Central (public
domain). It's hand-curated for now; a `scripts/extract-usda.ts` over the FDC CSV
export (Foundation + SR Legacy, with their `food_portion` table) is the next step.

## Using the build

```sql
-- scan a barcode (any form)
SELECT f.* FROM food_barcodes b JOIN foods f ON f.id = b.food_id WHERE b.barcode = '041196010183';

-- search by name/brand/ingredients
SELECT food_id, name FROM foods_fts WHERE foods_fts MATCH 'peanut butter' ORDER BY rank LIMIT 20;

-- label for one serving, with %DV, in label order
SELECT n.name, fn.per_100 * f.serving_size / 100 AS amount, n.unit,
       100 * fn.per_100 * f.serving_size / 100 / n.dv AS dv_pct
FROM foods f JOIN food_nutrients fn ON fn.food_id = f.id JOIN nutrients n ON n.id = fn.nutrient_id
WHERE f.gtin = '00041196010183' ORDER BY n.sort;
```

## Licenses

Code: MIT. Data: see [LICENSE-DATA.md](LICENSE-DATA.md) — Open Food Facts content is
ODbL 1.0 (attribution + share-alike for derived databases); USDA FDC is public domain.
