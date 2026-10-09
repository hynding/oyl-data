-- Open Food Facts → US, English, reasonably complete products.
-- Run by scripts/extract-off.ts, which fills in the SOURCE and LIMIT placeholders,
-- defines the en_text() macro, and rewrites any line marked `-- optional` whose
-- column is missing from the live Parquet schema (SELECT lines become NULL AS <alias>,
-- WHERE lines become AND true). Core columns without the marker must exist.
--
-- Values in nutriments."100g" are in GRAMS for every mass nutrient (even those
-- whose display unit is mg/µg) and kcal for energy-kcal; shard-products.ts
-- rescales using `scale` in nutrients.yaml. We keep the raw list and map in TS.

SELECT
  code,
  en_text(product_name)      AS name,
  brands,
  brand_owner,                                        -- optional
  en_text(generic_name)      AS generic_name,         -- optional
  quantity,                                           -- optional
  product_quantity,                                   -- optional
  product_quantity_unit,                              -- optional
  serving_size,                                       -- optional
  serving_quantity,                                   -- optional
  nutrition_data_per,                                 -- optional
  en_text(ingredients_text)  AS ingredients_text,     -- optional
  ingredients,                                        -- optional   JSON string; parsed in TS
  allergens_tags,                                     -- optional
  traces_tags,                                        -- optional
  categories_tags,                                    -- optional
  labels_tags,                                        -- optional
  nova_group,                                         -- optional
  nutriscore_grade,                                   -- optional
  completeness,
  last_modified_t,                                    -- optional
  to_json(nutriments)        AS nutriments,
  to_json(images)            AS images                -- optional
FROM read_parquet('{{SOURCE}}')
WHERE
  list_contains(countries_tags, 'en:united-states')
  AND lang = 'en'
  AND completeness >= 0.5
  AND len(nutriments) > 0
  AND en_text(product_name) IS NOT NULL
  AND coalesce(obsolete, false) = false              -- optional
ORDER BY code
{{LIMIT}}
