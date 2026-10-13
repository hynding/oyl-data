-- USDA FoodData Central → one JSON row per food with its nutrients and portions.
-- Run by extract-usda.ts once per dataset directory (.cache/usda/<dataset>/), which
-- substitutes {{DIR}} and {{DATASET}}. Every FDC CSV is read as VARCHAR and cast here,
-- because column types drift between releases.
--
-- food_category (SR Legacy / Foundation) and wweia_food_category (FNDDS) are both
-- optional joins; whichever exists supplies `category`.

WITH food AS (
  SELECT fdc_id, data_type, description, food_category_id
  FROM read_csv('{{DIR}}/food.csv', all_varchar = true, header = true)
),
nutrients AS (
  SELECT fn.fdc_id,
         list(struct_pack(id := CAST(fn.nutrient_id AS INTEGER),
                          amount := CAST(fn.amount AS DOUBLE),
                          unit := n.unit_name)) AS nutrients
  FROM read_csv('{{DIR}}/food_nutrient.csv', all_varchar = true, header = true) fn
  JOIN read_csv('{{DIR}}/nutrient.csv', all_varchar = true, header = true) n ON n.id = fn.nutrient_id
  WHERE fn.amount IS NOT NULL AND fn.amount <> ''
  GROUP BY fn.fdc_id
),
portions AS (
  SELECT p.fdc_id,
         list(struct_pack(amount := TRY_CAST(p.amount AS DOUBLE),
                          unit := mu.name,
                          description := p.portion_description,
                          modifier := p.modifier,
                          grams := TRY_CAST(p.gram_weight AS DOUBLE))
              ORDER BY TRY_CAST(p.seq_num AS INTEGER)) AS portions
  FROM read_csv('{{DIR}}/food_portion.csv', all_varchar = true, header = true) p
  LEFT JOIN read_csv('{{DIR}}/measure_unit.csv', all_varchar = true, header = true) mu ON mu.id = p.measure_unit_id
  GROUP BY p.fdc_id
),
category AS (
  {{CATEGORY_CTE}}
)
SELECT
  CAST(f.fdc_id AS INTEGER)   AS fdc_id,
  '{{DATASET}}'               AS dataset,
  f.data_type,
  f.description,
  c.category,
  n.nutrients,
  p.portions
FROM food f
JOIN nutrients n ON n.fdc_id = f.fdc_id
LEFT JOIN portions p ON p.fdc_id = f.fdc_id
LEFT JOIN category c ON c.fdc_id = f.fdc_id
ORDER BY fdc_id
{{LIMIT}}
