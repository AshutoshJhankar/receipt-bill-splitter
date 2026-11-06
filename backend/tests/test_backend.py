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
from app.rules import applies_to_for, categorize, normalize_category  # noqa: E402
from app.schemas import BillIn, LLMItem, LLMReceipt  # noqa: E402
from app.split import compute_shares, rupees_to_paise  # noqa: E402
from app.store import MemoryStore, SupabaseStore  # noqa: E402

CASES = json.loads((ROOT / "tests/split_cases.json").read_text())
RULES = json.loads((ROOT / "tests/rules_cases.json").read_text(encoding="utf-8"))
SAMPLE_JPG = (ROOT.parent / "frontend/public/sample-receipt.jpg").read_bytes()

# What a vision model returns for frontend/public/sample-receipt.jpg (food, beer, GST and liquor VAT).
SAMPLE_REPLY = {
    "is_receipt": True, "merchant": "THE COPPER LANTERN", "date": "2026-11-05", "currency": "INR",
    "items": [
        {"name": "Paneer Tikka", "quantity": 1, "unit_price": 320, "total": 320, "category": "veg"},
        {"name": "Chicken 65", "quantity": 1, "unit_price": 340, "total": 340, "category": "nonveg"},
        {"name": "Butter Chicken", "quantity": 1, "unit_price": 420, "total": 420, "category": "nonveg"},
        {"name": "Dal Makhani", "quantity": 1, "unit_price": 280, "total": 280, "category": "veg"},
        {"name": "Butter Naan", "quantity": 4, "unit_price": 60, "total": 240, "category": "veg"},
        {"name": "Jeera Rice", "quantity": 1, "unit_price": 220, "total": 220, "category": "veg"},
        {"name": "Fresh Lime Soda", "quantity": 2, "unit_price": 90, "total": 180, "category": "soft_drink"},
        {"name": "Kingfisher Premium", "quantity": 3, "unit_price": 250, "total": 750, "category": "alcohol"},
    ],
    "subtotal": 2750,
    "taxes": [{"label": "CGST @ 2.5%", "amount": 50}, {"label": "SGST @ 2.5%", "amount": 50},
              {"label": "VAT (Liquor) @ 10%", "amount": 75}],
    "service_charge": 137.5, "discount": None, "round_off": -0.5, "total": 3062,
}


def PROMPT_TEXT(llm):  # noqa: N802
    return llm.calls[0][0]["content"][0]["text"]


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

def _charges(case):
    return case["charges"] if "charges" in case else case["charges_paise"]


