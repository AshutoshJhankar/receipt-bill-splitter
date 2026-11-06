import { useMemo, useState } from "react";
import { encodeQR } from "../lib/qr.js";
import { formatPaise } from "../lib/money.js";

const BORDER = 4; // quiet zone, in modules

/** Draw the QR as a PNG: crisp on screen, and a friend can long-press to save it for "scan from gallery". */
function qrImage(text, scale = 8) {
  const qr = encodeQR(text);
  const n = qr.size + BORDER * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  qr.modules.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) ctx.fillRect((x + BORDER) * scale, (y + BORDER) * scale, scale, scale);
  }));
  return { url: canvas.toDataURL("image/png"), modules: n };
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch { /* clipboard blocked: the text is still on screen to copy by hand */ }
  }
  return <button className="btn btn-soft btn-sm" onClick={copy}>{done ? "Copied ✓" : label}</button>;
}

/**
 * Other ways to pay when the "Pay by UPI" link doesn't open (some apps block links to personal UPI IDs):
 * scan the QR from another phone, save it and scan it from the gallery, or copy the UPI ID and amount.
 */
export default function PayOptions({ link, upiId, payeeName, amountPaise, fileName, mobile }) {
  const qr = useMemo(() => qrImage(link), [link]);
  const amount = (amountPaise / 100).toFixed(2);
  return (
    <div className="pay-panel">
      <img className="qr" src={qr.url} width={qr.modules * 4} height={qr.modules * 4}
           alt={`UPI QR code to pay ${formatPaise(amountPaise)} to ${payeeName}`} />
      <div className="pay-how">
        <p><b>{mobile ? "Scan from another phone" : "Scan with your phone's UPI app"}</b><br />
          <span className="muted small">GPay, PhonePe, Paytm or BHIM. Pays {formatPaise(amountPaise)} to {payeeName}.</span></p>
        <p className="pay-line"><span className="muted small">UPI ID</span> <code>{upiId}</code></p>
        <div className="row-btns">
          <CopyButton text={upiId} label="Copy UPI ID" />
          <CopyButton text={amount} label="Copy amount" />
          {mobile && <a className="btn btn-soft btn-sm" href={qr.url} download={fileName}>Save QR</a>}
        </div>
        {mobile && (
          <p className="muted small">Paying from this phone? Save the QR (or long-press it), then in GPay or PhonePe
            tap Scan and pick it from your photos.</p>
        )}
      </div>
    </div>
  );
}
