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
pnpm fetch:off                       # 1. download food.parquet (a few GB, resumable) to .cache/
pnpm extract:off --describe          # 2. print the Parquet schema (sanity check after OFF changes)
pnpm extract:off --limit 2000        # 3. sample: US, English, completeness ≥ 0.5 → .cache/off-us.jsonl
pnpm shard:off --out .cache/preview  # 4. look at the YAML before committing to it
pnpm extract:off && pnpm shard:off   # 5. the real thing → foods/products/**
pnpm check                           # 6. validate everything, build dist/oyl-foods.sqlite
```

### How much to seed

OFF has ~290k US products with usable nutrition data — ~500 MB of YAML, too much for a
git repo and mostly long tail. `extract:off` therefore defaults to products that at least
two different people have scanned (`unique_scans_n ≥ 2`): ~28k products, ~55 MB. Run
`pnpm extract:off --stats` to see the counts at other cutoffs and pass `--min-scans N`
to change it (`0` disables the filter). For a barcode that isn't seeded, OYL should fall
back to the OFF API (`https://world.openfoodfacts.org/api/v2/product/<code>`) and cache
the result; this repo is the hot set, not the universe.

`extract:off` uses `.cache/food.parquet` when it exists. Without it, DuckDB streams the
file from Hugging Face with HTTP range requests, which works for a `--describe` but gets
rate-limited (HTTP 429) quickly — hence the one-time download. The filters live in
`scripts/extract-off.sql`; columns marked `-- optional` are nulled if OFF drops them.

After a shard run, the script prints the most common OFF category tags that mapped to
`other`. Add them to `categories.yaml` and rerun; it's deliberate that the tree starts small.

### How values are normalized

- Nutrients are stored **per 100 g** (or per 100 ml for liquids — see `basis`), in the
  unit declared in `nutrients.yaml`. OFF stores every mass value in grams; `scale` rescales
  to mg/mcg. `nutrients_per_serving` is only filled when the source states it.
- Barcodes are normalized to **GTIN-14**; `gtin_aliases` lists the UPC-A/EAN-13 forms a
  scanner emits, and the SQLite `food_barcodes` table resolves any of them.
- Every record carries `source` (name, id, url, modified date, completeness, license).

## Refreshing

Quarterly is plenty. Re-download, re-run, let git show the diff:

```sh
pnpm fetch:off && pnpm extract:off && pnpm shard:off && pnpm check
git add foods/products && git commit -m "Refresh OFF seed $(date +%Y-%m-%d)"
```

`shard:off` compares against the existing `foods/products/` first and prints
`refresh: 27,053 → 27,410 products (+900 new, −543 gone)`. If the count would drop more
than 20% it refuses — that almost always means OFF changed its export or the filter broke,
not that products vanished — and `--force` overrides. Ids are `off:<gtin14>` and never
change, so anything in OYL that references a food survives a refresh; OYL should mark a
food that disappears from the seed as archived rather than delete it.

To publish a build, tag the commit: `git tag v2026.10 && git push --tags`. The release
workflow runs `pnpm check` and attaches `oyl-foods.sqlite.gz`, `manifest.json` and
checksums to a GitHub Release. OYL pins a tag and checks `schema_version` in the manifest.

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
