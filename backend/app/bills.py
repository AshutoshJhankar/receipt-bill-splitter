"""Create, read and update split bills. Shares are always recomputed on the server."""
from __future__ import annotations

import hashlib
import hmac
import secrets

from .schemas import Bill, BillCreated, BillIn, Share
from .split import compute_shares
from .store import BillStore


class BillNotFound(LookupError):
    pass


class Forbidden(PermissionError):
    pass


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def build_shares(bill: BillIn, paid: dict[str, bool] | None = None) -> list[Share]:
    paid = paid or {}
    ids = [p.id for p in bill.people]
    computed = compute_shares(
        ids,
        [{"total_paise": i.total_paise, "shared_by": i.shared_by} for i in bill.items],
        sum(c.amount_paise for c in bill.charges),
    )
    return [
        Share(person_id=p.id, name=p.name, is_payer=p.id == bill.payer_id,
              paid=p.id == bill.payer_id or paid.get(p.id, False), **computed[p.id])
        for p in bill.people
    ]


def _to_bill(row: dict) -> Bill:
    data = BillIn.model_validate(row["data"])
    shares = build_shares(data, row["data"].get("paid", {}))
    payer = next(p for p in data.people if p.id == data.payer_id)
    return Bill(
        id=row["id"], created_at=row["created_at"], merchant=data.merchant, date=data.date, note=data.note,
        payer_name=payer.name, payer_upi=data.payer_upi, total_paise=sum(s.total_paise for s in shares),
        items=data.items, charges=data.charges, people=data.people, shares=shares,
    )


class BillService:
    def __init__(self, store: BillStore):
        self.store = store

    def create(self, bill: BillIn) -> BillCreated:
        shares = build_shares(bill)  # validates assignments before anything is stored
        token = secrets.token_urlsafe(24)
        row = self.store.insert({
            "merchant": bill.merchant,
            "total_paise": sum(s.total_paise for s in shares),
            "data": {**bill.model_dump(mode="json"), "paid": {}},
            "edit_token_hash": _hash(token),
        })
        return BillCreated(bill=_to_bill(row), edit_token=token)

    def get(self, bill_id: str) -> Bill:
        row = self.store.get(bill_id)
        if row is None:
            raise BillNotFound(bill_id)
        return _to_bill(row)

    def set_paid(self, bill_id: str, person_id: str, paid: bool, token: str | None) -> Bill:
        row = self.store.get(bill_id)
        if row is None:
            raise BillNotFound(bill_id)
        if not token or not hmac.compare_digest(_hash(token), row["edit_token_hash"]):
            raise Forbidden("Only the person who created this bill can mark payments")
        if person_id not in {p["id"] for p in row["data"]["people"]}:
            raise BillNotFound(person_id)
        data = dict(row["data"])
        data["paid"] = {**data.get("paid", {}), person_id: paid}
        return _to_bill(self.store.update(bill_id, {"data": data}))
