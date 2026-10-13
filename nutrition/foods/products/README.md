# foods/products

Generated from Open Food Facts by `pnpm extract:off && pnpm shard:off`. Do not hand-edit —
fix the mapping in `scripts/shard-products.ts` or the reference tables and regenerate.

Layout: `<gtin14[-3:-1]>/<gtin14[-1]>.yaml` (1,000 files keyed on the trailing digits so
they stay evenly sized), each a YAML list of `Food` records (`schema/food.schema.json`).

Data © Open Food Facts contributors, ODbL 1.0 — see `LICENSE-DATA.md`.
