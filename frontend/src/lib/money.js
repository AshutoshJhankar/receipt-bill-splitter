const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatPaise = (p) => inr.format((p || 0) / 100);

/** "612.34" -> 61234; returns null for anything that isn't a valid amount. */
export function parseRupees(text) {
  const t = String(text ?? "").replace(/[₹,\s]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

export const paiseToInput = (p) => (p / 100).toFixed(2);

/** How a fair share compares with an equal split: {save, text}, or null when within ₹1. */
export function vsEqual(share) {
  const diff = share.total_paise - share.equal_paise;
  if (Math.abs(diff) < 100) return null;
  return diff < 0
    ? { save: true, text: `${formatPaise(-diff)} less than equal` }
    : { save: false, text: `${formatPaise(diff)} more than equal` };
}
