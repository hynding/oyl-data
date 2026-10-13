import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = resolve(ROOT, '.cache');
export const DIST = resolve(ROOT, 'dist');

export type Nutrient = {
  id: string; name: string; unit: 'g' | 'mg' | 'mcg' | 'kcal'; dv: number | null;
  label: 'required' | 'voluntary' | 'extra'; parent?: string; note?: string;
  off: string | null; scale: number; fdc: number | null;
};
export type Unit = { id: string; name: string; kind: string; base: number; aliases: string[] };
export type Allergen = { id: string; name: string; fda: boolean; off: string[] };
export type Category = { id: string; name: string; off?: string[]; fdc?: string[]; children?: Category[] };

export type Food = {
  id: string; kind: 'product' | 'generic'; name: string; brand?: string; brand_owner?: string;
  description?: string; gtin?: string; gtin_aliases?: string[]; quantity?: string; net_grams?: number;
  basis?: '100g' | '100ml'; density_g_per_ml?: number;
  serving?: { size: number; unit: 'g' | 'ml'; description?: string; per_container?: number };
  portions?: { description: string; grams: number; amount?: number; unit?: string }[];
  nutrients: Record<string, number>; nutrients_per_serving?: Record<string, number>;
  ingredients?: { text?: string; list?: string[] };
  allergens?: string[]; traces?: string[]; categories?: string[]; labels?: string[];
  nova?: number; nutriscore?: string;
  images?: { front?: string; nutrition?: string; ingredients?: string };
  source: { name: 'off' | 'fdc' | 'manual'; id: string; url?: string; modified?: string; completeness?: number; license?: string };
};

export function loadYaml<T>(file: string): T {
  return parse(readFileSync(resolve(ROOT, file), 'utf8')) as T;
}

export function loadRefs() {
  const nutrients = loadYaml<Nutrient[]>('nutrients.yaml');
  const units = loadYaml<Unit[]>('units.yaml');
  const allergens = loadYaml<Allergen[]>('allergens.yaml');
  const categories = loadYaml<Category[]>('categories.yaml');
  return { nutrients, units, allergens, categories };
}

/** Flatten the category tree into [id, parentId|null, leafOrNode] in file order. */
export function flattenCategories(cats: Category[], parent: string | null = null): { id: string; name: string; parent: string | null; off: string[]; fdc: string[] }[] {
  const out: ReturnType<typeof flattenCategories> = [];
  for (const c of cats) {
    out.push({ id: c.id, name: c.name, parent, off: c.off ?? [], fdc: c.fdc ?? [] });
    if (c.children) out.push(...flattenCategories(c.children, c.id));
  }
  return out;
}

/** Normalize any UPC-A / EAN-8 / EAN-13 / GTIN string to GTIN-14; returns null if it isn't a plausible barcode. */
export function toGtin14(code: string): string | null {
  const digits = (code ?? '').replace(/\D/g, '').replace(/^0+(?=\d{8})/, ''); // drop padding zeros, keep ≥ 8 digits
  if (digits.length < 8 || digits.length > 14) return null;
  return digits.padStart(14, '0');
}

/** The forms a scanner is likely to emit for this barcode. */
export function gtinAliases(raw: string, gtin14: string): string[] {
  const set = new Set<string>();
  const digits = raw.replace(/\D/g, '');
  if (digits && digits !== gtin14) set.add(digits);
  const stripped = gtin14.replace(/^0+/, '');
  for (const len of [8, 12, 13]) {
    if (stripped.length <= len && gtin14.slice(-len) !== gtin14) set.add(gtin14.slice(-len));
  }
  set.delete(gtin14);
  return [...set];
}

/**
 * Build a matcher from OFF category tags → one OYL category id.
 * OFF lists categories_tags from general to specific, so the LAST tag that maps
 * to something wins (en:beverages → en:waters → en:flavored-waters ⇒ `water`).
 */
export function makeOffCategoryMatcher(cats: Category[]) {
  const flat = flattenCategories(cats);
  const byTag = new Map<string, string>();
  for (const c of flat) for (const t of c.off) if (!byTag.has(t)) byTag.set(t, c.id);
  return (tags: string[] | null | undefined): string[] => {
    let hit: string | undefined;
    for (const t of tags ?? []) { const id = byTag.get(t); if (id) hit = id; }
    return [hit ?? 'other'];
  };
}

export function makeOffAllergenMatcher(allergens: Allergen[]) {
  const byTag = new Map<string, string>();
  for (const a of allergens) for (const t of a.off) byTag.set(t, a.id);
  return (tags: string[] | null | undefined): string[] =>
    [...new Set((tags ?? []).map((t) => byTag.get(t)).filter((x): x is string => !!x))];
}

/** Parse "2/3 cup (55g)" / "30 g" / "240 ml" into {size, unit} in g or ml. */
export function parseServing(text: string | null | undefined, units: Unit[]): { size: number; unit: 'g' | 'ml' } | null {
  if (!text) return null;
  const alias = new Map<string, Unit>();
  for (const u of units) for (const a of u.aliases) alias.set(a.toLowerCase(), u);
  // Prefer an explicit metric amount in parentheses.
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(g|ml|mL|grams?|milliliters?)\b/i);
  if (m) {
    const n = parseFloat(m[1].replace(',', '.'));
    const u = alias.get(m[2].toLowerCase());
    if (u && n > 0) return { size: n * u.base, unit: u.kind === 'volume' ? 'ml' : 'g' };
  }
  const m2 = text.match(/(\d+(?:[.,]\d+)?|\d+\/\d+)\s*([a-zA-Z. ]+)/);
  if (m2) {
    const n = m2[1].includes('/') ? Number(m2[1].split('/')[0]) / Number(m2[1].split('/')[1]) : parseFloat(m2[1].replace(',', '.'));
    const u = alias.get(m2[2].trim().toLowerCase());
    if (u && n > 0 && (u.kind === 'mass' || u.kind === 'volume')) return { size: round(n * u.base, 2), unit: u.kind === 'volume' ? 'ml' : 'g' };
  }
  return null;
}

export function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/^[a-z]{2}:/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
