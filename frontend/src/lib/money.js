const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatPaise = (p) => inr.format((p || 0) / 100);

/** "612.34" -> 61234; returns null for anything that isn't a valid amount. */
export function parseRupees(text) {
  const t = String(text ?? "").replace(/[₹,\s]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

export const paiseToInput = (p) => (p / 100).toFixed(2);
