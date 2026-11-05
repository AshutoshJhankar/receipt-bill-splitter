// UPI deep links (NPCI "upi://pay" format). Any UPI app on the phone (GPay, PhonePe, Paytm, BHIM) opens them.

export const UPI_ID = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export const isValidUpi = (v) => UPI_ID.test(String(v || "").trim());

export function upiLink({ upiId, payeeName, amountPaise, note }) {
  const params = [
    ["pa", upiId.trim()],
    ["pn", payeeName],
    ["am", (amountPaise / 100).toFixed(2)],
    ["cu", "INR"],
    ["tn", (note || "Bill split").slice(0, 50)],
  ];
  // encodeURIComponent (not URLSearchParams) so spaces become %20; some UPI apps mishandle "+".
  return "upi://pay?" + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
