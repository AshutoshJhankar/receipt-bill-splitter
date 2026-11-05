"""Bill storage: Supabase via PostgREST (HTTPS, stdlib only), or in-memory for local dev.

Receipt photos are never stored, only the confirmed items and the split.
"""
from __future__ import annotations

import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Protocol

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class StoreError(RuntimeError):
    pass


class BillStore(Protocol):
    name: str

    def insert(self, row: dict) -> dict: ...
    def get(self, bill_id: str) -> dict | None: ...
    def update(self, bill_id: str, fields: dict) -> dict: ...


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MemoryStore:
    name = "memory"

    def __init__(self, retention_days: int = 90):
        self._rows: dict[str, dict] = {}
        self._lock = threading.Lock()
        self.retention_days = retention_days

    def insert(self, row: dict) -> dict:
        full = {**row, "id": str(uuid.uuid4()), "created_at": _now().isoformat(),
                "expires_at": (_now() + timedelta(days=self.retention_days)).isoformat()}
        with self._lock:
            self._rows[full["id"]] = json.loads(json.dumps(full))
        return full

    def get(self, bill_id: str) -> dict | None:
        with self._lock:
            row = self._rows.get(bill_id)
        if row is None or datetime.fromisoformat(row["expires_at"]) < _now():
            return None
        return json.loads(json.dumps(row))

    def update(self, bill_id: str, fields: dict) -> dict:
        with self._lock:
            if bill_id not in self._rows:
                raise StoreError("Bill not found")
            self._rows[bill_id].update(json.loads(json.dumps(fields)))
            return json.loads(json.dumps(self._rows[bill_id]))


class SupabaseStore:
    name = "supabase"
    TABLE = "bills"

    def __init__(self, url: str, service_key: str, retention_days: int = 90,
                 opener: Callable = urllib.request.urlopen, timeout_s: float = 10.0):
        self.base = f"{url.rstrip('/')}/rest/v1/{self.TABLE}"
        self.retention_days = retention_days
        self._open, self._timeout = opener, timeout_s
        self._headers = {"apikey": service_key, "Content-Type": "application/json"}
        if service_key.startswith("eyJ"):  # legacy JWT keys also go in Authorization
            self._headers["Authorization"] = f"Bearer {service_key}"

    def _request(self, method: str, url: str, body: dict | None = None, prefer: str | None = None) -> list:
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers, method=method)
        try:
            with self._open(req, timeout=self._timeout) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else []
        except urllib.error.HTTPError as e:
            raise StoreError(f"Supabase {method} failed: HTTP {e.code} {e.read()[:200]!r}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            raise StoreError(f"Supabase unreachable: {e}") from e

    def insert(self, row: dict) -> dict:
        body = {**row, "expires_at": (_now() + timedelta(days=self.retention_days)).isoformat()}
        rows = self._request("POST", self.base, body, prefer="return=representation")
        if not rows:
            raise StoreError("Supabase returned no row")
        return rows[0]

    def get(self, bill_id: str) -> dict | None:
        if not _UUID.match(bill_id):
            return None
        q = urllib.parse.urlencode({"id": f"eq.{bill_id}", "expires_at": f"gt.{_now().isoformat()}", "select": "*"})
        rows = self._request("GET", f"{self.base}?{q}")
        return rows[0] if rows else None

    def update(self, bill_id: str, fields: dict) -> dict:
        if not _UUID.match(bill_id):
            raise StoreError("Bad id")
        q = urllib.parse.urlencode({"id": f"eq.{bill_id}"})
        rows = self._request("PATCH", f"{self.base}?{q}", fields, prefer="return=representation")
        if not rows:
            raise StoreError("Bill not found")
        return rows[0]


def build_store(url: str, key: str, retention_days: int) -> BillStore:
    if url and key:
        return SupabaseStore(url, key, retention_days)
    return MemoryStore(retention_days)
