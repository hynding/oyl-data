# foods/products

Generated from Open Food Facts by `pnpm extract:off && pnpm shard:off`. Do not hand-edit —
fix the mapping in `scripts/shard-products.ts` or the reference tables and regenerate.

Layout: `<gtin14[2:4]>/<gtin14[4:6]>.yaml`, each a YAML list of `Food` records
(`schema/food.schema.json`). US UPC-A codes pad to `00…`, so most files live under `00/`.

Data © Open Food Facts contributors, ODbL 1.0 — see `LICENSE-DATA.md`.
