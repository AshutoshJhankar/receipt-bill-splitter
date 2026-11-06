// Exact bill splitting in integer paise (mirror of backend/app/split.py).
// Each tax is spread only over the items it applies to (GST over food, liquor VAT over alcohol,
// service charge over everything). Shared test cases: tests/split_cases.json. Run: npm test

function distribute(amount, weights) {
  const n = weights.length;
  if (n === 0) return [];
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    weights = weights.map(() => 1);
    total = n;
  }
  // BigInt keeps amount * weight exact even for large bills.
  const A = BigInt(amount);
  const T = BigInt(total);
  const base = weights.map((w) => Number((A * BigInt(w)) / T));
  const rem = weights.map((w) => (A * BigInt(w)) % T);
  let leftover = amount - base.reduce((a, b) => a + b, 0);
  const order = [...Array(n).keys()].sort((i, j) => (rem[j] > rem[i] ? 1 : rem[j] < rem[i] ? -1 : i - j));
  for (const i of order) {
    if (leftover <= 0) break;
    base[i] += 1;
    leftover -= 1;
  }
  return base;
}

const signed = (amount, weights) => {
  const sign = amount < 0 ? -1 : 1;
  return distribute(Math.abs(amount), weights).map((p) => sign * p);
};

/**
 * @param {string[]} people person ids in display order
 * @param {{total_paise:number, shared_by:string[], category?:string}[]} items
 * @param {number | {amount_paise:number, applies_to?:"food"|"alcohol"|"all"}[]} charges
 *   discounts are negative; a single number means one charge on everything
 * @returns {Record<string, {items_paise:number, alcohol_paise:number, charges_paise:number, total_paise:number, equal_paise:number}>}
 */
export function computeShares(people, items, charges) {
  const index = new Map(people.map((p, i) => [p, i]));
  const food = people.map(() => 0);
  const alcohol = people.map(() => 0);
  for (const item of items) {
    const sharers = [...new Set(item.shared_by.filter((p) => index.has(p)))].sort((a, b) => index.get(a) - index.get(b));
    if (sharers.length === 0) throw new Error("Every item must be assigned to at least one person");
    const portion = item.category === "alcohol" ? alcohol : food;
    const parts = distribute(item.total_paise, sharers.map(() => 1));
    sharers.forEach((p, k) => { portion[index.get(p)] += parts[k]; });
  }
  const weights = { food, alcohol, all: food.map((f, i) => f + alcohol[i]) };
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);

  const list = typeof charges === "number" ? [{ amount_paise: charges, applies_to: "all" }] : charges;
  const groups = { food: 0, alcohol: 0, all: 0 };
  for (const c of list) {
    let target = c.applies_to || "all";
    if (!(target in groups) || sum(weights[target]) === 0) target = "all"; // e.g. liquor VAT but no alcohol items
    groups[target] += c.amount_paise;
  }
  const chargeParts = people.map(() => 0);
  for (const [target, amount] of Object.entries(groups)) {
    signed(amount, weights[target]).forEach((p, i) => { chargeParts[i] += p; });
  }

  const equal = signed(sum(weights.all) + groups.food + groups.alcohol + groups.all, people.map(() => 1));
  return Object.fromEntries(people.map((p, i) => [p, {
    items_paise: weights.all[i],
    alcohol_paise: alcohol[i],
    charges_paise: chargeParts[i],
    total_paise: weights.all[i] + chargeParts[i],
    equal_paise: equal[i],
  }]));
}
