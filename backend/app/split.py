"""Exact bill splitting in integer paise.

All money is integer paise, so there are no floating-point errors, and every share is
rounded with the largest-remainder method, so the shares always add up to the bill exactly.

Each tax or charge is spread only over the items it applies to: GST over food, liquor VAT over
alcohol, service charge and discounts over everything. A person's part of a charge is in proportion
to what they had of those items, so someone who only had food pays no liquor VAT.

The frontend has the same algorithm in src/lib/split.js; tests/split_cases.json keeps them in sync.
"""
from __future__ import annotations

from typing import Iterable


def rupees_to_paise(v: float | int | None) -> int:
    return 0 if v is None else int(round(float(v) * 100))


def _distribute(amount: int, weights: list[int]) -> list[int]:
    """Split a non-negative integer amount in proportion to weights; result sums exactly to amount."""
    n = len(weights)
    if n == 0:
        return []
    total = sum(weights)
    if total <= 0:
        weights, total = [1] * n, n  # nothing to weight by: split equally
    base = [amount * w // total for w in weights]
    remainders = [amount * w % total for w in weights]
    leftover = amount - sum(base)
    # Give the leftover paise to the largest remainders; ties go to the earlier person (stable).
    order = sorted(range(n), key=lambda i: (-remainders[i], i))
    for i in order[:leftover]:
        base[i] += 1
    return base


def _signed(amount: int, weights: list[int]) -> list[int]:
    sign = -1 if amount < 0 else 1
    return [sign * part for part in _distribute(abs(amount), weights)]


def compute_shares(people: list[str], items: list[dict], charges: int | Iterable[dict]) -> dict[str, dict]:
    """
    people: person ids in display order.
    items: [{"total_paise": int, "shared_by": [person ids], "category": str}]; each item is split
        equally among the people sharing it. Only category "alcohol" matters here.
    charges: [{"amount_paise": int, "applies_to": "food" | "alcohol" | "all"}] (discounts are negative),
        or a single int for one charge on everything.
    Returns {person_id: {"items_paise", "alcohol_paise", "charges_paise", "total_paise", "equal_paise"}},
    where equal_paise is what each person would pay if the whole bill were split equally.
    """
    n = len(people)
    index = {p: i for i, p in enumerate(people)}
    food, alcohol = [0] * n, [0] * n
    for item in items:
        sharers = sorted({p for p in item["shared_by"] if p in index}, key=index.__getitem__)
        if not sharers:
            raise ValueError("Every item must be assigned to at least one person")
        portion = alcohol if item.get("category") == "alcohol" else food
        for p, part in zip(sharers, _distribute(item["total_paise"], [1] * len(sharers))):
            portion[index[p]] += part
    weights = {"food": food, "alcohol": alcohol, "all": [f + a for f, a in zip(food, alcohol)]}

    if isinstance(charges, int):
        charges = [{"amount_paise": charges, "applies_to": "all"}]
    group_totals = {"food": 0, "alcohol": 0, "all": 0}
    for c in charges:
        target = c.get("applies_to") or "all"
        if target not in group_totals or sum(weights[target]) == 0:
            target = "all"  # e.g. VAT on liquor, but no item is marked as alcohol
        group_totals[target] += c["amount_paise"]

    charge_parts = [0] * n
    for target, amount in group_totals.items():
        for i, part in enumerate(_signed(amount, weights[target])):
            charge_parts[i] += part

    bill_total = sum(weights["all"]) + sum(group_totals.values())
    equal = _signed(bill_total, [1] * n)
    return {
        p: {
            "items_paise": weights["all"][i],
            "alcohol_paise": alcohol[i],
            "charges_paise": charge_parts[i],
            "total_paise": weights["all"][i] + charge_parts[i],
            "equal_paise": equal[i],
        }
        for i, p in enumerate(people)
    }
