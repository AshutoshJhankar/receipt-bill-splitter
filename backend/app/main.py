"""FastAPI app for the Receipt Bill Splitter."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .bills import BillNotFound, BillService, Forbidden
from .config import Settings
from .llm import LLMError, OpenAICompatibleLLM
from .receipt import ReceiptError, ReceiptParser
from .schemas import Bill, BillCreated, BillIn, PaidUpdate, ParsedReceipt
from .store import StoreError, build_store

settings = Settings.from_env()
bills = BillService(build_store(settings.supabase_url, settings.supabase_service_key, settings.retention_days))
parser = (
    ReceiptParser(OpenAICompatibleLLM(settings.llm_api_key, settings.llm_base_url, settings.llm_model,
                                      settings.llm_timeout_s), settings.max_image_mb)
    if settings.llm_api_key else None
)

app = FastAPI(title="Receipt Bill Splitter", version="1.0.0")
origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"], allow_methods=["GET", "POST", "PATCH"],
                   allow_headers=["*"])


class RateLimiter:
    def __init__(self, limit: int, window_s: int):
        self.limit, self.window_s = limit, window_s
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


scan_limiter = RateLimiter(settings.rate_limit_per_10min, 600)
write_limiter = RateLimiter(60, 600)


def _ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "llm_configured": parser is not None, "store": bills.store.name}


@app.post("/api/receipts/parse", response_model=ParsedReceipt)
async def parse_receipt(request: Request, file: UploadFile = File(...)) -> ParsedReceipt:
    if not scan_limiter.allow(_ip(request)):
        raise HTTPException(429, "Too many scans from your network. Please wait a few minutes.")
    if parser is None:
        raise HTTPException(503, "The AI model is not configured on the server.")
    data = await file.read(int(settings.max_image_mb * 1024 * 1024) + 1)
    try:
        return await run_in_threadpool(parser.parse, data)
    except ReceiptError as e:
        raise HTTPException(400, str(e)) from e
    except LLMError as e:
        raise HTTPException(502, "Couldn't read the bill right now. Try again, or add the items by hand.") from e


@app.post("/api/bills", response_model=BillCreated, status_code=201)
async def create_bill(bill: BillIn, request: Request) -> BillCreated:
    if not write_limiter.allow(_ip(request)):
        raise HTTPException(429, "Too many requests. Please wait a few minutes.")
    try:
        return await run_in_threadpool(bills.create, bill)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except StoreError as e:
        raise HTTPException(502, "Couldn't save the bill right now. Please try again.") from e


@app.get("/api/bills/{bill_id}", response_model=Bill)
async def get_bill(bill_id: str) -> Bill:
    try:
        return await run_in_threadpool(bills.get, bill_id)
    except BillNotFound as e:
        raise HTTPException(404, "This bill doesn't exist or has expired.") from e
    except StoreError as e:
        raise HTTPException(502, "Storage is unavailable right now.") from e


@app.patch("/api/bills/{bill_id}/people/{person_id}", response_model=Bill)
async def mark_paid(bill_id: str, person_id: str, body: PaidUpdate,
                    x_edit_token: str | None = Header(default=None)) -> Bill:
    try:
        return await run_in_threadpool(bills.set_paid, bill_id, person_id, body.paid, x_edit_token)
    except BillNotFound as e:
        raise HTTPException(404, "Bill or person not found.") from e
    except Forbidden as e:
        raise HTTPException(403, str(e)) from e
    except StoreError as e:
        raise HTTPException(502, "Storage is unavailable right now.") from e
