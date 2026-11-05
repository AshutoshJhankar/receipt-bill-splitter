"""Exact bill splitting in integer paise.

All money is integer paise, so there are no floating-point errors, and every share is
rounded with the largest-remainder method, so the shares always add up to the bill exactly.
The frontend has the same algorithm in src/lib/split.js; tests/split_cases.json keeps them in sync.
"""
from __future__ import annotations


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


def compute_shares(people: list[str], items: list[dict], charges_paise: int) -> dict[str, dict]:
    """
    people: person ids in display order.
    items: [{"total_paise": int, "shared_by": [person ids]}]; each item is split equally among its sharers.
    charges_paise: taxes + service charge + round-off - discount (may be negative).
    Charges are shared in proportion to what each person ordered.
    Returns {person_id: {"items_paise", "charges_paise", "total_paise"}}.
    """
    index = {p: i for i, p in enumerate(people)}
    item_sub = [0] * len(people)
    for item in items:
        sharers = sorted({p for p in item["shared_by"] if p in index}, key=index.__getitem__)
        if not sharers:
            raise ValueError("Every item must be assigned to at least one person")
        parts = _distribute(item["total_paise"], [1] * len(sharers))
        for p, part in zip(sharers, parts):
            item_sub[index[p]] += part

    sign = -1 if charges_paise < 0 else 1
    charge_parts = [sign * c for c in _distribute(abs(charges_paise), item_sub)]
    return {
        p: {"items_paise": item_sub[i], "charges_paise": charge_parts[i], "total_paise": item_sub[i] + charge_parts[i]}
        for i, p in enumerate(people)
    }
