import { useState } from "react";
import ScanStep from "./ScanStep.jsx";
import ReviewStep from "./ReviewStep.jsx";
import SplitStep from "./SplitStep.jsx";
import { paiseToInput } from "../lib/money.js";
import { newId } from "../lib/nav.js";


/** API receipt (paise) -> editable form state (text inputs). */
function toDraft(r) {
  return {
    merchant: r.merchant || "",
    date: r.date || null,
    printedTotal: r.printed_total_paise ?? null,
    checks: r.checks || [],
    items: r.items.map((i) => ({
      id: i.id || newId("i"), name: i.name, qty: String(i.quantity ?? 1), amount: paiseToInput(i.total_paise), shared_by: [],
    })),
    charges: r.charges.map((c) => ({ id: newId("c"), label: c.label, amount: paiseToInput(c.amount_paise) })),
  };
}

const EMPTY = { merchant: "", date: null, printedTotal: null, checks: [], items: [{ id: newId("i"), name: "", qty: "1", amount: "", shared_by: [] }], charges: [] };
const STEPS = [["scan", "Scan"], ["review", "Check"], ["split", "Split"]];

export default function NewBill() {
  const [step, setStep] = useState("scan");
  const [draft, setDraft] = useState(null);
  const [people, setPeople] = useState([]);

  return (
    <>
      <ol className="stepper">
        {STEPS.map(([key, label], i) => (
          <li key={key} className={step === key ? "on" : STEPS.findIndex(([k]) => k === step) > i ? "done" : ""}>
            <span>{i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {step === "scan" && (
        <ScanStep
          onParsed={(r) => { setDraft(toDraft(r)); setStep("review"); }}
          onManual={() => { setDraft({ ...EMPTY, items: EMPTY.items.map((i) => ({ ...i })) }); setStep("review"); }}
        />
      )}
      {step === "review" && draft && (
        <ReviewStep draft={draft} setDraft={setDraft} onBack={() => setStep("scan")} onNext={() => setStep("split")} />
      )}
      {step === "split" && draft && (
        <SplitStep draft={draft} setDraft={setDraft} people={people} setPeople={setPeople} onBack={() => setStep("review")} />
      )}
    </>
  );
}
