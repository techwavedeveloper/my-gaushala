# Payments backend (Razorpay)

This is a minimal Express backend to create Razorpay orders and verify payments.

## Setup

1. Copy `.env.example` to `.env` and set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (use test keys for development).

2. Install dependencies:

   npm install

3. Run in development:

   npm run dev

The server will run on the port specified in `.env` (default 3000).

## Endpoints

- `POST /api/create-order` — Create a Razorpay order. JSON body: `{ amount: <paise>, currency: 'INR', name, email, campaign }`.
- `POST /api/verify-payment` — Verify payment signature and store donor. JSON body includes `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`, `name`, `email`, `amount`, `campaign`.
- `GET /api/donors` — List stored donors.

Notes:
- This uses test keys by default if `.env` is not set. Do not use production keys in the repo.
- For production, secure the endpoints and store donor records in a proper database.

---

# Production-ready summary
This backend now includes:
- SQLite storage (server/data/db.sqlite)
- Razorpay order creation and verification
- Webhook endpoint (`POST /api/webhook`) with signature verification
- Admin endpoints protected by basic auth: `/admin/donors`, `/admin/export`
- Security: Helmet, rate limiting, input validation
- Logging: morgan + winston
- Dockerfile + docker-compose for quick deployment

## Quick start (dev)
1. cd server
2. cp .env.example .env
3. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and set `ADMIN_USER`/`ADMIN_PASS`.
4. Install dependencies:
   - On Linux you may need build tools for SQLite native bindings: `sudo apt-get update && sudo apt-get install -y build-essential python3 make`
   - Then run `npm install`
5. node index.js

If build tools aren't available, the server will fall back to a JSON-based storage (`server/data/donors.json`) automatically.
## Docker quick start
- docker build -t gaushala-payments:latest .
- docker run -e RAZORPAY_KEY_ID=... -e RAZORPAY_KEY_SECRET=... -p 3000:3000 gaushala-payments:latest

## Webhook
- Configure Razorpay webhook to POST to `/api/webhook` and use the same webhook secret set in `RAZORPAY_WEBHOOK_SECRET`.

