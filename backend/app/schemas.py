"""Contracts for receipt parsing and saved bills. Money in the API is always integer paise."""
from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

UPI_ID = re.compile(r"^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$")
MAX_PAISE = 10_000_000_00  # ₹1 crore


# ---------- what the vision model returns (rupees, loosely typed, validated here) ----------

class LLMItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    quantity: float = Field(default=1, gt=0, le=1000)
    unit_price: float | None = Field(default=None, ge=0)
    total: float = Field(ge=0)


class LLMTax(BaseModel):
    label: str = Field(default="Tax", max_length=60)
    amount: float


class LLMReceipt(BaseModel):
    is_receipt: bool = True
    merchant: str | None = Field(default=None, max_length=120)
    date: str | None = Field(default=None, max_length=20)
    currency: str = Field(default="INR", max_length=3)
    items: list[LLMItem] = Field(default_factory=list, max_length=100)
    subtotal: float | None = None
    taxes: list[LLMTax] = Field(default_factory=list, max_length=10)
    service_charge: float | None = None
    discount: float | None = None
    round_off: float | None = None
    total: float | None = None


# ---------- API: parsed receipt ----------

class Item(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    quantity: float = Field(default=1, gt=0, le=1000)
    total_paise: int = Field(ge=0, le=MAX_PAISE)


class Charge(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    amount_paise: int = Field(ge=-MAX_PAISE, le=MAX_PAISE)  # discounts are negative


class Check(BaseModel):
    name: str
    passed: bool
    detail: str


class ParsedReceipt(BaseModel):
    merchant: str | None
    date: str | None
    currency: str
    items: list[Item]
    charges: list[Charge]
    printed_total_paise: int | None
    computed_total_paise: int
    checks: list[Check]
    needs_review: bool


# ---------- API: bills ----------

class Person(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=40)


class BillItem(Item):
    shared_by: list[str] = Field(min_length=1, max_length=20)


class BillIn(BaseModel):
    merchant: str | None = Field(default=None, max_length=120)
    date: str | None = Field(default=None, max_length=20)
    people: list[Person] = Field(min_length=2, max_length=20)
    items: list[BillItem] = Field(min_length=1, max_length=100)
    charges: list[Charge] = Field(default_factory=list, max_length=12)
    payer_id: str
    payer_upi: str = Field(max_length=320)
    note: str | None = Field(default=None, max_length=60)

    @field_validator("payer_upi")
    @classmethod
    def _upi(cls, v: str) -> str:
        v = v.strip()
        if not UPI_ID.match(v):
            raise ValueError("Enter a valid UPI ID, like name@okbank")
        return v

    @model_validator(mode="after")
    def _consistent(self) -> "BillIn":
        ids = [p.id for p in self.people]
        if len(set(ids)) != len(ids):
            raise ValueError("Each person needs a unique id")
        if len({p.name.strip().lower() for p in self.people}) != len(ids):
            raise ValueError("Two people have the same name")
        if self.payer_id not in ids:
            raise ValueError("The person who paid must be one of the people")
        for item in self.items:
            unknown = set(item.shared_by) - set(ids)
            if unknown:
                raise ValueError(f"Item '{item.name}' is assigned to an unknown person")
        if sum(i.total_paise for i in self.items) + sum(c.amount_paise for c in self.charges) <= 0:
            raise ValueError("The bill total must be more than zero")
        return self


class Share(BaseModel):
    person_id: str
    name: str
    items_paise: int
    charges_paise: int
    total_paise: int
    is_payer: bool
    paid: bool


class Bill(BaseModel):
    id: str
    created_at: str
    merchant: str | None
    date: str | None
    note: str | None
    payer_name: str
    payer_upi: str
    total_paise: int
    items: list[BillItem]
    charges: list[Charge]
    people: list[Person]
    shares: list[Share]


class BillCreated(BaseModel):
    bill: Bill
    edit_token: str  # shown once; lets the payer mark people as paid


class PaidUpdate(BaseModel):
    paid: bool


def as_dict(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(mode="json")
