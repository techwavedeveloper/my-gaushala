# Vercel Deployment (Prepared)

This repository is prepared for Vercel deployment using a serverless adapter.

What I added:
- `api/index.js` — serverless wrapper
- `vercel.json` — Vercel build & routing
- `.env.example` updated with `DATABASE_URL`, `SENDGRID_API_KEY`, `RAZORPAY_*` and other env vars
- Admin UI at `/admin` (protected by basic auth)

Steps to deploy (Option B — you deploy):
1. Sign in to Vercel and create a new project, connect your GitHub repo.
2. In Vercel project settings, add the following environment variables:
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
   - `DATABASE_URL` (use Supabase / Railway / any Postgres)
   - `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`
   - `ADMIN_USER`, `ADMIN_PASS`
   - `ALLOWED_ORIGINS` (e.g., `https://your-site.vercel.app`)
   - Optional: `SENTRY_DSN`
3. Set the Build Command to: `npm ci --legacy-peer-deps && npm run build` (if you add build step) or leave default.
4. Deploy. Vercel will run `api/index.js` as Node serverless function.

Notes:
- Vercel serverless functions have ephemeral filesystem; do not rely on server/data for persistence in production.
- Use Supabase for persistent Postgres and configure `DATABASE_URL`.
- Configure Razorpay dashboard webhooks to POST to `https://<your-vercel-domain>/api/webhook` and set the webhook secret.
