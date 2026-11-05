"""Bill splitter tests: split math, receipt checks, bill service, storage. No network needed."""
import io
import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.bills import BillNotFound, BillService, Forbidden  # noqa: E402
from app.llm import LLMError  # noqa: E402
from app.receipt import ReceiptError, ReceiptParser, sniff_image  # noqa: E402
from app.schemas import BillIn, LLMReceipt  # noqa: E402
from app.split import compute_shares, rupees_to_paise  # noqa: E402
from app.store import MemoryStore, SupabaseStore  # noqa: E402

CASES = json.loads((ROOT / "tests/split_cases.json").read_text())
SAMPLE_JPG = (ROOT.parent / "frontend/public/sample-receipt.jpg").read_bytes()

SAMPLE_REPLY = {
    "is_receipt": True, "merchant": "THE COPPER LANTERN", "date": "2026-11-05", "currency": "INR",
    "items": [
        {"name": "Paneer Tikka", "quantity": 1, "unit_price": 320, "total": 320},
        {"name": "Butter Naan", "quantity": 4, "unit_price": 60, "total": 240},
        {"name": "Dal Makhani", "quantity": 1, "unit_price": 280, "total": 280},
        {"name": "Veg Biryani", "quantity": 2, "unit_price": 300, "total": 600},
        {"name": "Fresh Lime Soda", "quantity": 3, "unit_price": 90, "total": 270},
        {"name": "Gulab Jamun", "quantity": 2, "unit_price": 120, "total": 240},
    ],
    "subtotal": 1950, "taxes": [{"label": "CGST @ 2.5%", "amount": 48.75}, {"label": "SGST @ 2.5%", "amount": 48.75}],
    "service_charge": 97.5, "discount": None, "round_off": None, "total": 2145,
}


class ScriptedLLM:
    name = "scripted"

    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def complete_json(self, messages):
        self.calls.append(messages)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


# ---------- split math ----------

@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_split_cases(case):
    got = compute_shares(case["people"], case["items"], case["charges_paise"])
    assert {p: v["total_paise"] for p, v in got.items()} == case["expected"]
    assert sum(v["total_paise"] for v in got.values()) == sum(i["total_paise"] for i in case["items"]) + case["charges_paise"]


def test_split_rejects_unassigned_item():
    with pytest.raises(ValueError):
        compute_shares(["a"], [{"total_paise": 100, "shared_by": []}], 0)


def test_rupees_to_paise_avoids_float_drift():
    assert rupees_to_paise(48.75) == 4875 and rupees_to_paise(0.1 + 0.2) == 30 and rupees_to_paise(None) == 0


# ---------- receipt parsing ----------

def test_parses_sample_receipt_and_checks_math():
    llm = ScriptedLLM([SAMPLE_REPLY])
    r = ReceiptParser(llm).parse(SAMPLE_JPG)
    assert len(r.items) == 6 and r.computed_total_paise == 214500 and r.printed_total_paise == 214500
    assert not r.needs_review and all(c.passed for c in r.checks)
    content = llm.calls[0][0]["content"]
    assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_misread_line_and_total_are_flagged():
    bad = json.loads(json.dumps(SAMPLE_REPLY))
    bad["items"][3]["total"] = 500  # model misread 600 as 500
    r = ReceiptParser(ScriptedLLM([bad])).parse(SAMPLE_JPG)
    failed = {c.name: c.detail for c in r.checks if not c.passed}
    assert r.needs_review
    assert "Veg Biryani" in failed["line_math"]
    assert "subtotal" in failed and "total" in failed


def test_discount_and_round_off_become_signed_charges():
    reply = {**SAMPLE_REPLY, "discount": 100, "round_off": -0.5, "total": 2044.5}
    r = ReceiptParser(ScriptedLLM([reply])).parse(SAMPLE_JPG)
    by_label = {c.label: c.amount_paise for c in r.charges}
    assert by_label["Discount"] == -10000 and by_label["Round off"] == -50
    assert r.computed_total_paise == 204450 and not r.needs_review


def test_not_a_receipt_and_bad_files():
    with pytest.raises(ReceiptError, match="doesn't look like a bill"):
        ReceiptParser(ScriptedLLM([{"is_receipt": False}])).parse(SAMPLE_JPG)
    with pytest.raises(ReceiptError):
        sniff_image(b"%PDF-1.7 not an image")
    with pytest.raises(ReceiptError, match="larger"):
        ReceiptParser(ScriptedLLM([]), max_image_mb=0.0001).parse(SAMPLE_JPG)
    assert sniff_image(b"\x89PNG\r\n") == "image/png"
    assert sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"


