// Run with: npm test   (Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeShares } from "../src/lib/split.js";
import { parseRupees } from "../src/lib/money.js";
import { isValidUpi, upiLink } from "../src/lib/upi.js";
import { appliesToFor, categorize, itemCategory, normalizeCategory, ruleFor, sharersOf } from "../src/lib/rules.js";

const read = (name) => JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
const cases = read("split_cases.json");
const rules = read("rules_cases.json");

for (const c of cases) {
  test(`split: ${c.name}`, () => {
    const got = computeShares(c.people, c.items, c.charges ?? c.charges_paise);
    const totals = Object.fromEntries(Object.entries(got).map(([p, v]) => [p, v.total_paise]));
    assert.deepEqual(totals, c.expected);
    const chargesSum = c.charges ? c.charges.reduce((a, x) => a + x.amount_paise, 0) : c.charges_paise;
    const billTotal = c.items.reduce((a, i) => a + i.total_paise, 0) + chargesSum;
    assert.equal(Object.values(totals).reduce((a, b) => a + b, 0), billTotal);
    assert.equal(Object.values(got).reduce((a, v) => a + v.equal_paise, 0), billTotal);
    if (c.expected_equal) {
      assert.deepEqual(Object.fromEntries(Object.entries(got).map(([p, v]) => [p, v.equal_paise])), c.expected_equal);
    }
  });
}

test("split: unassigned item throws", () => {
  assert.throws(() => computeShares(["a"], [{ total_paise: 100, shared_by: [] }], 0));
});

for (const c of rules.categories) {
  test(`category: ${c.name}`, () => {
    const got = categorize(c.name, c.ai);
    assert.equal(got.category, c.expected);
    assert.equal(got.corrected, Boolean(c.corrected));
  });
}

for (const c of rules.applies_to) {
  test(`applies to: ${c.label}`, () => assert.equal(appliesToFor(c.label), c.expected));
}

test("rules: label normalization", () => {
  assert.equal(normalizeCategory("Non-Veg"), "nonveg");
  assert.equal(normalizeCategory("SOFT_DRINK"), "soft_drink");
  assert.equal(normalizeCategory("spaceship"), "other");
  assert.equal(normalizeCategory(undefined), "other");
});

const group = [
  { id: "asha", name: "Asha", diet: "veg", drinks: false },
  { id: "ravi", name: "Ravi", diet: "nonveg", drinks: true },
  { id: "meera", name: "Meera", diet: "egg", drinks: false },
];

test("auto-assign: who shares each kind of item", () => {
  const item = (name, aiCat) => ({ name, aiCat, cat: null, edited: false, shared_by: [] });
  assert.deepEqual(sharersOf(item("Dal Makhani", "veg"), group), ["asha", "ravi", "meera"]);
  assert.deepEqual(sharersOf(item("Egg Curry", "egg"), group), ["ravi", "meera"]);
  assert.deepEqual(sharersOf(item("Chicken 65", "veg"), group), ["ravi"]); // keyword check overrides the AI
  assert.deepEqual(sharersOf(item("Kingfisher", null), group), ["ravi"]);
  assert.deepEqual(sharersOf(item("Fresh Lime Soda", "soft_drink"), group), ["asha", "ravi", "meera"]);
  assert.deepEqual(sharersOf({ ...item("Beer", "alcohol"), cat: "soft_drink" }, group), ["asha", "ravi", "meera"]); // user's choice wins
  assert.equal(itemCategory({ ...item("Beer", "alcohol"), cat: "soft_drink" }), "soft_drink");
  assert.deepEqual(sharersOf({ ...item("Beer", "alcohol"), edited: true, shared_by: ["asha", "gone"] }, group), ["asha"]);
  assert.deepEqual(sharersOf(item("Kingfisher", "alcohol"), group.map((p) => ({ ...p, drinks: false }))), []);
});

test("auto-assign: hints", () => {
  assert.ok(ruleFor("soft_drink", group).check); // mixed drinkers and non-drinkers: ask to check
  assert.equal(ruleFor("soft_drink", group.map((p) => ({ ...p, drinks: false }))).check, null);
  assert.ok(ruleFor("other", group).check);
  assert.equal(ruleFor("alcohol", group).text, "People who drink");
});

test("money: parseRupees", () => {
  assert.equal(parseRupees("612.34"), 61234);
  assert.equal(parseRupees("₹1,950"), 195000);
  assert.equal(parseRupees("0.1"), 10);
  assert.equal(parseRupees("-100"), -10000);
  assert.equal(parseRupees("12.345"), null);
  assert.equal(parseRupees("abc"), null);
});

test("upi: validation and link format", () => {
  assert.ok(isValidUpi("asha.k@okaxis"));
  assert.ok(isValidUpi("9876543210@ybl"));
  assert.ok(!isValidUpi("asha@"));
  assert.ok(!isValidUpi("not a upi"));
  const link = upiLink({ upiId: "asha.k@okaxis", payeeName: "Asha K", amountPaise: 61234, note: "Dinner at Copper Lantern" });
  assert.equal(link, "upi://pay?pa=asha.k%40okaxis&pn=Asha%20K&am=612.34&cu=INR&tn=Dinner%20at%20Copper%20Lantern");
});