def _charges_sum(case):
    return sum(c["amount_paise"] for c in case["charges"]) if "charges" in case else case["charges_paise"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_split_cases(case):
    got = compute_shares(case["people"], case["items"], _charges(case))
    bill_total = sum(i["total_paise"] for i in case["items"]) + _charges_sum(case)
    assert {p: v["total_paise"] for p, v in got.items()} == case["expected"]
    assert sum(v["total_paise"] for v in got.values()) == bill_total
    assert sum(v["equal_paise"] for v in got.values()) == bill_total
    if "expected_equal" in case:
        assert {p: v["equal_paise"] for p, v in got.items()} == case["expected_equal"]
    for v in got.values():
        assert v["items_paise"] + v["charges_paise"] == v["total_paise"]
        assert 0 <= v["alcohol_paise"] <= v["items_paise"]


def test_split_alcohol_portion_and_no_liquor_vat_for_non_drinkers():
    case = next(c for c in CASES if c["name"].startswith("mixed group"))
    got = compute_shares(case["people"], case["items"], case["charges"])
    assert got["ravi"]["alcohol_paise"] == got["kabir"]["alcohol_paise"] == 37500
    assert got["asha"]["alcohol_paise"] == got["meera"]["alcohol_paise"] == 0
    # Asha (veg, doesn't drink) pays 1/4 of the veg dishes plus her part of GST and service charge only.
    assert got["asha"]["items_paise"] == 31000 and got["asha"]["charges_paise"] == 1550 + 1544


# ---------- food and drink rules (same cases as the frontend's rules.js) ----------

@pytest.mark.parametrize("case", RULES["categories"], ids=[c["name"] for c in RULES["categories"]])
def test_categories(case):
    category, note = categorize(case["name"], case["ai"])
    assert category == case["expected"]
    assert (note is not None) == case.get("corrected", False)


@pytest.mark.parametrize("case", RULES["applies_to"], ids=[c["label"] for c in RULES["applies_to"]])
def test_applies_to(case):
    assert applies_to_for(case["label"]) == case["expected"]


def test_category_labels_are_normalized_and_never_fail_validation():
    assert normalize_category("Non-Veg") == "nonveg" and normalize_category("SOFT_DRINK") == "soft_drink"
    assert normalize_category("spaceship") == "other" and normalize_category(None) == "other"
    assert LLMItem(name="X", total=1, category=["veg"]).category is None
    assert len(LLMItem(name="X", total=1, category="v" * 500).category) == 40


def test_split_rejects_unassigned_item():
    with pytest.raises(ValueError):
        compute_shares(["a"], [{"total_paise": 100, "shared_by": []}], 0)


def test_rupees_to_paise_avoids_float_drift():
    assert rupees_to_paise(48.75) == 4875 and rupees_to_paise(0.1 + 0.2) == 30 and rupees_to_paise(None) == 0


# ---------- receipt parsing ----------

def test_parses_sample_receipt_and_checks_math():
    llm = ScriptedLLM([SAMPLE_REPLY])
    r = ReceiptParser(llm).parse(SAMPLE_JPG)
    assert len(r.items) == 8 and r.computed_total_paise == 306200 and r.printed_total_paise == 306200
    assert not r.needs_review and all(c.passed for c in r.checks)
    assert [i.category for i in r.items] == ["veg", "nonveg", "nonveg", "veg", "veg", "veg", "soft_drink", "alcohol"]
    assert {c.label: c.applies_to for c in r.charges} == {
        "CGST @ 2.5%": "food", "SGST @ 2.5%": "food", "VAT (Liquor) @ 10%": "alcohol",
        "Service charge": "all", "Round off": "all"}
    assert "category" in PROMPT_TEXT(llm)
    content = llm.calls[0][0]["content"]
    assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_misread_line_and_total_are_flagged():
    bad = json.loads(json.dumps(SAMPLE_REPLY))
    bad["items"][3]["total"] = 180  # model misread 280 as 180
    r = ReceiptParser(ScriptedLLM([bad])).parse(SAMPLE_JPG)
    failed = {c.name: c.detail for c in r.checks if not c.passed}
    assert r.needs_review
    assert "Dal Makhani" in failed["line_math"]
    assert "subtotal" in failed and "total" in failed


def test_discount_and_round_off_become_signed_charges():
    reply = {**SAMPLE_REPLY, "discount": 100, "round_off": -0.5, "total": 2962}
    r = ReceiptParser(ScriptedLLM([reply])).parse(SAMPLE_JPG)
    by_label = {c.label: c.amount_paise for c in r.charges}
    assert by_label["Discount"] == -10000 and by_label["Round off"] == -50
    assert r.computed_total_paise == 296200 and not r.needs_review


def test_wrong_ai_labels_are_corrected_and_reported():
    reply = json.loads(json.dumps(SAMPLE_REPLY))
    reply["items"][1]["category"] = "veg"         # Chicken 65 labelled veg
    reply["items"][7]["category"] = "soft_drink"  # beer labelled as a soft drink
    reply["items"][5].pop("category")             # Jeera Rice not labelled at all
    r = ReceiptParser(ScriptedLLM([reply])).parse(SAMPLE_JPG)
    assert [i.category for i in r.items][1::2] == ["nonveg", "veg", "veg", "alcohol"]
    note = next(c for c in r.checks if c.name == "categories")
    assert note.passed and "Chicken 65 marked non-veg" in note.detail and "Kingfisher Premium marked alcohol" in note.detail
    assert not r.needs_review  # a corrected label is not an error in the bill


def test_liquor_tax_without_alcohol_items_is_flagged():
    reply = json.loads(json.dumps(SAMPLE_REPLY))
    reply["items"][7].update(name="Item 8", category="other")
    r = ReceiptParser(ScriptedLLM([reply])).parse(SAMPLE_JPG)
    failed = {c.name: c.detail for c in r.checks if not c.passed}
    assert "VAT (Liquor) @ 10%" in failed["tax_targets"] and r.needs_review


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
    assert len(r.items) == 8
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


def test_bill_with_tags_categories_and_tax_targets():
    case = next(c for c in CASES if c["name"].startswith("mixed group"))
    names = {"asha": ("Asha", "veg", False), "ravi": ("Ravi", "nonveg", True),
             "meera": ("Meera", "nonveg", False), "kabir": ("Kabir", "nonveg", True)}
    labels = ["CGST @ 2.5%", "SGST @ 2.5%", "VAT (Liquor) @ 10%", "Service charge", "Round off"]
    bill = BillIn.model_validate({
        "people": [{"id": k, "name": n, "diet": d, "drinks": dr} for k, (n, d, dr) in names.items()],
        "items": [{"id": f"i{k}", "name": f"Item {k}", **i} for k, i in enumerate(case["items"])],
        "charges": [{"label": label, **c} for label, c in zip(labels, case["charges"])],
        "payer_id": "ravi", "payer_upi": "ravi@okicici",
    })
    created = BillService(MemoryStore()).create(bill).bill
    assert {s.person_id: s.total_paise for s in created.shares} == case["expected"]
    assert {s.equal_paise for s in created.shares} == {76550} and created.total_paise == 306200
    assert created.people[0].diet == "veg" and created.people[1].drinks
    assert created.charges[2].applies_to == "alcohol" and created.items[7].category == "alcohol"
    with pytest.raises(ValidationError):
        BillIn.model_validate({**bill.model_dump(), "people": [{"id": "x", "name": "X", "diet": "pescatarian"}]})


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
