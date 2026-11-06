"""Receipt photo -> structured items, using a vision LLM, with the arithmetic checked in code."""
from __future__ import annotations

import base64
import json

from pydantic import ValidationError

from .llm import JSONModel, LLMError
from .rules import applies_to_for, categorize
from .schemas import Charge, Check, Item, LLMReceipt, ParsedReceipt
from .split import rupees_to_paise

PROMPT = """Read this restaurant or shop bill and return ONLY a JSON object:
{
  "is_receipt": true,
  "merchant": "name printed at the top" | null,
  "date": "YYYY-MM-DD" | null,
  "currency": "INR",
  "items": [{"name": "Paneer Tikka", "quantity": 1, "unit_price": 320.0, "total": 320.0, "category": "veg"}],
  "subtotal": number | null,
  "taxes": [{"label": "CGST 2.5%", "amount": 48.75}],
  "service_charge": number | null,
  "discount": number | null,
  "round_off": number | null,
  "total": number | null
}
Rules:
- Copy numbers exactly as printed. Amounts in rupees. Do not calculate anything yourself.
- One entry per printed line item; "total" is the line amount printed on the bill.
- category is one of: "veg" (vegetarian food), "egg" (contains egg but no meat or fish),
  "nonveg" (meat, chicken, fish or seafood), "alcohol" (beer, wine, spirits, cocktails),
  "soft_drink" (any non-alcoholic drink: soft drinks, juice, mocktails, water, tea, coffee),
  "other" (not food or drink, or you are not sure).
- List each tax line separately with its label as printed, e.g. "CGST @ 2.5%" or "VAT on Liquor @ 10%".
- subtotal is the overall subtotal before taxes; if the bill only shows separate food and bar subtotals, use null.
- discount is a positive number (the amount taken off). round_off can be negative.
- If a value is not printed, use null. If the image is not a bill, return {"is_receipt": false}."""

TOLERANCE_PAISE = 100  # ₹1: printed bills round line amounts and totals

_MAGIC = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG": "image/png"}


class ReceiptError(ValueError):
    """A problem with the uploaded image that the user can fix."""


def sniff_image(data: bytes) -> str:
    for magic, mime in _MAGIC.items():
        if data.startswith(magic):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise ReceiptError("Please upload a JPG, PNG or WebP photo of the bill.")


def _fmt(paise: int) -> str:
    return f"₹{paise / 100:,.2f}"


class ReceiptParser:
    def __init__(self, llm: JSONModel, max_image_mb: float = 6.0):
        self.llm = llm
        self.max_bytes = int(max_image_mb * 1024 * 1024)

    def parse(self, data: bytes) -> ParsedReceipt:
        if len(data) > self.max_bytes:
            raise ReceiptError(f"The photo is larger than {self.max_bytes // (1024 * 1024)} MB.")
        mime = sniff_image(data)
        url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
        raw = self._ask(url)
        if not raw.is_receipt:
            raise ReceiptError("This doesn't look like a bill. Try a clearer photo of the whole receipt.")
        if not raw.items:
            raise ReceiptError("No items could be read. Try a sharper, well-lit photo, or add items by hand.")
        return self.normalize(raw)

    def _ask(self, image_url: str) -> LLMReceipt:
        base = [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]}]
        messages, last = base, ""
        for _ in range(2):
            raw = None
            try:
                raw = self.llm.complete_json(messages)
                return LLMReceipt.model_validate(raw)
            except ValidationError as e:
                last = str(e)[:1200]
                messages = base + [
                    {"role": "assistant", "content": json.dumps(raw)[:6000]},
                    {"role": "user", "content": f"That JSON failed validation:\n{last}\nReturn corrected JSON only."},
                ]
            except LLMError:
                raise  # the client already tried every configured model; don't spend more requests
        raise LLMError(f"Could not read the bill: {last[:200]}")

    @staticmethod
    def normalize(r: LLMReceipt) -> ParsedReceipt:
        """Convert to paise and verify the bill's arithmetic. The model reads; code does the math."""
        items: list[Item] = []
        corrected: list[str] = []
        for n, it in enumerate(r.items, start=1):
            name = it.name.strip()
            category, note = categorize(name, it.category)  # the model labels, keywords double-check
            if note:
                corrected.append(f"{name} {note}")
            items.append(Item(id=f"i{n}", name=name, quantity=it.quantity, total_paise=rupees_to_paise(it.total),
                              category=category))

        charges: list[Charge] = [Charge(label=t.label or "Tax", amount_paise=rupees_to_paise(t.amount),
                                        applies_to=applies_to_for(t.label or "Tax")) for t in r.taxes]
        if r.service_charge:
            charges.append(Charge(label="Service charge", amount_paise=rupees_to_paise(r.service_charge)))
        if r.discount:
            charges.append(Charge(label="Discount", amount_paise=-abs(rupees_to_paise(r.discount))))
        if r.round_off:
            charges.append(Charge(label="Round off", amount_paise=rupees_to_paise(r.round_off)))

        checks: list[Check] = []
        bad_lines = []
        for src, it in zip(r.items, items):
            if src.unit_price is not None:
                expected = rupees_to_paise(src.unit_price * src.quantity)
                if abs(expected - it.total_paise) > TOLERANCE_PAISE:
                    bad_lines.append(f"{it.name}: {src.quantity:g} × {_fmt(rupees_to_paise(src.unit_price))} "
                                     f"≠ {_fmt(it.total_paise)}")
        checks.append(Check(name="line_math", passed=not bad_lines,
                            detail="; ".join(bad_lines) if bad_lines else "Quantity × price matches every line"))

        items_sum = sum(i.total_paise for i in items)
        if r.subtotal is not None:
            sub = rupees_to_paise(r.subtotal)
            ok = abs(sub - items_sum) <= TOLERANCE_PAISE
            checks.append(Check(name="subtotal", passed=ok,
                                detail=f"Items add up to {_fmt(items_sum)}" + ("" if ok else f", but the bill says {_fmt(sub)}")))

        computed = items_sum + sum(c.amount_paise for c in charges)
        printed = rupees_to_paise(r.total) if r.total is not None else None
        if printed is not None:
            ok = abs(printed - computed) <= TOLERANCE_PAISE
            checks.append(Check(name="total", passed=ok,
                                detail=f"Matches the printed total {_fmt(printed)}" if ok else
                                f"Items + charges = {_fmt(computed)}, but the bill says {_fmt(printed)}. "
                                "An item or tax may have been misread."))
        else:
            checks.append(Check(name="total", passed=False, detail="No total found on the bill; please double-check."))

        if corrected:
            checks.append(Check(name="categories", passed=True, detail="Double-checked: " + "; ".join(corrected)))
        liquor_taxes = [c.label for c in charges if c.applies_to == "alcohol"]
        if liquor_taxes and not any(i.category == "alcohol" for i in items):
            checks.append(Check(name="tax_targets", passed=False,
                                detail=f"{', '.join(liquor_taxes)} is usually charged on alcohol, but no item is marked "
                                       "as alcohol. Check the item labels."))

        return ParsedReceipt(
            merchant=(r.merchant or "").strip() or None, date=r.date, currency=(r.currency or "INR").upper(),
            items=items, charges=charges, printed_total_paise=printed, computed_total_paise=computed,
            checks=checks, needs_review=not all(c.passed for c in checks),
        )
