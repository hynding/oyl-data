# CLAUDE.md — working in oyl-data

Seed data for OYL (hynding/oyl), kept as reviewable YAML and compiled to SQLite. Read
README.md first for the nutrition pipeline; this file is the rules and the recipe for
adding more.

## Principles

- **YAML is the source of truth; `dist/` is a build artifact.** Fix the mapping or the
  reference tables and regenerate — never hand-edit a generated file (they say so in
  their first line). Hand-curated files (`nutrition/foods/generic/`, the `<domain>/*.yaml`
  tables) are edited directly.
- **Normalize at extract time.** Source-specific keys, units and quirks are mapped onto
  our own ids and units in the extract/shard scripts. Nothing downstream — SQLite, OYL —
  should know what Open Food Facts or USDA call a field.
- **Every record names its source** (`source: {name, id, url, modified, license}`), has a
  stable id of the form `<source>:<source-id>`, and ids never change across refreshes.
- **Small reference tables, grown by evidence.** `nutrition/categories.yaml` started with ~40
  entries; the shard step reports what fell into `other`, and we add what shows up. Don't
  pre-build taxonomies.
- **Budget the repo.** Committed YAML per domain should stay under ~100 MB. Pick a
  popularity/quality cutoff that gets there (nutrition uses `unique_scans_n ≥ 2`) and let
  OYL fetch the long tail live. Explain the cutoff in the README with the `--stats` numbers
  that justified it.
- **Pragmatic over clever.** One DuckDB query, one TS transform, one SQLite. No
  incremental sync, no deltas, no framework. Refreshes are full re-runs; git is the diff.

## Commands

```sh
pnpm test                 # fixture through shard + validate; run after touching scripts/
pnpm check                # typecheck + validate all YAML + build SQLite (what CI runs)
pnpm extract:off [--stats | --describe | --limit N | --min-scans N | --source file]
pnpm shard:off [--out dir | --limit N | --force]
pnpm validate [--quick | --dir X]
pnpm build [--out file]
```

Scripts are plain `tsx` ESM. `scripts/lib.ts` holds what every domain shares (ROOT/CACHE/DIST,
`loadYaml`, `round`, `slug`, `args`/`opt`/`flag`); `scripts/<domain>/lib.ts` holds that domain's
types, loaders and helpers. `scripts/validate.ts` and `scripts/build.ts` are thin orchestrators
that call `validate<Domain>()` / `build<Domain>(db)` from each domain and own the exit code,
the SQLite file, the `meta` table and `manifest.json`. `tsconfig.json` allows `.ts` import
extensions. Node ≥ 22, pnpm.
`better-sqlite3` and `esbuild` need their build scripts approved (`pnpm-workspace.yaml`).

Before committing script changes: `pnpm test && pnpm typecheck`. Before committing data:
`pnpm check` and look at the `refresh:` line and the `other` category report.

## Layout

```
<domain>/                   one directory per domain (nutrition/ today)
  <table>.yaml              reference tables — one subject each, validated by <domain>/schema/<table>.schema.json
  schema/                   JSON Schema 2020-12 for every YAML shape in the domain
  <kind>/ or foods/<kind>/  records; generated kinds are sharded, curated kinds are small hand-written lists
scripts/
  lib.ts                    shared paths, loaders, CLI helpers
  validate.ts, build.ts     orchestrators; add one import + one call per domain
  <domain>/                 lib.ts, extract-<source>.{ts,sql}, shard-<kind>.ts, validate.ts, build.ts, schema.sql
tests/fixtures/<domain>/    a few representative source rows, including a bad one, for pnpm test
.cache/                     big downloads and intermediates (gitignored)
dist/                       oyl-data.sqlite + manifest.json (gitignored; published via release workflow)
```

All domains build into the one SQLite. Table names are unprefixed while there's no clash
(`foods`, `nutrients`, …); a new domain whose natural names collide prefixes its own tables
(`activity_…`), never renames an existing one. `manifest.json` carries a top-level
`schema_version` plus one per domain.

## Adding a new data domain

Work through these in order; most of the thinking is in steps 1–3.

1. **Decide what OYL needs** before looking at sources. Write the target record shape as
   a JSON Schema (`<domain>/schema/<thing>.schema.json`) with an `id`, a `source` block, and only
   the fields OYL will display or query. Resist importing everything a source offers.
2. **Pick the source by license and bulk-export availability, in that order.** Prefer
   public domain (US government data: USDA, NIH, NOAA, BLS, Census) or CC0/CC-BY; ODbL
   (OFF, OpenStreetMap) is fine but share-alike — record it in `LICENSE-DATA.md`. A source
   with a bulk download (CSV/Parquet/JSONL dump) beats a nicer API: APIs rate-limit, dumps
   are one file. If only an API exists, write a fetcher that caches raw responses to
   `.cache/` and is resumable; never page an API inside the transform.
