-- SQLite schema for dist/oyl-foods.sqlite. Mirrors the YAML; OYL reads this, never the YAML.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE nutrients (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  unit    TEXT NOT NULL,        -- g | mg | mcg | kcal
  dv      REAL,                 -- FDA Daily Value, NULL = no %DV
  label   TEXT NOT NULL,        -- required | voluntary | extra
  parent  TEXT REFERENCES nutrients(id),
  note    TEXT,
  sort    INTEGER NOT NULL      -- Nutrition Facts label order
);

CREATE TABLE units (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL,        -- mass | volume | energy | count
  base    REAL NOT NULL,        -- multiplier to g / ml / kcal
  aliases TEXT NOT NULL         -- JSON array
);

CREATE TABLE allergens (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fda  INTEGER NOT NULL         -- 1 = FDA major allergen
);

CREATE TABLE categories (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  parent TEXT REFERENCES categories(id),
  sort   INTEGER NOT NULL
);

CREATE TABLE foods (
  id                     TEXT PRIMARY KEY,   -- off:<gtin14> | fdc:<fdc_id> | manual:<slug>
  kind                   TEXT NOT NULL,      -- product | generic
  name                   TEXT NOT NULL,
  brand                  TEXT,
  brand_owner            TEXT,
  description            TEXT,
  gtin                   TEXT,               -- GTIN-14
  quantity               TEXT,               -- as printed
  net_grams              REAL,
  basis                  TEXT NOT NULL,      -- 100g | 100ml  (what food_nutrients.per_100 means)
  density_g_per_ml       REAL,
  serving_size           REAL,
  serving_unit           TEXT,               -- g | ml
  serving_description    TEXT,
  servings_per_container REAL,
  ingredients_text       TEXT,
  nova                   INTEGER,
  nutriscore             TEXT,
  image_front            TEXT,
  image_nutrition        TEXT,
  image_ingredients      TEXT,
  source                 TEXT NOT NULL,      -- off | fdc | manual
  source_id              TEXT NOT NULL,
  source_url             TEXT,
  source_modified        TEXT,               -- ISO date
  completeness           REAL
);
CREATE INDEX foods_gtin ON foods(gtin);
CREATE INDEX foods_kind ON foods(kind);
CREATE INDEX foods_brand ON foods(brand);

CREATE TABLE food_nutrients (
  food_id     TEXT NOT NULL REFERENCES foods(id),
  nutrient_id TEXT NOT NULL REFERENCES nutrients(id),
  per_100     REAL NOT NULL,                 -- per foods.basis, in nutrients.unit
  per_serving REAL,                          -- only when label-stated by the source
  PRIMARY KEY (food_id, nutrient_id)
) WITHOUT ROWID;

-- Every form a scanner might emit → food. Includes the GTIN-14 itself.
CREATE TABLE food_barcodes (
  barcode TEXT PRIMARY KEY,
  food_id TEXT NOT NULL REFERENCES foods(id)
) WITHOUT ROWID;

CREATE TABLE food_allergens (
  food_id     TEXT NOT NULL REFERENCES foods(id),
  allergen_id TEXT NOT NULL REFERENCES allergens(id),
  kind        TEXT NOT NULL,                 -- contains | traces
  PRIMARY KEY (food_id, allergen_id, kind)
) WITHOUT ROWID;

CREATE TABLE food_categories (
  food_id     TEXT NOT NULL REFERENCES foods(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  PRIMARY KEY (food_id, category_id)
) WITHOUT ROWID;
CREATE INDEX food_categories_cat ON food_categories(category_id);

CREATE TABLE food_labels (
  food_id TEXT NOT NULL REFERENCES foods(id),
  label   TEXT NOT NULL,                     -- organic, gluten-free, vegan, ...
  PRIMARY KEY (food_id, label)
) WITHOUT ROWID;
CREATE INDEX food_labels_label ON food_labels(label);

-- Household measures for logging ("1 medium", "1 cup, sliced").
CREATE TABLE food_portions (
  food_id     TEXT NOT NULL REFERENCES foods(id),
  description TEXT NOT NULL,
  grams       REAL NOT NULL,
  amount      REAL,
  unit        TEXT
);
CREATE INDEX food_portions_food ON food_portions(food_id);

-- Full-text search. Query: SELECT food_id FROM foods_fts WHERE foods_fts MATCH 'peanut butter' ORDER BY rank LIMIT 20;
CREATE VIRTUAL TABLE foods_fts USING fts5 (
  food_id UNINDEXED,
  name,
  brand,
  description,
  ingredients,
  tokenize = 'unicode61 remove_diacritics 2'
);
