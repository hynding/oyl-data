-- Open Food Facts → US, English, reasonably complete products.
-- Run by scripts/extract-off.ts, which substitutes {{SOURCE}} and {{LIMIT}}.
--
-- Column names follow the Parquet export on Hugging Face
-- (openfoodfacts/product-database, food.parquet). If a column is missing after an
-- upstream schema change, `pnpm extract:off --describe` prints the live schema.
--
-- Values in nutriments."100g" are in GRAMS for every mass nutrient (even those
-- whose display unit is mg/µg) and kcal for energy-kcal; shard-products.ts
-- rescales using `scale` in nutrients.yaml. We keep the raw list and map in TS.

SELECT
  code,
  coalesce(
    list_filter(product_name, x -> x.lang = 'en')[1].text,
    list_filter(product_name, x -> x.lang = 'main')[1].text
  )                                                                     AS name,
  brands,
  brand_owner,
  coalesce(
    list_filter(generic_name, x -> x.lang = 'en')[1].text,
    list_filter(generic_name, x -> x.lang = 'main')[1].text
  )                                                                     AS generic_name,
  quantity,
  product_quantity,
  product_quantity_unit,
  serving_size,
  serving_quantity,
  nutrition_data_per,
  coalesce(
    list_filter(ingredients_text, x -> x.lang = 'en')[1].text,
    list_filter(ingredients_text, x -> x.lang = 'main')[1].text
  )                                                                     AS ingredients_text,
  ingredients,                 -- JSON string; parsed in TS
  allergens_tags,
  traces_tags,
  categories_tags,
  labels_tags,
  nova_group,
  nutriscore_grade,
  completeness,
  last_modified_t,
  to_json(nutriments)                                                   AS nutriments,
  to_json(images)                                                       AS images
FROM read_parquet('{{SOURCE}}')
WHERE
  list_contains(countries_tags, 'en:united-states')
  AND (obsolete IS NULL OR obsolete = false)
  AND lang = 'en'
  AND completeness >= 0.5
  AND len(nutriments) > 0
  AND coalesce(
        list_filter(product_name, x -> x.lang = 'en')[1].text,
        list_filter(product_name, x -> x.lang = 'main')[1].text
      ) IS NOT NULL
ORDER BY code
{{LIMIT}}
