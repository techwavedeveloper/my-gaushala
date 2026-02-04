-- 001_init.sql
-- Create donors table for Postgres
CREATE TABLE IF NOT EXISTS donors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  amount TEXT NOT NULL,
  campaign TEXT,
  razorpay_payment_id TEXT,
  razorpay_order_id TEXT,
  date TEXT NOT NULL
);
