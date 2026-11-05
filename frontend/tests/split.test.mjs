// Run with: npm test   (Node's built-in test runner, no extra packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeShares } from "../src/lib/split.js";
import { parseRupees } from "../src/lib/money.js";
import { isValidUpi, upiLink } from "../src/lib/upi.js";

const cases = JSON.parse(readFileSync(new URL("./split_cases.json", import.meta.url), "utf8"));

for (const c of cases) {
  test(`split: ${c.name}`, () => {
    const got = computeShares(c.people, c.items, c.charges_paise);
    const totals = Object.fromEntries(Object.entries(got).map(([p, v]) => [p, v.total_paise]));
    assert.deepEqual(totals, c.expected);
    const billTotal = c.items.reduce((a, i) => a + i.total_paise, 0) + c.charges_paise;
    assert.equal(Object.values(totals).reduce((a, b) => a + b, 0), billTotal);
  });
}

test("split: unassigned item throws", () => {
  assert.throws(() => computeShares(["a"], [{ total_paise: 100, shared_by: [] }], 0));
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
