const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");

function errorMessage(data, status) {
  const d = data && data.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, "");
  return `Something went wrong (HTTP ${status}). Please try again.`;
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, options);
  } catch {
    throw new Error("Couldn't reach the server. It may be waking up (free hosting); please try again in a few seconds.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw new Error(errorMessage(data, res.status));
  return data;
}

export function parseReceipt(blob) {
  const form = new FormData();
  form.append("file", blob, "receipt.jpg");
  return request("/api/receipts/parse", { method: "POST", body: form });
}

export function createBill(bill) {
  return request("/api/bills", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bill),
  });
}

export const getBill = (id) => request(`/api/bills/${encodeURIComponent(id)}`);

export function setPaid(id, personId, paid, token) {
  return request(`/api/bills/${encodeURIComponent(id)}/people/${encodeURIComponent(personId)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "X-Edit-Token": token },
    body: JSON.stringify({ paid }),
  });
}

export const warmUp = () => fetch(`${API_URL}/api/health`).catch(() => {});