def test_invalid_json_gets_one_repair_then_fails():
    bad = {"items": [{"name": "", "total": -5}]}
    r = ReceiptParser(ScriptedLLM([bad, SAMPLE_REPLY])).parse(SAMPLE_JPG)
    assert len(r.items) == 6
    with pytest.raises(LLMError):
        ReceiptParser(ScriptedLLM([bad, bad])).parse(SAMPLE_JPG)
    with pytest.raises(LLMError):
        ReceiptParser(ScriptedLLM([LLMError("HTTP 429: quota")])).parse(SAMPLE_JPG)


# ---------- bills ----------

def bill_in(**over):
    base = {
        "merchant": "The Copper Lantern", "date": "2026-11-05",
        "people": [{"id": "p1", "name": "Asha"}, {"id": "p2", "name": "Ravi"}, {"id": "p3", "name": "Meera"}],
        "items": [
            {"id": "i1", "name": "Paneer Tikka", "total_paise": 32000, "shared_by": ["p1", "p2", "p3"]},
            {"id": "i2", "name": "Veg Biryani", "quantity": 2, "total_paise": 60000, "shared_by": ["p2", "p3"]},
            {"id": "i3", "name": "Gulab Jamun", "total_paise": 24000, "shared_by": ["p3"]},
        ],
        "charges": [{"label": "GST", "amount_paise": 5800}, {"label": "Service charge", "amount_paise": 5800}],
        "payer_id": "p1", "payer_upi": "asha.k@okaxis",
    }
    base.update(over)
    return BillIn.model_validate(base)


def test_create_get_and_mark_paid():
    svc = BillService(MemoryStore())
    created = svc.create(bill_in())
    bill = created.bill
    assert bill.total_paise == 32000 + 60000 + 24000 + 11600
    assert sum(s.total_paise for s in bill.shares) == bill.total_paise
    payer = next(s for s in bill.shares if s.is_payer)
    assert payer.name == "Asha" and payer.paid
    assert svc.get(bill.id).payer_upi == "asha.k@okaxis"

    with pytest.raises(Forbidden):
        svc.set_paid(bill.id, "p2", True, "wrong-token")
    with pytest.raises(Forbidden):
        svc.set_paid(bill.id, "p2", True, None)
    updated = svc.set_paid(bill.id, "p2", True, created.edit_token)
    assert next(s for s in updated.shares if s.person_id == "p2").paid
    assert not next(s for s in updated.shares if s.person_id == "p3").paid
    with pytest.raises(BillNotFound):
        svc.set_paid(bill.id, "nobody", True, created.edit_token)
    with pytest.raises(BillNotFound):
        svc.get("00000000-0000-0000-0000-000000000000")
    assert "edit_token_hash" not in updated.model_dump()


@pytest.mark.parametrize("over, msg", [
    ({"payer_upi": "not-a-upi"}, "valid UPI ID"),
    ({"payer_id": "p9"}, "must be one of the people"),
    ({"people": [{"id": "p1", "name": "Asha"}, {"id": "p2", "name": "asha"}]}, "same name"),
    ({"items": [{"id": "i1", "name": "X", "total_paise": 100, "shared_by": ["p7"]}]}, "unknown person"),
    ({"items": [{"id": "i1", "name": "X", "total_paise": 100, "shared_by": []}]}, "at least 1"),
])
def test_bill_validation(over, msg):
    with pytest.raises(ValidationError, match=msg):
        bill_in(**over)


# ---------- Supabase store ----------

class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_supabase_store_request_shapes():
    sent, db = [], {}
    rid = "0b6c2a3e-1f2d-4c5b-9a8e-7d6c5b4a3f21"

    def opener(req, timeout):
        sent.append(req)
        body = json.loads(req.data) if req.data else {}
        if req.get_method() == "POST":
            db.update({**body, "id": rid, "created_at": "2026-11-05T10:00:00+00:00"})
        elif req.get_method() == "PATCH":
            db.update(body)
        return _Resp(json.dumps([db]).encode())

    store = SupabaseStore("https://proj.supabase.co", "eyJlegacy.jwt.key", opener=opener)
    svc = BillService(store)
    created = svc.create(bill_in())
    svc.set_paid(created.bill.id, "p3", True, created.edit_token)

    post, get, patch = sent[0], sent[1], sent[2]
    assert post.get_method() == "POST" and post.full_url == "https://proj.supabase.co/rest/v1/bills"
    assert post.get_header("Authorization") == "Bearer eyJlegacy.jwt.key"  # legacy keys use both headers
    body = json.loads(post.data)
    assert set(body) == {"merchant", "total_paise", "data", "edit_token_hash", "expires_at"}
    assert created.edit_token not in json.dumps(body)  # only the hash is stored
    assert get.get_method() == "GET" and f"id=eq.{rid}" in get.full_url
    assert patch.get_method() == "PATCH" and json.loads(patch.data)["data"]["paid"] == {"p3": True}
    assert store.get("'; drop table bills;--") is None
