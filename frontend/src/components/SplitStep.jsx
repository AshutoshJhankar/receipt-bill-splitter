import { useState } from "react";
import { createBill } from "../api.js";
import { formatPaise, parseRupees, vsEqual } from "../lib/money.js";
import { computeShares } from "../lib/split.js";
import { isValidUpi } from "../lib/upi.js";
import { navigate, newId } from "../lib/nav.js";
import { CATEGORY_LABEL, DIETS, chargeAppliesTo, itemCategory, ruleFor, sharersOf } from "../lib/rules.js";
import { draftTotals } from "./ReviewStep.jsx";
import { CategoryPicker, PersonTags } from "./Marks.jsx";

const readUpi = () => {
  try { return localStorage.getItem("last-upi") || ""; } catch { return ""; }
};

const GROUP_TEXT = { food: "Split over food", alcohol: "Only on alcohol", all: "Over everything" };

export default function SplitStep({ draft, setDraft, people, setPeople, onBack }) {
  const [name, setName] = useState("");
  const [payerId, setPayerId] = useState(people[0]?.id || null);
  const [upi, setUpi] = useState(readUpi);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ids = people.map((p) => p.id);
  const totals = draftTotals(draft);

  function addPerson(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n || people.length >= 20) return;
    if (people.some((p) => p.name.toLowerCase() === n.toLowerCase())) {
      setError(`${n} is already added.`);
      return;
    }
    const person = { id: newId("p"), name: n.slice(0, 40), diet: "nonveg", drinks: false };
    // Hand-edited items shared by everyone stay shared by everyone. Automatic items follow the rules anyway.
    setDraft((d) => ({
      ...d,
      items: d.items.map((i) => (i.edited && ids.length && ids.every((id) => i.shared_by.includes(id))
        ? { ...i, shared_by: [...i.shared_by, person.id] } : i)),
    }));
    setPeople([...people, person]);
    if (!payerId) setPayerId(person.id);
    setName("");
    setError("");
  }

  function removePerson(id) {
    setPeople(people.filter((p) => p.id !== id));
    setDraft((d) => ({ ...d, items: d.items.map((i) => ({ ...i, shared_by: i.shared_by.filter((x) => x !== id) })) }));
    if (payerId === id) setPayerId(people.find((p) => p.id !== id)?.id || null);
  }

  const updatePerson = (id, patch) => setPeople(people.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const updateItem = (id, patch) => setDraft((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  const rows = draft.items.map((item) => ({ item, category: itemCategory(item), sharers: sharersOf(item, people) }));
  const toggle = ({ item, sharers }, pid) => updateItem(item.id, {
    edited: true, shared_by: sharers.includes(pid) ? sharers.filter((x) => x !== pid) : [...sharers, pid],
  });
  const setAll = ({ item }, on) => updateItem(item.id, { edited: true, shared_by: on ? [...ids] : [] });

  const unassigned = rows.filter((r) => r.sharers.length === 0);
  const charges = draft.charges.map((c) => ({ label: c.label.trim(), amount_paise: parseRupees(c.amount), applies_to: chargeAppliesTo(c) }));
  const shares = people.length >= 2 && !unassigned.length
    ? computeShares(ids, rows.map((r) => ({ total_paise: parseRupees(r.item.amount), shared_by: r.sharers, category: r.category })), charges)
    : null;
  const hasAlcohol = rows.some((r) => r.category === "alcohol");
  const paiseWhere = (pred) => rows.filter(pred).reduce((a, r) => a + (parseRupees(r.item.amount) || 0), 0);
  const alcoholPaise = paiseWhere((r) => r.category === "alcohol");
  const foodPaise = paiseWhere((r) => r.category !== "alcohol");
  // Same fallback as the split: a tax with none of its items on the bill is spread over everything.
  const target = (t) => ((t === "alcohol" && !alcoholPaise) || (t === "food" && !foodPaise) ? "all" : t);
  const chargeGroups = ["food", "alcohol", "all"]
    .map((t) => [t, charges.filter((c) => target(c.applies_to) === t).map((c) => c.label)])
    .filter(([, labels]) => labels.length);
  const nobodyDrinks = people.every((p) => !p.drinks);
  const anyDiff = shares && people.some((p) => vsEqual(shares[p.id]));

  const upiOk = isValidUpi(upi);
  const canSave = people.length >= 2 && !unassigned.length && payerId && upiOk && !saving;

  async function save() {
    setSaving(true);
    setError("");
    try {
      const { bill, edit_token } = await createBill({
        merchant: draft.merchant.trim() || null,
        date: draft.date,
        note: draft.merchant.trim().slice(0, 60) || null,
        people: people.map(({ id, name: n, diet, drinks }) => ({ id, name: n, diet, drinks })),
        items: rows.map(({ item: i, category, sharers }) => ({
          id: i.id, name: i.name.trim(), quantity: Number(i.qty) > 0 ? Number(i.qty) : 1,
          total_paise: parseRupees(i.amount), category, shared_by: sharers,
        })),
        charges,
        payer_id: payerId,
        payer_upi: upi.trim(),
      });
      try {
        localStorage.setItem(`bill-token:${bill.id}`, edit_token);
        localStorage.setItem("last-upi", upi.trim());
      } catch { /* private mode: payer just can't mark payments later */ }
      navigate(`/b/${bill.id}`);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Who's splitting?</h2>
        <span className="muted small">{formatPaise(totals.total)} total</span>
      </div>
      <form className="add-person" onSubmit={addPerson}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a name, e.g. Ravi" maxLength={40} aria-label="Name" />
        <button className="btn" type="submit" disabled={!name.trim()}>Add</button>
      </form>

      {people.length > 0 && (
        <div className="people">
          {people.map((p) => (
            <div key={p.id} className="person-row">
              <span className="person-name">{p.name}</span>
              <div className="seg" role="radiogroup" aria-label={`What ${p.name} eats`}>
                {DIETS.map((d) => (
                  <button key={d.key} type="button" role="radio" aria-checked={p.diet === d.key}
                          className={p.diet === d.key ? "on" : ""} onClick={() => updatePerson(p.id, { diet: d.key })}>
                    {d.label}
                  </button>
                ))}
              </div>
              <button type="button" className={`chip drink ${p.drinks ? "on" : ""}`} aria-pressed={p.drinks}
                      onClick={() => updatePerson(p.id, { drinks: !p.drinks })}>🍺 Drinks</button>
              <button type="button" className="x" aria-label={`Remove ${p.name}`} onClick={() => removePerson(p.id)}>×</button>
            </div>
          ))}
          <p className="muted small">Tag who's vegetarian and who drinks. Items are assigned for you, and you can tap to change any of them.</p>
        </div>
      )}

      {people.length >= 2 && (
        <>
          <h3 className="sub">Who had what</h3>
          <div className="assign">
            {rows.map((row) => {
              const { item: i, category, sharers } = row;
              const rule = ruleFor(category, people);
              const everyone = ids.every((p) => sharers.includes(p));
              return (
                <div key={i.id} className={`assign-row ${sharers.length ? "" : "missing"}`}>
                  <div className="assign-top">
                    <span className="assign-name">
                      <CategoryPicker value={category} label={`Type of ${i.name}`} onChange={(v) => updateItem(i.id, { cat: v })} />
                      <span>{i.name}{Number(i.qty) > 1 && <small> ×{i.qty}</small>}</span>
                    </span>
                    <span className="assign-amt">{formatPaise(parseRupees(i.amount))}</span>
                  </div>
                  <div className="assign-rule">
                    {i.edited ? (
                      <>
                        <span>Changed by you</span>
                        <button className="link-btn" onClick={() => updateItem(i.id, { edited: false, shared_by: [] })}>Undo</button>
                      </>
                    ) : (
                      <span>{CATEGORY_LABEL[category]} · {rule.text}</span>
                    )}
                    {!sharers.length && <span className="warn-text">{i.edited ? "Tap who had it." : `${rule.empty} Tap who had it.`}</span>}
                    {!i.edited && sharers.length > 0 && rule.check && <span className="hint-text">{rule.check}</span>}
                  </div>
                  <div className="chips">
                    <button className={`chip ${everyone ? "on" : ""}`} onClick={() => setAll(row, !everyone)}>Everyone</button>
                    {people.map((p) => (
                      <button key={p.id} className={`chip ${sharers.includes(p.id) ? "on" : ""}`}
                              onClick={() => toggle(row, p.id)} aria-pressed={sharers.includes(p.id)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {hasAlcohol && nobodyDrinks && (
            <p className="check warn">
              No one is tagged as drinking, so the drinks aren't assigned yet.{" "}
              <button className="link-btn" onClick={() => setPeople(people.map((p) => ({ ...p, drinks: true })))}>Everyone drank</button>
            </p>
          )}

          <h3 className="sub">Who paid?</h3>
          <div className="chips">
            {people.map((p) => (
              <button key={p.id} className={`chip ${payerId === p.id ? "on" : ""}`} onClick={() => setPayerId(p.id)}>{p.name}</button>
            ))}
          </div>
          <label className="field">
            <span>Their UPI ID (friends pay here)</span>
            <input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@okaxis" autoCapitalize="none"
                   autoCorrect="off" spellCheck={false} className={upi && !upiOk ? "bad" : ""} />
            {upi && !upiOk && <small className="err">That doesn't look like a UPI ID (example: name@okaxis).</small>}
          </label>

          <div className="shares">
            {unassigned.length > 0 && (
              <p className="check warn">{unassigned.length} item{unassigned.length > 1 ? "s" : ""} not assigned yet: {unassigned.map((r) => r.item.name).join(", ")}</p>
            )}
            {shares && (
              <>
                <h3 className="sub">Shares</h3>
                {people.map((p) => {
                  const s = shares[p.id];
                  const vs = vsEqual(s);
                  return (
                    <div key={p.id} className="share-row">
                      <div>
                        <span className="share-name">{p.name}</span> <PersonTags person={p} />
                        {p.id === payerId && <small className="tag">paid</small>}
                        <div className="muted small">
                          {formatPaise(s.items_paise - s.alcohol_paise)} food
                          {s.alcohol_paise > 0 && <> · {formatPaise(s.alcohol_paise)} alcohol</>} · {formatPaise(s.charges_paise)} tax &amp; charges
                        </div>
                      </div>
                      <div className="share-side">
                        <b>{formatPaise(s.total_paise)}</b>
                        {vs && <span className={`vs ${vs.save ? "vs-save" : ""}`}>{vs.text}</span>}
                      </div>
                    </div>
                  );
                })}
                {anyDiff && (
                  <p className="muted small fair-note">
                    An equal split would be {formatPaise(shares[ids[0]].equal_paise)} each. This split charges people for what they
                    actually had.
                  </p>
                )}
                {chargeGroups.length > 0 && (
                  <p className="muted small fair-note">
                    {chargeGroups.map(([t, labels], k) => (
                      <span key={t}>{k > 0 && " · "}<b>{GROUP_TEXT[t]}:</b> {labels.join(", ")}</span>
                    ))}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
      {people.length < 2 && <p className="muted small">Add at least two people to start splitting.</p>}
      {error && <p className="err">{error}</p>}

      <div className="nav">
        <button className="btn btn-soft" onClick={onBack}>Back</button>
        <button className="btn" disabled={!canSave} onClick={save}>{saving ? "Saving…" : "Create share link →"}</button>
      </div>
    </section>
  );
}
