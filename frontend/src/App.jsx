import { useEffect, useState } from "react";
import { warmUp } from "./api.js";
import NewBill from "./components/NewBill.jsx";
import BillView from "./components/BillView.jsx";
import { navigate } from "./lib/nav.js";

const billIdFromPath = () => {
  const m = window.location.pathname.match(/^\/b\/([0-9a-f-]{36})$/i);
  return m ? m[1] : null;
};

export default function App() {
  const [billId, setBillId] = useState(billIdFromPath);

  useEffect(() => {
    warmUp();
    const onPop = () => setBillId(billIdFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="app">
      <header className="bar">
        <a className="logo" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
          <span className="logo-mark" aria-hidden>₹</span> Bill Splitter
        </a>
        <span className="bar-note">snap · tap · pay by UPI</span>
      </header>
      <main className="wrap">{billId ? <BillView id={billId} key={billId} /> : <NewBill />}</main>
      <footer className="foot">Receipt photos are read and discarded; only the split is saved (90 days).</footer>
    </div>
  );
}
