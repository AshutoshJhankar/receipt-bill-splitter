// QR encoder checks. The encoder was verified by decoding its output with OpenCV for versions 1-40;
// the fingerprint below pins one of those verified codes so any accidental change is caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeQR } from "../src/lib/qr.js";

const LINK = "upi://pay?pa=ravi%40okicici&pn=Ravi&am=619.56&cu=INR&tn=THE%20COPPER%20LANTERN";
const rows = (q) => q.modules.map((r) => r.map((d) => (d ? 1 : 0)).join(""));

test("qr: UPI link encodes to the verified matrix", () => {
  const q = encodeQR(LINK);
  assert.equal(q.version, 5);
  assert.equal(q.size, 37);
  const hash = createHash("sha256").update(rows(q).join("\n")).digest("hex");
  assert.equal(hash, "bff83947225c0f00dddd8f391f87fb54cbe6d3db726f91865abf8f5c6396c75e");
});

test("qr: finder patterns and timing are in place", () => {
  const q = encodeQR("hello");
  const r = rows(q);
  for (const [x, y] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]]) {
    assert.equal(r[y].slice(x, x + 7), "1111111");
    assert.equal(r[y + 1].slice(x, x + 7), "1000001");
    assert.equal(r[y + 3].slice(x, x + 7), "1011101");
  }
  assert.equal(r[6].slice(8, q.size - 8), "10101010101010101".slice(0, q.size - 16));
});

test("qr: version grows with length, and UTF-8 works", () => {
  assert.equal(encodeQR("A").version, 1);
  assert.ok(encodeQR("x".repeat(500)).version > 10);
  assert.ok(encodeQR("₹ बिल ✓").size > 0);
  assert.throws(() => encodeQR("x".repeat(3000)));
});
