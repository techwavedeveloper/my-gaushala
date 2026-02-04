# Payments Setup (Razorpay)

This project includes a minimal Express payments backend at `/server`.

Quick start:

1. cd server
2. cp .env.example .env
3. Edit `.env` and set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (use test keys for development)
4. npm install
5. npm run dev

Local endpoints:
- POST /api/create-order — Create an order. Request body: { amount: <paise>, currency: 'INR', name, email, campaign }
- POST /api/verify-payment — Verify payment signature and store donor. Body includes razorpay ids + donor info.
- GET /api/donors — List donors

Notes:
- Server stores donors in `server/data/db.sqlite` (SQLite) when native bindings are available; otherwise it uses `server/data/donors.json` as a fallback.
- Razorpay is used in test mode by default when you set test keys.
- For production, secure these endpoints and use a proper database (Postgres recommended); do not store secrets in source control.
- To enable native SQLite on Linux, install build tools: `sudo apt-get update && sudo apt-get install -y build-essential python3 make`.
