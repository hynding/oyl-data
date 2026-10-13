#!/usr/bin/env bash
# Download the USDA FoodData Central CSV bundles we use and unpack them flat into
# .cache/usda/<dataset>/. Public domain; ~150 MB total. Re-run to refresh.
#
# URLs are date-stamped by USDA. If one 404s, copy the current link from
# https://fdc.nal.usda.gov/download-datasets (CSV column) into the table below.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .cache/usda

declare -A URLS=(
  [sr_legacy]="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
  [foundation]="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2025-12-18.zip"
  [survey]="https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip"
)

for ds in "${!URLS[@]}"; do
  url="${URLS[$ds]}"; zip=".cache/usda/$ds.zip"; dir=".cache/usda/$ds"
  echo "→ $ds  $url"
  curl -fL --retry 3 -C - -o "$zip" "$url"
  rm -rf "$dir"; mkdir -p "$dir"
  unzip -q -j -o "$zip" '*.csv' -d "$dir"          # -j flattens the dated folder inside the zip
  echo "   $(ls "$dir" | wc -l | tr -d ' ') csv files"
done
echo "done → .cache/usda/{sr_legacy,foundation,survey}/"
