import { formatPaise, parseRupees } from "../lib/money.js";
import { newId } from "../lib/nav.js";

export function draftTotals(draft) {
  const items = draft.items.map((i) => parseRupees(i.amount));
  const charges = draft.charges.map((c) => parseRupees(c.amount));
  const valid = items.every((p) => p !== null && p >= 0) && charges.every((p) => p !== null)
    && draft.items.every((i) => i.name.trim()) && draft.charges.every((c) => c.label.trim()) && draft.items.length > 0;
  const itemsSum = items.reduce((a, b) => a + (b || 0), 0);
  const chargesSum = charges.reduce((a, b) => a + (b || 0), 0);
  return { valid, itemsSum, chargesSum, total: itemsSum + chargesSum };
}

export default function ReviewStep({ draft, setDraft, onBack, onNext }) {
  const t = draftTotals(draft);
  const diff = draft.printedTotal == null ? null : t.total - draft.printedTotal;
  const matches = diff !== null && Math.abs(diff) <= 100;

  const update = (key, id, field, value) =>
    setDraft((d) => ({ ...d, [key]: d[key].map((x) => (x.id === id ? { ...x, [field]: value } : x)) }));
  const remove = (key, id) => setDraft((d) => ({ ...d, [key]: d[key].filter((x) => x.id !== id) }));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Check the items</h2>
        <span className="muted small">Fix anything the scan got wrong.</span>
      </div>
      <label className="field">
        <span>Place</span>
        <input value={draft.merchant} placeholder="e.g. Dinner at Truffles" maxLength={120}
               onChange={(e) => setDraft((d) => ({ ...d, merchant: e.target.value }))} />
      </label>

      <div className="lines">
        <div className="line line-head"><span>Item</span><span>Qty</span><span>Amount (₹)</span><span /></div>
        {draft.items.map((i) => (
          <div className="line" key={i.id}>
            <input aria-label="Item name" value={i.name} placeholder="Item" maxLength={120}
                   onChange={(e) => update("items", i.id, "name", e.target.value)} />
            <input aria-label="Quantity" className="qty" inputMode="decimal" value={i.qty}
                   onChange={(e) => update("items", i.id, "qty", e.target.value)} />
            <input aria-label="Amount" className={`amt ${parseRupees(i.amount) === null ? "bad" : ""}`} inputMode="decimal"
                   value={i.amount} placeholder="0.00" onChange={(e) => update("items", i.id, "amount", e.target.value)} />
            <button className="x" aria-label={`Remove ${i.name || "item"}`} onClick={() => remove("items", i.id)}>×</button>
          </div>
        ))}
        <button className="link-btn" onClick={() => setDraft((d) => ({
          ...d, items: [...d.items, { id: newId("i"), name: "", qty: "1", amount: "", shared_by: [] }],
        }))}>+ Add item</button>
      </div>

      <div className="lines">
        <div className="line line-head"><span>Taxes &amp; charges <small>(discounts negative)</small></span><span /><span>Amount (₹)</span><span /></div>
        {draft.charges.map((c) => (
          <div className="line" key={c.id}>
            <input aria-label="Charge name" className="span2" value={c.label} maxLength={60}
                   onChange={(e) => update("charges", c.id, "label", e.target.value)} />
            <input aria-label="Charge amount" className={`amt ${parseRupees(c.amount) === null ? "bad" : ""}`} inputMode="decimal"
                   value={c.amount} onChange={(e) => update("charges", c.id, "amount", e.target.value)} />
            <button className="x" aria-label={`Remove ${c.label}`} onClick={() => remove("charges", c.id)}>×</button>
          </div>
        ))}
        <button className="link-btn" onClick={() => setDraft((d) => ({
          ...d, charges: [...d.charges, { id: newId("c"), label: "GST", amount: "" }],
        }))}>+ Add tax, service charge or discount</button>
      </div>

      <div className="totals">
        <div><span>Items</span><b>{formatPaise(t.itemsSum)}</b></div>
        <div><span>Taxes &amp; charges</span><b>{formatPaise(t.chargesSum)}</b></div>
        <div className="grand"><span>Total</span><b>{formatPaise(t.total)}</b></div>
      </div>
      {diff !== null && (
        <p className={`check ${matches ? "ok" : "warn"}`}>
          {matches
            ? `✓ Matches the total printed on the bill (${formatPaise(draft.printedTotal)})`
            : `The bill says ${formatPaise(draft.printedTotal)}, but these lines add up to ${formatPaise(t.total)} `
              + `(${diff > 0 ? "+" : "−"}${formatPaise(Math.abs(diff))}). Check for a misread item or tax.`}
        </p>
      )}
      {draft.checks.filter((c) => !c.passed && c.name === "line_math").map((c) => (
        <p key={c.name} className="check warn">Check these lines: {c.detail}</p>
      ))}

      <div className="nav">
        <button className="btn btn-soft" onClick={onBack}>Back</button>
        <button className="btn" disabled={!t.valid || t.total <= 0} onClick={onNext}>Next: who had what →</button>
      </div>
    </section>
  );
}
