# Receipt Bill Splitter

Snap a restaurant bill, tap who had what, and send everyone a link with a one-tap **UPI payment** for their exact
share, with GST and service charge split fairly.

**Live demo:** https://YOUR-APP.vercel.app · Use "Try a sample bill" (fictional receipt).

> **Problem:** after a group dinner someone pays, then has to type every item into a splitting app, work out
> who owes what including tax, and chase people for money.

## How it works

```mermaid
flowchart LR
    A[Photo] --> B[Compress in browser<br/>1600px JPEG]
    B --> C[Vision LLM<br/>reads items, taxes, total]
    C --> D[Code checks the bill's math<br/>qty×rate, subtotal, total]
    D --> E[User fixes + assigns<br/>items to people]
    E --> F[Exact split in paise<br/>largest-remainder rounding]
    F --> G[(Supabase)]
    G --> H[Share link<br/>UPI pay buttons]
```

1. **The AI reads, code calculates.** The vision model only transcribes what's printed. All arithmetic is in code.
2. **Catches misreads.** The backend checks quantity × rate for every line, items vs subtotal, and
   items + taxes + service − discount + round-off vs the printed total (₹1 tolerance). If something doesn't add
   up, the review screen says exactly what, before anyone is charged.
3. **Exact money.** Everything is integer **paise**, no floating point. Items shared by several people are split
   equally; taxes and service charge are shared in proportion to what each person ordered. Rounding uses the
   largest-remainder method, so the shares **always add up to the bill exactly**.
4. **Same algorithm on both sides.** The split runs live in the browser (`src/lib/split.js`) and is recomputed on
   the server (`app/split.py`) when saving. Both are tested against the same cases (`split_cases.json`).
5. **Payments.** Each friend gets a `upi://pay` link pre-filled with the payer's UPI ID and their amount, which
   opens GPay, PhonePe, Paytm or any UPI app. The payer gets a secret edit token (only its hash is stored),
   so only they can mark people as paid.
6. **Privacy.** Receipt photos are never stored; only the confirmed items and split (90 days).

## Tech

| Layer | Stack |
|---|---|
| Frontend | React 19 + Vite, mobile-first CSS, deployed on **Vercel** |
| Backend | Python, FastAPI, pydantic, deployed on **Render** |
| Database | **Supabase** Postgres via REST (row-level security on, server-only key) |
| AI | Any OpenAI-compatible API with a vision model |

## Run locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env    # add LLM_* values (vision model); Supabase optional locally
set -a && source .env && set +a
uvicorn app.main:app --reload --port 8000
pytest -q               # 19 tests, no API key needed

cd ../frontend
npm install
echo "VITE_API_URL=http://localhost:8000" > .env.local
npm run dev
npm test                # split / UPI tests (Node's built-in runner)
```

## Deploy

1. **Supabase:** SQL Editor → run `supabase/schema.sql` (works in the same project as other apps).
2. **Render:** New → Blueprint → this repo. Set `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` (must accept images),
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ALLOWED_ORIGINS`. Check `/api/health`.
3. **Vercel:** import the repo with **Root Directory `frontend`**, set `VITE_API_URL` to the Render URL, deploy.
4. Add the Vercel URL to `ALLOWED_ORIGINS` on Render.

## API

| Method | Path | |
|---|---|---|
| `POST` | `/api/receipts/parse` | multipart `file` (JPG/PNG/WebP ≤ 6 MB) → items, charges, math checks |
| `POST` | `/api/bills` | save a split → `{ bill, edit_token }` |
| `GET` | `/api/bills/{id}` | bill with everyone's share |
| `PATCH` | `/api/bills/{id}/people/{person_id}` | `{ "paid": true }` with header `X-Edit-Token` |

## Explaining it in an interview

- **One line:** "Take a photo of the bill, tap who ate what, and everyone gets a UPI link for their exact share."
- **The interesting part:** the LLM is only used to *read* the bill. The arithmetic is checked in code, so a
  misread ₹600 that became ₹500 is caught. Money is in integer paise with largest-remainder rounding, so
  ₹100 split three ways is ₹33.34 + ₹33.33 + ₹33.33, never ₹99.99.
- **Trade-offs:** anyone with the link can view the bill (that's the point of sharing), but only the payer can
  change it; UPI links can't confirm payment automatically, so the payer marks it.
- **Next steps:** QR code for in-person payment, remember groups, multiple payers, other currencies.

_All sample data is fictional._
