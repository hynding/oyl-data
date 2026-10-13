# CLAUDE.md — working in oyl-data

Seed data for OYL (hynding/oyl), kept as reviewable YAML and compiled to SQLite. Read
README.md first for the nutrition pipeline; this file is the rules and the recipe for
adding more.

## Principles

- **YAML is the source of truth; `dist/` is a build artifact.** Fix the mapping or the
  reference tables and regenerate — never hand-edit a generated file (they say so in
  their first line). Hand-curated files (`foods/generic/`, the root `*.yaml` tables) are
  edited directly.
- **Normalize at extract time.** Source-specific keys, units and quirks are mapped onto
  our own ids and units in the extract/shard scripts. Nothing downstream — SQLite, OYL —
  should know what Open Food Facts or USDA call a field.
- **Every record names its source** (`source: {name, id, url, modified, license}`), has a
  stable id of the form `<source>:<source-id>`, and ids never change across refreshes.
- **Small reference tables, grown by evidence.** `categories.yaml` started with ~40
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

Scripts are plain `tsx` ESM in `scripts/`, sharing `scripts/lib.ts` (types, loaders,
GTIN helpers, matchers). `tsconfig.json` allows `.ts` import extensions. Node ≥ 22, pnpm.
`better-sqlite3` and `esbuild` need their build scripts approved (`pnpm-workspace.yaml`).

Before committing script changes: `pnpm test && pnpm typecheck`. Before committing data:
`pnpm check` and look at the `refresh:` line and the `other` category report.

## Layout

```
<table>.yaml        reference tables at the root — one subject each, validated by schema/<table>.schema.json
schema/             JSON Schema 2020-12 for every YAML shape
foods/<kind>/       records; generated kinds are sharded, curated kinds are small hand-written lists
scripts/            extract-<source>.{ts,sql} → shard-<kind>.ts → validate.ts → build.ts + schema.sql
tests/fixtures/     a few representative source rows, including a bad one, for pnpm test
.cache/             big downloads and intermediates (gitignored)
dist/               oyl-foods.sqlite + manifest.json (gitignored; published via release workflow)
```

When the second domain lands, nutrition's root-level files move under `nutrition/`
(`nutrition/{nutrients,units,allergens,categories}.yaml`, `nutrition/foods/`,
`nutrition/schema/`, `scripts/nutrition/`) and each domain gets its own SQLite or its own
table prefix — decide then, not now. Until then the flat layout is fine.

## Adding a new data domain

Work through these in order; most of the thinking is in steps 1–3.

1. **Decide what OYL needs** before looking at sources. Write the target record shape as
   a JSON Schema (`schema/<thing>.schema.json`) with an `id`, a `source` block, and only
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
   tags, grades) becomes a root `<table>.yaml` with its own schema and a mapping from source
   keys to our ids. Records reference these by id; `validate.ts` cross-checks.
5. **Extract** (`scripts/extract-<source>.ts` + `.sql` when the source is tabular): DuckDB
   over the dump, select only needed columns, filter to the US/English subset and the
   cutoff, write JSONL to `.cache/`. Read the live schema first and mark optional columns
   so a renamed upstream field degrades to NULL instead of crashing (see `extract-off.ts`).
6. **Shard** (`scripts/shard-<kind>.ts`): JSONL → normalized records → YAML lists under
   `foods/<kind>/` or `<domain>/<kind>/`. Shard on something that spreads evenly (trailing
   digits of an id, hash prefix), aim for ~1,000 files of similar size, write them
   deterministically (sorted, fixed key order) so diffs are meaningful. Sanitize what the
   source gets wrong (clamp ranges, drop negatives, ignore junk tags) and count what you
   skip. Include the refresh guard: diff against the existing directory and refuse a > 20%
   drop without `--force`.
7. **Validate**: extend `validate.ts` — schema per file plus id uniqueness and
   cross-references to the reference tables.
8. **Build**: add tables to `scripts/schema.sql` and inserts to `build.ts`. One FTS5 table
   per searchable kind. Bump `schema_version` in the manifest when the SQLite layout changes
   in a way OYL must know about.
9. **Fixture + test**: a handful of real source rows (including one malformed) in
   `tests/fixtures/`, wired into `pnpm test`.
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
  converted via `units.yaml`.
- Per-100 basis for anything nutritional; per-serving only when the source states it.
- Text fields: trim and collapse whitespace; keep the source's casing; no HTML.
- Tags/labels: lower-case slugs, language prefix stripped (`en:organic` → `organic`).
- Generated file header: `# <what>. Generated by scripts/<script> — do not hand-edit.`
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
- Real data has negative nutrient values, completeness > 1, serving size 0 — sanitize
  before validating, and keep the validator strict.
