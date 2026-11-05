import { useEffect, useState } from "react";
import { getBill, setPaid } from "../api.js";
import { navigate } from "../lib/nav.js";
import { formatPaise } from "../lib/money.js";
import { upiLink } from "../lib/upi.js";

const readToken = (id) => {
  try { return localStorage.getItem(`bill-token:${id}`); } catch { return null; }
};
function prettyDate(bill) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(bill.date || "") ? new Date(`${bill.date}T00:00:00`) : new Date(bill.created_at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export default function BillView({ id }) {
  const [bill, setBill] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [copied, setCopied] = useState(false);
  const token = readToken(id);

  useEffect(() => {
    getBill(id).then(setBill).catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <section className="panel center">
        <h2>Couldn't open this bill</h2>
        <p className="muted">{error}</p>
        <button className="btn" onClick={() => navigate("/")}>Split a new bill</button>
      </section>
    );
  }
  if (!bill) return <section className="panel center"><div className="spin" aria-hidden /><p className="muted">Loading bill…</p></section>;

  const url = window.location.href;
  const owed = bill.shares.filter((s) => !s.is_payer);
  const pending = owed.filter((s) => !s.paid);
  const title = bill.merchant || "Shared bill";
  const shareText = [
    `🧾 ${title}: ${formatPaise(bill.total_paise)}, paid by ${bill.payer_name}`,
    "",
    ...owed.map((s) => `${s.name}: ${formatPaise(s.total_paise)}`),
    "",
    `Tap to pay your share by UPI: ${url}`,
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  async function toggle(share) {
    setBusy(share.person_id);
    try {
      setBill(await setPaid(bill.id, share.person_id, !share.paid, token));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="panel bill-head">
        <span className="muted small">{prettyDate(bill)}</span>
        <h1>{title}</h1>
        <p className="big">{formatPaise(bill.total_paise)}</p>
        <p className="muted">Paid by <b>{bill.payer_name}</b> · UPI <code>{bill.payer_upi}</code></p>
        <p className="progress-line">
          {pending.length === 0 ? "✓ Everyone has paid" : `${owed.length - pending.length} of ${owed.length} paid`}
        </p>
      </section>

      {token && (
        <section className="panel owner">
          <h2>Send this to the group</h2>
          <div className="row-btns">
            <a className="btn btn-wa" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
            <button className="btn btn-soft" onClick={copy}>{copied ? "Link copied ✓" : "Copy link"}</button>
            {navigator.share && (
              <button className="btn btn-soft" onClick={() => navigator.share({ title, text: shareText }).catch(() => {})}>More…</button>
            )}
          </div>
          <p className="muted small">You created this bill, so you can mark people as paid below.</p>
        </section>
      )}

      <section className="panel">
        <h2>Shares</h2>
        <div className="owed">
          {bill.shares.map((s) => (
            <div key={s.person_id} className={`owe ${s.paid && !s.is_payer ? "paid" : ""}`}>
              <div className="owe-main">
                <b>{s.name}</b>
                <span className="muted small">{formatPaise(s.items_paise)} food + {formatPaise(s.charges_paise)} tax/charges</span>
              </div>
              <div className="owe-side">
                <span className="owe-amt">{formatPaise(s.total_paise)}</span>
                {s.is_payer ? (
                  <span className="tag">paid the bill</span>
                ) : s.paid ? (
                  <span className="tag tag-ok">paid ✓</span>
                ) : (
                  <a className="btn btn-sm" href={upiLink({ upiId: bill.payer_upi, payeeName: bill.payer_name, amountPaise: s.total_paise, note: bill.note || title })}>
                    Pay by UPI
                  </a>
                )}
                {token && !s.is_payer && (
                  <button className="link-btn" disabled={busy === s.person_id} onClick={() => toggle(s)}>
                    {s.paid ? "Mark unpaid" : "Mark paid"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!isMobile() && pending.length > 0 && (
          <p className="muted small">"Pay by UPI" opens GPay, PhonePe, Paytm or any UPI app. Open this link on your phone to pay.</p>
        )}
      </section>

      <details className="panel items-detail">
        <summary>What everyone had ({bill.items.length} items)</summary>
        {bill.items.map((i) => (
          <div key={i.id} className="detail-row">
            <span>{i.name}{i.quantity > 1 && <small> ×{i.quantity}</small>}</span>
            <span className="muted small">{i.shared_by.map((pid) => bill.people.find((p) => p.id === pid)?.name).join(", ")}</span>
            <span>{formatPaise(i.total_paise)}</span>
          </div>
        ))}
        {bill.charges.map((c, k) => (
          <div key={k} className="detail-row charge"><span>{c.label}</span><span className="muted small">shared by what you ordered</span><span>{formatPaise(c.amount_paise)}</span></div>
        ))}
      </details>

      <p className="center"><button className="link-btn" onClick={() => navigate("/")}>Split another bill</button></p>
    </>
  );
}
