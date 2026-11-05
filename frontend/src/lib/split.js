// Exact bill splitting in integer paise (mirror of backend/app/split.py).
// Shared test cases: tests/split_cases.json. Run: npm test

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

/**
 * @param {string[]} people person ids in display order
 * @param {{total_paise:number, shared_by:string[]}[]} items
 * @param {number} chargesPaise taxes + service + round-off - discount (may be negative)
 * @returns {Record<string, {items_paise:number, charges_paise:number, total_paise:number}>}
 */
export function computeShares(people, items, chargesPaise) {
  const index = new Map(people.map((p, i) => [p, i]));
  const sub = people.map(() => 0);
  for (const item of items) {
    const sharers = [...new Set(item.shared_by.filter((p) => index.has(p)))].sort((a, b) => index.get(a) - index.get(b));
    if (sharers.length === 0) throw new Error("Every item must be assigned to at least one person");
    const parts = distribute(item.total_paise, sharers.map(() => 1));
    sharers.forEach((p, k) => { sub[index.get(p)] += parts[k]; });
  }
  const sign = chargesPaise < 0 ? -1 : 1;
  const chargeParts = distribute(Math.abs(chargesPaise), sub).map((c) => sign * c);
  return Object.fromEntries(people.map((p, i) => [p, {
    items_paise: sub[i], charges_paise: chargeParts[i], total_paise: sub[i] + chargeParts[i],
  }]));
}
