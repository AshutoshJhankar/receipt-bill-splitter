import { useEffect, useRef, useState } from "react";
import { parseReceipt } from "../api.js";
import { compressImage } from "../lib/image.js";

export default function ScanStep({ onParsed, onManual }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function handle(blob) {
    setError("");
    setBusy(true);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 10000);
    try {
      const small = await compressImage(blob);
      setPreview(URL.createObjectURL(small));
      onParsed(await parseReceipt(small));
    } catch (e) {
      setError(e.message);
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  async function sample() {
    const res = await fetch("/sample-receipt.jpg");
    handle(await res.blob());
  }

  if (busy) {
    return (
      <section className="panel center">
        {preview && <img className="thumb" src={preview} alt="Your bill" />}
        <div className="spin" aria-hidden />
        <h2>Reading your bill…</h2>
        <p className="muted">Finding items, taxes and the total, then checking the math.</p>
        {slow && <p className="muted small">The free server sleeps when idle; the first scan can take up to a minute.</p>}
      </section>
    );
  }

  return (
    <>
      <section className="intro">
        <h1>Split the bill in 30 seconds.</h1>
        <p className="muted">Snap the receipt, tag who's veg and who drinks, and send everyone a UPI link for their exact share, tax and service charge included.</p>
      </section>
      <section className="panel">
        <button className="btn btn-big" onClick={() => input.current?.click()}>📷 Take or upload a photo of the bill</button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && handle(e.target.files[0])} />
        {error && <p className="err">{error}</p>}
        <div className="or"><span>or</span></div>
        <div className="row-btns">
          <button className="btn btn-soft" onClick={sample}>Try a sample bill</button>
          <button className="btn btn-soft" onClick={onManual}>Enter items by hand</button>
        </div>
      </section>
      <ul className="facts">
        <li><b>Veg, non-veg and drinks, sorted.</b> Items are assigned for you, so a vegetarian never pays for the chicken and a non-drinker never pays for the beer.</li>
        <li><b>Each tax on the right items.</b> GST is split over food, liquor VAT only among those who drank, service charge over everything.</li>
        <li><b>AI reads, code calculates.</b> The model only reads the bill. Totals and shares are worked out in exact paise, and checked against the printed total.</li>
      </ul>
    </>
  );
}