3. **Size it.** Add a `--stats` mode to the extract script that prints counts at several
   quality/popularity cutoffs over the raw source, and choose the cutoff that keeps the
   domain under budget. Put the numbers in the README.
4. **Reference tables first.** Anything enumerable that records point at (units, categories,
   tags, grades) becomes `<domain>/<table>.yaml` with its own schema and a mapping from source
   keys to our ids. Records reference these by id; the domain's `validate.ts` cross-checks.
5. **Extract** (`scripts/<domain>/extract-<source>.ts` + `.sql` when the source is tabular): DuckDB
   over the dump, select only needed columns, filter to the US/English subset and the
   cutoff, write JSONL to `.cache/`. Read the live schema first and mark optional columns
   so a renamed upstream field degrades to NULL instead of crashing (see `nutrition/extract-off.ts`).
6. **Shard** (`scripts/<domain>/shard-<kind>.ts`): JSONL → normalized records → YAML lists under
   `<domain>/<kind>/`. Shard on something that spreads evenly (trailing
   digits of an id, hash prefix), aim for ~1,000 files of similar size, write them
   deterministically (sorted, fixed key order) so diffs are meaningful. Sanitize what the
   source gets wrong (clamp ranges, drop negatives, ignore junk tags) and count what you
   skip. Clear only the generated `NN/` directories, not curated files beside them. Include
   the refresh guard: diff against the existing directory and refuse a > 20% drop without
   `--force`.
7. **Validate**: `scripts/<domain>/validate.ts` exporting `validate<Domain>(options): number`
   (error count) — schema per file plus id uniqueness and cross-references to the reference
   tables. Register it in `scripts/validate.ts`.
8. **Build**: `scripts/<domain>/schema.sql` + `scripts/<domain>/build.ts` exporting
   `build<Domain>(db)` that creates its tables and returns counts for the manifest. Register it
   in `scripts/build.ts`. One FTS5 table per searchable kind. Bump the domain's
   `SCHEMA_VERSION` (and the top-level one in `scripts/build.ts`) when the SQLite layout
   changes in a way OYL must know about.
9. **Fixture + test**: a handful of real source rows (including one malformed) in
   `tests/fixtures/<domain>/`, wired into `pnpm test`.
10. **Document**: README section (source, cutoff and why, how values are normalized,
    refresh cadence), `LICENSE-DATA.md` entry, and attribution text OYL must display.

Candidate domains and sources already scouted, for when they come up:

- **Exercise / activity**: Compendium of Physical Activities (MET values; research license,
  check terms), or build a small curated table — no good bulk open source exists.
- **Recipes**: no clean open bulk source; USDA FDC "SR Legacy" has some composite dishes.
  Likely user-authored in OYL, with this repo supplying only ingredients.
- **Medications / supplements**: NIH DSLD (Dietary Supplement Label Database, public domain,
  bulk CSV) for supplements; openFDA NDC directory (public domain) for medications, with
  RxNorm (free, but needs a UMLS account) only if OYL needs ingredient-level normalization.
- **Sleep, habits, finance categories, chores**: small curated YAML, no external source.

## Conventions

- Ids: `<source>:<source-id>` (`off:<gtin14>`, `fdc:<fdcId>`, `manual:<slug>`). Never
  change an id; a renamed or merged record keeps its id and gets an `aliases` entry.
- Units: SI in storage (g, mg, mcg, ml, kcal); household/imperial units are display-side,
  converted via `nutrition/units.yaml`.
- Per-100 basis for anything nutritional; per-serving only when the source states it.
- Text fields: trim and collapse whitespace; keep the source's casing; no HTML.
- Tags/labels: lower-case slugs, language prefix stripped (`en:organic` → `organic`).
- Generated file header: `# <what>. Generated by scripts/<domain>/<script> — do not hand-edit.`
- Commit messages explain the data decision, not just the code change (e.g. why a cutoff
  moved). Trailer: `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`.
- Don't push or tag unless asked. Tagging `v*` publishes a release.

## Things that bit us (don't repeat)

- Hugging Face rate-limits DuckDB's HTTP range reads → download the Parquet once
  (`pnpm fetch:off`, or `hf download` with a token) and read locally.
- `String.replace` replaced only the first `{{PLACEHOLDER}}` — use `replaceAll`.
- OFF Parquet lacks `brand_owner`; `nutrition_data_per` is the authority on 100 g vs 100 ml;
  mass nutrients are stored in grams regardless of display unit; `images[].key` + `rev`
  gives the selected (cropped) image, `imgid` the raw upload.
- OFF `completeness` cliffs at 0.7 (needs photos); `unique_scans_n` is the useful quality
  signal. `en:null` / `en:undefined` appear as category tags.
- Sharding by GTIN prefix put 7k products in one file; trailing digits spread evenly.
- `rmSync(outDir)` in the shard step deleted the products README; clear `NN/` dirs only.
- Real data has negative nutrient values, completeness > 1, serving size 0 — sanitize
  before validating, and keep the validator strict.
