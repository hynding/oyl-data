# Data licenses

This repository mixes code and data under different licenses.

## Open Food Facts (`foods/products/**`, `source.name: off`)

Product data © Open Food Facts contributors, available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Individual contents (ingredient text, images) are under the
[Database Contents License (DbCL) 1.0](https://opendatacommons.org/licenses/dbcl/1-0/).

Obligations when OYL ships this data:
- **Attribute**: "Contains data from Open Food Facts (https://openfoodfacts.org), ODbL 1.0."
- **Share-alike**: a database derived from it (this repo's shards, `dist/oyl-foods.sqlite`)
  must be offered under ODbL too. Keep this file with any copy.
- Image URLs point at images.openfoodfacts.org; images are not vendored here.

## USDA FoodData Central (`foods/generic/**`, `source.name: fdc`)

U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, https://fdc.nal.usda.gov.
Public domain (CC0); attribution is requested, not required.

## Reference tables (`nutrients.yaml`, `units.yaml`, `allergens.yaml`, `categories.yaml`)

Original work in this repo. Daily Values are from 21 CFR 101.9. MIT, same as the code.
