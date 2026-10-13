/**
 * Validate every domain's YAML.
 *   pnpm validate            # everything
 *   pnpm validate --quick    # reference tables + curated files only (skips generated shards)
 *   pnpm validate --dir X    # also validate generated YAML under directory X (used by `pnpm test`)
 *
 * Each domain exports validate<Domain>() from scripts/<domain>/validate.ts and returns its error count.
 */
import { flag, opt } from './lib.ts';
import { validateNutrition } from './nutrition/validate.ts';

const options = { quick: flag('quick'), extraDir: opt('dir') };
const errors = [validateNutrition(options)].reduce((a, b) => a + b, 0);
process.exit(errors ? 1 : 0);
