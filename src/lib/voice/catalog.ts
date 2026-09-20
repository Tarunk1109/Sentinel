import { AUTOPILOT_LIMITS, type AutopilotCategory, type AutopilotItem } from "@/lib/autopilot/policy";

/**
 * Deterministic spoken-item mapping. Known brands become PREFERENCES (brandMatch
 * "PREFERRED"): "Coke" searches for Coca-Cola first but any cola still qualifies.
 */
interface KnownItem { id: string; label: string; brand: string | null; productType: string; searchQuery: string }

const soda = (id: string, label: string, brand: string | null, productType: string): KnownItem =>
  ({ id, label, brand, productType, searchQuery: brand ? `${brand} soft drink` : productType });

const KNOWN_ITEMS = new Map<string, KnownItem>();
for (const [names, item] of [
  [["coke", "coca cola", "coca-cola", "coca colas"], soda("coca-cola", "Coca-Cola", "Coca-Cola", "cola soft drink")],
  [["pepsi"], soda("pepsi", "Pepsi", "Pepsi", "cola soft drink")],
  [["cola", "colas"], soda("cola", "Cola", null, "cola soft drink")],
  [["sprite"], soda("sprite", "Sprite", "Sprite", "lemon-lime soft drink")],
  [["7up", "7 up", "7-up", "seven up"], soda("7up", "7UP", "7UP", "lemon-lime soft drink")],
  [["fanta"], soda("fanta", "Fanta", "Fanta", "orange soft drink")],
  [["dr pepper", "dr. pepper", "doctor pepper"], soda("dr-pepper", "Dr Pepper", "Dr Pepper", "soft drink")],
  [["ginger ale", "canada dry"], soda("ginger-ale", "Ginger ale", null, "ginger ale soft drink")],
] as [string[], KnownItem][]) {
  for (const name of names) { KNOWN_ITEMS.set(name, item); if (!name.endsWith("s")) KNOWN_ITEMS.set(`${name}s`, item); }
}

/** Longest phrases first so "coffee beans" wins over "beans" and "paper towels" over "paper". */
const CATEGORY_KEYWORDS: [string, AutopilotCategory][] = ([
  ["coffee bean", "BEVERAGES"], ["oat milk", "BEVERAGES"], ["soft drink", "BEVERAGES"], ["sparkling water", "BEVERAGES"], ["energy drink", "BEVERAGES"],
  ["paper towel", "PAPER_GOODS"], ["toilet paper", "PAPER_GOODS"], ["paper cup", "PAPER_GOODS"], ["paper plate", "PAPER_GOODS"],
  ["printer paper", "OFFICE_SUPPLIES"], ["sticky note", "OFFICE_SUPPLIES"],
  ["dish soap", "CLEANING_SUPPLIES"], ["hand soap", "CLEANING_SUPPLIES"], ["trash bag", "CLEANING_SUPPLIES"], ["garbage bag", "CLEANING_SUPPLIES"],
  ["dog food", "PET_SUPPLIES"], ["cat food", "PET_SUPPLIES"], ["cat litter", "PET_SUPPLIES"], ["pet food", "PET_SUPPLIES"],
  ...["soda", "pop", "drink", "juice", "water", "coffee", "espresso", "tea", "milk", "lemonade", "kombucha", "cola"].map(word => [word, "BEVERAGES"]),
  ...["chip", "crisp", "cookie", "cracker", "candy", "chocolate", "snack", "nut", "popcorn", "pretzel", "granola"].map(word => [word, "SNACKS"]),
  ...["sugar", "flour", "rice", "pasta", "cereal", "oil", "salt", "spice", "sauce", "syrup", "honey", "oat", "bean"].map(word => [word, "PANTRY"]),
  ...["soap", "detergent", "cleaner", "bleach", "sponge", "wipe", "disinfectant"].map(word => [word, "CLEANING_SUPPLIES"]),
  ...["napkin", "tissue", "cup", "plate", "straw", "lid", "towel"].map(word => [word, "PAPER_GOODS"]),
  ...["pen", "pencil", "toner", "ink", "staple", "notebook", "folder", "envelope"].map(word => [word, "OFFICE_SUPPLIES"]),
  ...["shampoo", "conditioner", "toothpaste", "deodorant", "razor", "lotion", "sunscreen"].map(word => [word, "PERSONAL_CARE"]),
  ...["litter", "kibble"].map(word => [word, "PET_SUPPLIES"]),
] as [string, AutopilotCategory][]).sort((a, b) => b[0].length - a[0].length);

/** Articles, amounts and containers ("12 cans of", "a case of") around the product name. Spoken
 * counts are not turned into quantities: a listing may itself be a 12-pack, so the draft keeps
 * quantity 1 for the user to review. */
const FILLER = /^(?:(?:some|the|a|an|our|my|more|enough|extra|fresh|cold|plenty of|lots of|a lot of|a few|several|a couple of|couple of|a dozen|dozen|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:cans?|bottles?|packs?|boxes?|cases?|bags?|cartons?|jugs?|packets?) of)\s+)+/;
const VAGUE = new Set(["it", "them", "stuff", "things", "everything", "that", "this", "those", "these", "supplies", "the usual"]);

export function categoryFor(phrase: string): AutopilotCategory | null {
  for (const [keyword, category] of CATEGORY_KEYWORDS) {
    if (new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s|es)?\\b`).test(phrase)) return category;
  }
  return null;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || "item";
}

export type SpokenItem =
  | { ok: true; item: AutopilotItem }
  | { ok: false; phrase: string; reason: "VAGUE" | "UNKNOWN_CATEGORY" | "TOO_LONG" };

/** Maps one spoken item phrase to a policy item, or explains why it can't. */
export function spokenItem(rawPhrase: string): SpokenItem {
  const trimmed = rawPhrase.trim();
  const phrase = trimmed.replace(FILLER, "").replace(/\s+(?:too|also|as well)$/, "").trim();
  if (!phrase || VAGUE.has(phrase)) return { ok: false, phrase: trimmed, reason: "VAGUE" };
  if (phrase.length > AUTOPILOT_LIMITS.maxProductTypeLength) return { ok: false, phrase, reason: "TOO_LONG" };
  // Exact names first, so a brand like "7 up" is never stripped as a count.
  const known = KNOWN_ITEMS.get(trimmed) ?? KNOWN_ITEMS.get(phrase);
  if (known) {
    return { ok: true, item: { id: known.id, label: known.label, category: "BEVERAGES", searchQuery: known.searchQuery, productType: known.productType, preferredBrands: known.brand ? [known.brand] : [], brandMatch: "PREFERRED", quantity: 1 } };
  }
  const category = categoryFor(phrase);
  if (!category || phrase.length < 2) return { ok: false, phrase, reason: "UNKNOWN_CATEGORY" };
  const label = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return { ok: true, item: { id: slug(phrase), label, category, searchQuery: phrase, productType: phrase, preferredBrands: [], brandMatch: "PREFERRED", quantity: 1 } };
}

/** "coke, sprite, and fanta" -> ["coke", "sprite", "fanta"]. */
export function splitItemList(list: string): string[] {
  return list.split(/\s*,\s*(?:and\s+|&\s+)?|\s+(?:and|&|plus|as well as)\s+/).map(part => part.trim()).filter(Boolean);
}
