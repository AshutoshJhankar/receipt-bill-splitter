import { formatPaise, parseRupees } from "../lib/money.js";
import { APPLIES_TO, chargeAppliesTo, itemCategory } from "../lib/rules.js";
import { CategoryPicker } from "./Marks.jsx";
import { blankCharge, blankItem } from "../lib/draft.js";

export function draftTotals(draft) {
  const items = draft.items.map((i) => parseRupees(i.amount));
  const charges = draft.charges.map((c) => parseRupees(c.amount));
  const valid = items.every((p) => p !== null && p >= 0) && charges.every((p) => p !== null)
    && draft.items.every((i) => i.name.trim()) && draft.charges.every((c) => c.label.trim()) && draft.items.length > 0;
  const itemsSum = items.reduce((a, b) => a + (b || 0), 0);
  const chargesSum = charges.reduce((a, b) => a + (b || 0), 0);
  return { valid, itemsSum, chargesSum, total: itemsSum + chargesSum };
}

/** Liquor taxes on a bill where nothing is marked as alcohol (checked live, so fixing a label clears it). */
export function strayLiquorTaxes(draft) {
  const hasAlcohol = draft.items.some((i) => itemCategory(i) === "alcohol");
  return hasAlcohol ? [] : draft.charges.filter((c) => chargeAppliesTo(c) === "alcohol").map((c) => c.label);
}

export default function ReviewStep({ draft, setDraft, onBack, onNext }) {
  const t = draftTotals(draft);
  const diff = draft.printedTotal == null ? null : t.total - draft.printedTotal;
  const matches = diff !== null && Math.abs(diff) <= 100;
  const corrected = draft.checks.find((c) => c.name === "categories");
  const stray = strayLiquorTaxes(draft);

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
        <div className="line item-line line-head"><span /><span>Item</span><span>Qty</span><span>Amount (₹)</span><span /></div>
        {draft.items.map((i) => (
          <div className="line item-line" key={i.id}>
            <CategoryPicker value={itemCategory(i)} label={`Type of ${i.name || "item"}`}
                            onChange={(v) => update("items", i.id, "cat", v)} />
            <input aria-label="Item name" value={i.name} placeholder="Item" maxLength={120}
                   onChange={(e) => update("items", i.id, "name", e.target.value)} />
            <input aria-label="Quantity" className="qty" inputMode="decimal" value={i.qty}
                   onChange={(e) => update("items", i.id, "qty", e.target.value)} />
            <input aria-label="Amount" className={`amt ${parseRupees(i.amount) === null ? "bad" : ""}`} inputMode="decimal"
                   value={i.amount} placeholder="0.00" onChange={(e) => update("items", i.id, "amount", e.target.value)} />
            <button className="x" aria-label={`Remove ${i.name || "item"}`} onClick={() => remove("items", i.id)}>×</button>
          </div>
        ))}
        <button className="link-btn" onClick={() => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }))}>+ Add item</button>
        <p className="muted small legend">
          The mark shows the type: <span className="mark mark-veg" aria-hidden /> veg, <span className="mark mark-egg" aria-hidden /> egg,{" "}
          <span className="mark mark-nonveg" aria-hidden /> non-veg, 🍺 alcohol, 🥤 soft drink. Tap it to change.
        </p>
        {corrected && <p className="check ok">✓ {corrected.detail}</p>}
      </div>

      <div className="lines">
        <div className="line charge-line line-head"><span>Taxes &amp; charges <small>(discounts negative)</small></span><span>Charged on</span><span>Amount (₹)</span><span /></div>
        {draft.charges.map((c) => (
          <div className="line charge-line" key={c.id}>
            <input aria-label="Charge name" value={c.label} maxLength={60}
                   onChange={(e) => update("charges", c.id, "label", e.target.value)} />
            <select aria-label={`${c.label || "Charge"} is charged on`} value={chargeAppliesTo(c)}
                    onChange={(e) => update("charges", c.id, "applies", e.target.value)}>
              {APPLIES_TO.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <input aria-label="Charge amount" className={`amt ${parseRupees(c.amount) === null ? "bad" : ""}`} inputMode="decimal"
                   value={c.amount} onChange={(e) => update("charges", c.id, "amount", e.target.value)} />
            <button className="x" aria-label={`Remove ${c.label}`} onClick={() => remove("charges", c.id)}>×</button>
          </div>
        ))}
        <button className="link-btn" onClick={() => setDraft((d) => ({ ...d, charges: [...d.charges, blankCharge()] }))}>
          + Add tax, service charge or discount
        </button>
        {draft.charges.length > 0 && (
          <p className="muted small legend">GST is charged on food and liquor VAT only on alcohol, so each is split over just those items.</p>
        )}
        {stray.length > 0 && (
          <p className="check warn">{stray.join(", ")} is charged on alcohol, but no item is marked as alcohol, so it will be
            shared over everything. Tap the mark next to the drinks to fix this.</p>
        )}
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
