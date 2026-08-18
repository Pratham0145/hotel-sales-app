-- supabase/schema.sql
-- Run this once in the Supabase SQL Editor (or via `psql "$DATABASE_URL" -f supabase/schema.sql`)
-- before running migrate.js. Mirrors the old SQLite schema field-for-field so
-- app.js and the report formulas need zero changes.
--
-- Note: `date` is kept as TEXT ('YYYY-MM-DD'), not a native DATE column. The
-- app queries months with `date LIKE '2026-07-%'`, which is a cheap, exact
-- match on TEXT but would need a cast/rewrite on a DATE column. Keeping it
-- TEXT avoids that whole class of change — a deliberate "don't touch what
-- doesn't need touching" call.

CREATE TABLE IF NOT EXISTS entries (
  id BIGSERIAL PRIMARY KEY,
  outlet TEXT NOT NULL CHECK (outlet IN ('truck','jp')),
  date TEXT NOT NULL,            -- 'YYYY-MM-DD'
  cb NUMERIC DEFAULT 0,          -- Chicken Biryani
  pb NUMERIC DEFAULT 0,          -- Paneer Biryani
  rice NUMERIC DEFAULT 0,
  kabab NUMERIC DEFAULT 0,
  parcel NUMERIC DEFAULT 0,
  water NUMERIC DEFAULT 0,
  cp NUMERIC DEFAULT 0,          -- Chicken Plates
  pp NUMERIC DEFAULT 0,          -- Paneer Plates
  cw NUMERIC DEFAULT 0,          -- Chicken wastage
  pw NUMERIC DEFAULT 0,          -- Paneer wastage
  s1 NUMERIC DEFAULT 0,          -- 7pm-12am sale
  s2 NUMERIC DEFAULT 0,          -- 12am-1am sale
  online NUMERIC DEFAULT 0,
  cash NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (outlet, date)
);

CREATE TABLE IF NOT EXISTS items_used (
  id BIGSERIAL PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,     -- 'YYYY-MM-DD'
  chicken_plates NUMERIC DEFAULT 0,
  veg_plates NUMERIC DEFAULT 0,
  chicken NUMERIC DEFAULT 0,     -- kg of chicken used
  rice NUMERIC DEFAULT 0,        -- kg of rice used
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entries_outlet_date ON entries (outlet, date);

-- Payment / Salary Ledger (public/payment) — not in the original SQLite
-- schema this file mirrors; added here so a fresh Supabase project has
-- everything server.js's /api/employees and /api/payments routes need.
CREATE TABLE IF NOT EXISTS employees (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  salary NUMERIC NOT NULL DEFAULT 0,   -- fixed monthly salary
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  emp_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  date TEXT NOT NULL,             -- 'YYYY-MM-DD'
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_emp_id ON payments (emp_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments (date);

-- Supabase enables Row Level Security by default on tables created through
-- its dashboard, but tables created via raw SQL (like this) do NOT have RLS
-- on unless you turn it on. Since this app connects with the full
-- postgres role (via DATABASE_URL / pg), not the anon/public API key, RLS
-- policies are irrelevant here — the server already has full access and
-- the tables are never exposed through Supabase's PostgREST/anon API.
-- Leave RLS off for these two tables; do NOT expose DATABASE_URL to the browser.
