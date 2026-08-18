# The Shallot Biriyani — Sales Book

A daily sales ledger for **Food Truck** + **JP Nagar outlet**, plus an owner-facing
**Items Used / Amount / Report** section that combines both outlets.

Backend: Node.js + Express + **Supabase Postgres** (via the `pg` driver) — the
database is a separate hosted service (Supabase's free tier), and the app itself
deploys as a serverless function on **Vercel**. This replaces the earlier
SQLite-on-a-single-file setup, whose data couldn't survive a stateless deploy.

## What's inside

- `server.js` — Express app + REST API (now talks to Postgres via `lib/db.js`)
- `lib/db.js` — the Postgres connection pool (reads `DATABASE_URL`)
- `lib/dailyReport.js` / `lib/mailer.js` — report math + email, now async
- `api/index.js` — Vercel serverless entrypoint (just re-exports the Express app)
- `vercel.json` — routes every request to the function; schedules the daily report cron
- `supabase/schema.sql` — run once against your Supabase project to create the tables
- `migrate.js` — one-time script to copy your existing `data/hotel.db` into Supabase
- `public/` — the frontend (unchanged — plain HTML/CSS/JS, no build step, never touched the DB directly)

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project (free tier is fine).
2. Once it's up: **Project Settings → Database → Connection string**. Copy the
   **Transaction pooler** string (port `6543`) — that's the one to use for
   serverless. Fill in your DB password.
3. **SQL Editor** → paste the contents of `supabase/schema.sql` → Run. This creates
   the `entries` and `items_used` tables.

## 2. Migrate your existing data (one time)

```bash
npm install
cp .env.example .env
# edit .env: set DATABASE_URL to the connection string from step 1
npm run migrate
```

This reads your existing `data/hotel.db` and copies every row into Supabase. It's
safe to re-run — it upserts, so re-running just re-syncs rather than duplicating.

## 3. Run it locally against Supabase

```bash
npm start
```

Open **http://localhost:3000** — same app, same UI, now reading/writing Supabase
instead of the local SQLite file.

## 4. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. [vercel.com](https://vercel.com) → New Project → import the repo. Framework
   preset: **Other** (it's a plain Node/Express app, not Next.js).
3. In **Project Settings → Environment Variables**, add:
   - `DATABASE_URL` — same Supabase pooler string as above
   - `OWNER_PASSWORD` — if you want the owner-lock feature
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `REPORT_EMAIL_TO` / `REPORT_EMAIL_FROM` — for the report email
   - `CRON_SECRET` — any random string, only needed if you want the automatic 2am report (see below)
4. Deploy. Vercel gives you a public URL — share that with whoever enters data.

### The 2am daily report email on Vercel

The old `node-cron` scheduler only works on a process that stays running, which
Vercel serverless functions don't do. `vercel.json` instead defines a **Vercel
Cron Job** that hits `/api/cron/daily-report` once a day (20:30 UTC = 2:00 AM
IST). Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on that
request when you've set `CRON_SECRET` as an env var — the route checks it
matches before sending anything, so nobody else can trigger your report email
by guessing the URL.

Note: Vercel Cron on the Hobby (free) plan runs once a day per job with soft
timing guarantees (usually within a few minutes of the scheduled time) — fine
for this use case.

## Alternative: keep it on a plain server instead of Vercel

Everything above still works if you'd rather run this as a normal long-lived
Node process (Railway, Render, a VPS) instead of Vercel serverless — just point
`DATABASE_URL` at Supabase's **Session pooler** or direct connection instead of
the transaction pooler, and uncomment `startDailyReportScheduler()` in
`server.js` (it's currently commented out) instead of relying on Vercel Cron.

**The one thing that matters everywhere:** make sure the `data/` folder is on
persistent storage, not a throwaway/ephemeral disk — that folder holds `hotel.db`,
which is your entire sales history.

## Backing up your data

Your whole database is the single file `data/hotel.db`. To back it up, just copy
that file somewhere safe (it works fine to copy it while the server is running).
To restore, stop the server, replace the file, and start it again.

## Daily report by email (2 AM IST)

The app can email you the daily report automatically every night, so you don't
have to open the site to check it. It uses **node-cron** (scheduling) and
**nodemailer** (sending mail over SMTP) — both open source, no paid email
service required, though you do still need *some* SMTP account to send through
(Gmail's free SMTP works fine for this volume of mail).

### 1. Set up SMTP credentials

Add these to your `.env` (copy `.env.example` if you haven't already):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=youraddress@gmail.com
SMTP_PASS=your_16_character_app_password
REPORT_EMAIL_TO=owner@example.com
REPORT_EMAIL_FROM="The Shallot Biriyani Sales Book" <youraddress@gmail.com>
```

If you use Gmail: turn on 2-Step Verification on that Google account, then
create an **App Password** (Google Account → Security → 2-Step Verification →
App passwords) and use that as `SMTP_PASS` — your normal Gmail password won't
work here. Any other SMTP provider (Outlook, Zoho, Brevo, your own mail server)
works the same way — just swap in their host/port/user/pass.

`REPORT_EMAIL_TO` can be a comma-separated list if more than one person should
get it.

### 2. Restart the app

```bash
npm install   # pulls in node-cron + nodemailer if you haven't already
npm start
```

You'll see `[report-email] Scheduler armed — daily report will send at 2:00 AM IST`
in the console once it's running.

### 3. Test it without waiting for 2 AM

```bash
curl -X POST http://localhost:3000/api/send-report-email/2026-07-27
```
(use whichever date you want to test with, format `YYYY-MM-DD`). This sends
immediately and returns a JSON result telling you if it worked — handy for
checking your SMTP settings are correct before trusting the 2 AM job.

### How the timing works

The job runs every day at **2:00 AM India time** (hardcoded to the `Asia/Kolkata`
timezone regardless of what timezone your server itself is in) and emails the
report for the day that **just ended** — since your last sale slot is 12am–1am,
by 2am that day's entries are complete and ready to report on.

### New files this adds

- `lib/dailyReport.js` — pulls one day's rows from SQLite and re-computes the
  same formulas as the web app (Food Truck, JP Nagar, Amount, Report)
- `lib/mailer.js` — formats that data into an HTML email and sends it via nodemailer
- `lib/scheduler.js` — the node-cron job that fires at 2 AM IST
- One new route in `server.js`: `POST /api/send-report-email/:date` for manual testing

## Pages (one URL per section)

Every section is its own page and its own URL — navigate straight to it:

| URL | Page | Who can open it |
| --- | --- | --- |
| `http://localhost:5000/` | redirects to `/FoodTruck` | anyone |
| `http://localhost:5000/FoodTruck` | Food Truck daily entry | anyone (worker+ to change the date) |
| `http://localhost:5000/JPNagar` | JP Nagar daily entry | anyone (worker+ to change the date) |
| `http://localhost:5000/Items` | Items Used | anyone (worker+ to change the date) |
| `http://localhost:5000/Amount` | Amount | owner only |
| `http://localhost:5000/Report` | Report + date-range report | owner only |
| `http://localhost:5000/Payment` | Salary / payments | owner only |
| `http://localhost:5000/Login` | Sign in | anyone |

URLs are matched case-insensitively and redirected to the canonical spelling,
so `/report` bounces to `/Report`. A few aliases exist too: `/truck`, `/jp`,
`/items-used`, `/owner`.

The left **sidebar** groups these into **Outlets** (Food Truck, JP Nagar, Items
Used) and **Owner Access** (Amount, Report, Payment). The Owner Access group is
hidden completely unless you are signed in as the owner.

## Passwords & access (worker vs owner)

Two passwords in `.env`:

```
WORKER_PASSWORD=choose-a-worker-password
OWNER_PASSWORD=choose-an-owner-password
```

- **Worker password** — opens Food Truck / JP Nagar / Items Used and lets the
  worker **change the date** they are writing to (past days, month arrows).
  Amount, Report and Payment stay hidden.
- **Owner password** — everything a worker can do, plus **Amount**, **Report**
  (including *Generate report for a date range*) and **Payment**.
- If **neither** password is set the app is wide open, so a fresh install never
  locks you out before you have configured it.
- With passwords set but nobody signed in, entry pages still work for **today's**
  date only.

Sign in at `/Login`, or with the button at the top right of any page. The
password is kept for that browser tab (sessionStorage) until you sign out or
close the tab. It is checked in the browser *and* on the server (sent as the
`X-App-Password` header), so the API can't be bypassed by calling it directly.
It is a shared password, not per-person logins — meant to stop casual edits and
keep the money views for the owner, not bank-grade security. Use HTTPS if this
runs on the open internet.


## How the numbers are calculated

**Food Truck / JP Nagar (per outlet, per day):**
- Chicken Plate Diff = Chicken Plates − Chicken Biryani − Chicken Wastage (same pattern for Paneer)
- Total Sale: on day 1 of the month it's the 7pm–12am slot + the 12am–1am slot.
  On every other day, **yesterday's** 12am–1am slot is subtracted first, so that hour
  is never double-counted across two day entries — this mirrors the original
  spreadsheet's logic exactly.
- Difference = Total Sale − Online − Cash
- Rice Diff = (Chicken Plates + Paneer Plates) − (Chicken + Paneer Biryani) − Rice − Wastage
- Rice Sale = Chicken Biryani + Paneer Biryani + Rice

**Items Used (combined kitchen usage, one entry per day for both outlets together):**
- Chicken Ready Ratio = Chicken Plates Made ÷ Chicken Used (kg)
- Rice Ready Ratio = (Chicken + Veg Plates Made) ÷ Rice Used (kg)

**Report (owner view, combines Food Truck + JP Nagar + Items Used):**
- Total Sale / Total Diff / Chicken Plate Diff / Rice Plate Diff — Truck + JP Nagar added together, day by day
- Chicken Sale Ratio = (Chicken Biryani sold, both outlets) ÷ Chicken Used
- Chicken Sale+Wastage Ratio = (Chicken sold + wasted, both outlets) ÷ Chicken Used
- Rice Sale Ratio = (Rice Sale, both outlets) ÷ Rice Used
- Rice Sale+Wastage Ratio = (Rice Sale + Chicken/Paneer wastage, both outlets) ÷ Rice Used

**A note on two things I changed from your original spreadsheet:**
1. Your original *Report* sheet lines up JP Nagar rows against the wrong day from
   row 3 onward (it references `'Jp Nagar'!P4` next to `Truck!P3`, off by one, and
   that offset carries through the rest of the sheet) — almost certainly caused by
   a stray blank row once inserted into the JP Nagar sheet. This app matches JP
   Nagar and Truck by the **actual calendar date** instead, so every row compares
   the correct day for both outlets.
2. Your original sheet never actually filled in a formula for **Rice (Sale +
   Wastage) ratio** (column O) — it was left blank throughout. I built it the same
   way the sheet builds **Chicken (Sale + Wastage) ratio**: `Chicken (Sale +
   Wastage) ratio = ((JP Chicken Biryani + JP Chicken Wastage) + (Truck Chicken
   Biryani + Truck Chicken Wastage)) ÷ Chicken Used`. For rice, the equivalent
   "sale" figure is RICE SALE (Chicken + Paneer Biryani + Rice), and since rice
   doesn't have its own wastage column but sits inside both biryanis, its wastage
   counterpart is Chicken + Paneer Wastage from both outlets: `Rice (Sale +
   Wastage) ratio = ((JP RICE SALE + JP Chicken Wastage + JP Paneer Wastage) +
   (Truck RICE SALE + Truck Chicken Wastage + Truck Paneer Wastage)) ÷ Rice Used`.
   If you had a different formula in mind, tell me and I'll change it.

## Deep-link pages for each tab

`/payment/` works today because it's a real folder (`public/payment/`) with
its own `index.html` — `express.static` serves it automatically and even
redirects `/payment` → `/payment/` on its own, with zero custom route code.

The same works for any other tab (Food Truck, JP Nagar, Items Used, Amount,
Report) the moment a matching folder exists — e.g. add
`public/truck/index.html` and `/truck` / `/truck/` just work, identically to
Payment, automatically. No server changes needed for that part.

## Report — date range summary

The Report tab has a "Generate report for a date range" panel: pick a
From/To date and it fetches `GET /api/report/range/:start/:end` (owner-only,
max 92 days) and shows, summed/averaged across every day in that range that
has data:
- **Sums:** JP Nagar Sale, Truck Sale, Total Sale, JP Nagar Difference, Truck
  Difference, Total Difference, Chicken Plate Diff, Rice Plate Diff
- **Averages:** Chicken Ready/Sale/Sale+Waste Ratio, Rice Ready/Sale/Sale+Waste Ratio

Same formulas as the single-day Report view (`lib/dailyReport.js`) — just
summed/averaged across the chosen dates instead of shown for one day.

## Extending it later

The database has these tables — `entries` (outlet, date, and all manual counts),
`items_used` (date, and combined kitchen usage), `employees`, and `payments`
(salary ledger). All live in the same Supabase Postgres database (see
`supabase/schema.sql`), so you (or any developer) can query them for custom
reports beyond what's in the Report tab.
