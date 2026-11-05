import { useMemo, useState } from "react";
import { createBill } from "../api.js";
import { formatPaise, parseRupees } from "../lib/money.js";
import { computeShares } from "../lib/split.js";
import { isValidUpi } from "../lib/upi.js";
import { navigate, newId } from "../lib/nav.js";
import { draftTotals } from "./ReviewStep.jsx";

const readUpi = () => {
  try { return localStorage.getItem("last-upi") || ""; } catch { return ""; }
};

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
    const person = { id: newId("p"), name: n.slice(0, 40) };
    // Items currently shared by everyone stay shared by everyone, including the new person.
    setDraft((d) => ({
      ...d,
      items: d.items.map((i) => (i.shared_by.length === people.length ? { ...i, shared_by: [...i.shared_by, person.id] } : i)),
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

  const toggle = (itemId, pid) => setDraft((d) => ({
    ...d,
    items: d.items.map((i) => (i.id !== itemId ? i : {
      ...i, shared_by: i.shared_by.includes(pid) ? i.shared_by.filter((x) => x !== pid) : [...i.shared_by, pid],
    })),
  }));
  const setAll = (itemId, on) => setDraft((d) => ({
    ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, shared_by: on ? [...ids] : [] } : i)),
  }));

  const unassigned = draft.items.filter((i) => !i.shared_by.some((p) => ids.includes(p)));
  const shares = useMemo(() => {
    if (people.length === 0 || unassigned.length) return null;
    return computeShares(ids, draft.items.map((i) => ({ total_paise: parseRupees(i.amount), shared_by: i.shared_by })),
      totals.chargesSum);
  }, [draft, people]); // eslint-disable-line react-hooks/exhaustive-deps

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
        people,
        items: draft.items.map((i) => ({
          id: i.id, name: i.name.trim(), quantity: Number(i.qty) > 0 ? Number(i.qty) : 1,
          total_paise: parseRupees(i.amount), shared_by: i.shared_by.filter((p) => ids.includes(p)),
        })),
        charges: draft.charges.map((c) => ({ label: c.label.trim(), amount_paise: parseRupees(c.amount) })),
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
            <span key={p.id} className="person">
              {p.name}
              <button aria-label={`Remove ${p.name}`} onClick={() => removePerson(p.id)}>×</button>
            </span>
          ))}
        </div>
      )}

      {people.length >= 2 && (
        <>
          <h3 className="sub">Tap who shared each item</h3>
          <div className="assign">
            {draft.items.map((i) => {
              const everyone = ids.every((p) => i.shared_by.includes(p));
              return (
                <div key={i.id} className={`assign-row ${i.shared_by.some((p) => ids.includes(p)) ? "" : "missing"}`}>
                  <div className="assign-top">
                    <span className="assign-name">{i.name}{Number(i.qty) > 1 && <small> ×{i.qty}</small>}</span>
                    <span className="assign-amt">{formatPaise(parseRupees(i.amount))}</span>
                  </div>
                  <div className="chips">
                    <button className={`chip ${everyone ? "on" : ""}`} onClick={() => setAll(i.id, !everyone)}>Everyone</button>
                    {people.map((p) => (
                      <button key={p.id} className={`chip ${i.shared_by.includes(p.id) ? "on" : ""}`}
                              onClick={() => toggle(i.id, p.id)} aria-pressed={i.shared_by.includes(p.id)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

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
              <p className="check warn">{unassigned.length} item{unassigned.length > 1 ? "s" : ""} not assigned yet: {unassigned.map((i) => i.name).join(", ")}</p>
            )}
            {shares && people.map((p) => (
              <div key={p.id} className="share-row">
                <span>{p.name}{p.id === payerId && <small className="tag">paid</small>}</span>
                <span className="muted small">{formatPaise(shares[p.id].items_paise)} + {formatPaise(shares[p.id].charges_paise)} tax/charges</span>
                <b>{formatPaise(shares[p.id].total_paise)}</b>
              </div>
            ))}
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
