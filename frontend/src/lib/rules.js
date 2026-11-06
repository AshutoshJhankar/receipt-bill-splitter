// Food and drink rules (mirror of backend/app/rules.py; shared cases in tests/rules_cases.json).
// The AI labels each item; these keyword checks only ever move a label in the safe direction,
// so a vegetarian is never charged for meat and a non-drinker is never charged for alcohol.

export const CATEGORIES = [
  { key: "veg", label: "Veg" },
  { key: "egg", label: "Egg" },
  { key: "nonveg", label: "Non-veg" },
  { key: "alcohol", label: "Alcohol" },
  { key: "soft_drink", label: "Soft drink" },
  { key: "other", label: "Other" },
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
const KEYS = new Set(CATEGORIES.map((c) => c.key));

export const DIETS = [
  { key: "veg", label: "Veg" },
  { key: "egg", label: "Egg" },
  { key: "nonveg", label: "Non-veg" },
];

export const APPLIES_TO = [
  { key: "food", label: "Food" },
  { key: "alcohol", label: "Alcohol" },
  { key: "all", label: "All" },
];

const NONVEG = new RegExp(
  "\\b(chicken|chiken|chkn|mutton|lamb|beef|pork|bacon|ham|hamburgers?|sausages?|salami|pepperoni|prawns?|shrimps?|"
  + "fish|crabs?|lobsters?|squid|calamari|octopus|oysters?|mussels?|clams?|seafood|meat|meatballs?|keema|"
  + "kheema|murg|murgh|gosht|machli|macchi|machhi|jhinga|tangdi|turkey|duck|tuna|salmon|basa|pomfret|"
  + "surmai|rawas|bangda|anchovy|anchovies)\\b");
const NONVEG_EXCEPT = /\b(vegan|mock|faux|plant[\s-]?based)\b/;

const ALCOHOL_WORDS = new RegExp(
  "\\b(beers?|wines?|whisky|whiskey|whiskies|vodka|rum|gin|tequila|brandy|cognac|bourbon|liquor|liqueur|"
  + "champagne|prosecco|lager|stout|ipa|cider|breezer|mojito|sangria|martini|mimosa|daiquiri|negroni|"
  + "cosmopolitan|bloody mary|long island|pegs?)\\b");
const ALCOHOL_BRANDS = new RegExp(
  "\\b(kingfisher|budweiser|heineken|corona|carlsberg|tuborg|bira|hoegaarden|stella artois|haywards|bacardi|"
  + "smirnoff|absolut|jack daniel'?s?|jameson|johnnie walker|black label|chivas|glenfiddich|glenlivet|"
  + "blenders pride|royal stag|old monk|magic moments|j[aä]germeister|j[aä]ger|baileys|sula|jacob'?s creek|amrut)\\b");
const NOT_ALCOHOL = /\b(mocktails?|virgin|non[\s-]?alcoholic|alcohol[\s-]?free|zero)\b|\b0\.0\b|\b0\s?%/;
const SURROGATE = /\b(soda|water)\b/; // "Kingfisher Soda" is a liquor brand's soda, not beer

const EGG = /\b(eggs?|omelets?|omelettes?|omlette|anda|frittata)\b/;
const NOT_EGG = /\b(eggless|egg[\s-]?free|no[\s-]eggs?|without[\s-]eggs?)\b/;

// Only used to guess a label when the AI gave none (e.g. items typed in by hand).
const SOFT_DRINK = new RegExp(
  "\\b(coke|coca[\\s-]?cola|pepsi|sprite|fanta|thums[\\s-]?up|limca|7[\\s-]?up|mountain dew|red bull|soda|"
  + "lemonade|nimbu|juice|mocktails?|virgin|iced tea|ice tea|cold coffee|coffee|tea|chai|lassi|buttermilk|"
  + "chaas|milkshake|shake|smoothie|water|cold drink|soft drink|aerated)\\b");
const VEG = new RegExp(
  "\\b(paneer|dal|daal|veg|veggie|vegetables?|vegetarian|vegan|aloo|gobi|palak|chana|chole|rajma|"
  + "mushrooms?|corn|naan|roti|rotis|kulcha|paratha|rice|jeera|pulao|dosa|idli|vada|sambar|uttapam|salad|"
  + "fries|papad|raita|bhindi|baingan|tofu|margherita|gulab jamun|rasmalai|kulfi|ice cream|halwa|kheer)\\b");

const SYNONYMS = {
  veg: "veg", vegetarian: "veg", vegan: "veg", "veg food": "veg", jain: "veg",
  egg: "egg", eggetarian: "egg", "contains egg": "egg", "egg based": "egg",
  nonveg: "nonveg", "non veg": "nonveg", "non vegetarian": "nonveg", meat: "nonveg", chicken: "nonveg",
  fish: "nonveg", seafood: "nonveg",
  alcohol: "alcohol", alcoholic: "alcohol", liquor: "alcohol", beer: "alcohol", wine: "alcohol",
  spirits: "alcohol", spirit: "alcohol", bar: "alcohol", cocktail: "alcohol", "alcoholic drink": "alcohol",
  "soft drink": "soft_drink", "soft drinks": "soft_drink", softdrink: "soft_drink", beverage: "soft_drink",
  beverages: "soft_drink", drink: "soft_drink", drinks: "soft_drink", "non alcoholic": "soft_drink",
  mocktail: "soft_drink", juice: "soft_drink",
  other: "other", unknown: "other", misc: "other", none: "other",
};

const clean = (t) => String(t ?? "").toLowerCase().replace(/’/g, "'").split(/\s+/).filter(Boolean).join(" ");

export function normalizeCategory(raw) {
  const key = clean(typeof raw === "string" ? raw : "").replace(/[_\-/]+/g, " ").trim();
  return SYNONYMS[key] ?? SYNONYMS[key.replace(/ /g, "")] ?? "other";
}

function nonvegWord(n) {
  const m = n.match(NONVEG);
  return m && !NONVEG_EXCEPT.test(n) ? m[1] : null;
}

function alcoholWord(n) {
  if (NOT_ALCOHOL.test(n)) return null;
  let m = n.match(ALCOHOL_WORDS);
  if (m) return m[1];
  m = n.match(ALCOHOL_BRANDS);
  return m && !SURROGATE.test(n) ? m[1] : null;
}

function eggWord(n) {
  const m = n.match(EGG);
  return m && !NOT_EGG.test(n) ? m[1] : null;
}

/** Best guess from the name alone. Checked in order: non-veg, alcohol, egg, soft drink, veg. */
export function guessCategory(name) {
  const n = clean(name);
  if (nonvegWord(n)) return "nonveg";
  if (alcoholWord(n)) return "alcohol";
  if (eggWord(n)) return "egg";
  if (SOFT_DRINK.test(n)) return "soft_drink";
  if (VEG.test(n)) return "veg";
  return "other";
}

/** Final category for an item, and whether the keyword check overrode the AI's label. */
export function categorize(name, aiCategory) {
  const n = clean(name);
  const ai = normalizeCategory(aiCategory);
  const base = ai !== "other" ? ai : guessCategory(n);
  let final = base;
  if (nonvegWord(n) && base !== "nonveg") final = "nonveg";
  else if (alcoholWord(n) && base !== "alcohol" && base !== "nonveg") final = "alcohol";
  else if (eggWord(n) && ["veg", "soft_drink", "other"].includes(base)) final = "egg";
  return { category: final, corrected: final !== base && ai !== "other" };
}

/** Which items a tax or charge is spread over: VAT on liquor, GST on food, the rest on everything. */
export function appliesToFor(label) {
  const t = clean(label);
  // (^|[^a-z]) instead of a lookbehind, which older iPhones (iOS < 16.4) can't parse.
  if (/(^|[^a-z])(vat|liquor|alcohol|bar|beer|wine|excise)(?![a-z])/.test(t)) return "alcohol";
  if (/(^|[^a-z])((c|s|i|ut)?gst|food)(?![a-z])/.test(t)) return "food";
  return "all";
}

// ---------- draft helpers: what the user sees and edits ----------

/** An item's category: the user's choice if they picked one, else the AI label double-checked by keywords. */
export function itemCategory(item) {
  if (item.cat && KEYS.has(item.cat)) return item.cat;
  return categorize(item.name, item.aiCat).category;
}

export function chargeAppliesTo(charge) {
  return charge.applies || appliesToFor(charge.label);
}

/** Who would normally share an item of this category. */
export function eligible(category, person) {
  if (category === "nonveg") return person.diet === "nonveg";
  if (category === "egg") return person.diet === "egg" || person.diet === "nonveg";
  if (category === "alcohol") return Boolean(person.drinks);
  return true;
}

/** People an item is assigned to: the user's picks once they've edited it, otherwise the rules. */
export function sharersOf(item, people) {
  if (item.edited) {
    const ids = new Set(people.map((p) => p.id));
    return item.shared_by.filter((id) => ids.has(id));
  }
  const cat = itemCategory(item);
  return people.filter((p) => eligible(cat, p)).map((p) => p.id);
}

/** Short description of the automatic rule, and whether the user should double-check it. */
export function ruleFor(category, people) {
  const drinkers = people.filter((p) => p.drinks).length;
  const mixedDrinkers = drinkers > 0 && drinkers < people.length;
  switch (category) {
    case "nonveg": return { text: "Non-veg eaters", empty: "No one is tagged non-veg." };
    case "egg": return { text: "Everyone except vegetarians", empty: "Everyone is tagged veg." };
    case "alcohol": return { text: "People who drink", empty: "No one is tagged as drinking." };
    case "soft_drink": return { text: "Everyone", check: mixedDrinkers ? "Check who had this: drinkers often order soda as a mixer." : null };
    case "other": return { text: "Everyone", check: "Check who had this." };
    default: return { text: "Everyone" };
  }
}
