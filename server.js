// The Shallot Biriyani — Sales Book backend
// Express + Postgres (Supabase), via the `pg` driver (lib/db.js).
//
// Migrated from better-sqlite3/SQLite. Every db.prepare(...).get/all/run()
// call became an `await query(...)` call with $1/$2 positional params
// instead of SQLite's ?/@named params. Route logic and response shapes are
// unchanged — the frontend (public/app.js) needed no changes at all.
require('dotenv').config();
const express = require('express');
const path = require('path');
const { query } = require('./lib/db');
const { sendDailyReportEmail } = require('./lib/mailer');
const { istDateString } = require('./lib/dailyReport');
// Only relevant if you're running this as a long-lived process (VPS/Railway/
// Render) instead of Vercel serverless — Vercel uses the "crons" entry in
// vercel.json + the /api/cron/daily-report route below instead.
// const { startDailyReportScheduler } = require('./lib/scheduler');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Page routes — every section is its own URL (redirect-style navigation):
//   /FoodTruck  /JPNagar  /Items  /Amount  /Report  /Payment  /Login
// Paths are matched case-insensitively and redirected to the canonical casing,
// so http://localhost:5000/report lands on http://localhost:5000/Report.
// ---------------------------------------------------------------------------
const PAGES = {
  '/Login': 'login.html',
  '/FoodTruck': 'foodtruck.html',
  '/JPNagar': 'jpnagar.html',
  '/Items': 'items.html',
  '/Amount': 'amount.html',
  '/Report': 'report.html',
  '/Payment': 'payment.html',
};
const PAGE_ALIASES = {};
for (const p of Object.keys(PAGES)) PAGE_ALIASES[p.toLowerCase()] = p;
// A few friendlier spellings people type by hand.
PAGE_ALIASES['/truck'] = '/FoodTruck';
PAGE_ALIASES['/food-truck'] = '/FoodTruck';
PAGE_ALIASES['/jp'] = '/JPNagar';
PAGE_ALIASES['/jp-nagar'] = '/JPNagar';
PAGE_ALIASES['/items-used'] = '/Items';
PAGE_ALIASES['/owner'] = '/Report';

app.get('/', (req, res) => res.redirect('/FoodTruck'));

app.get(/.*/, (req, res, next) => {
  const clean = req.path.replace(/\/+$/, '').toLowerCase();
  const canonical = PAGE_ALIASES[clean];
  if (!canonical) return next();
  if (req.path !== canonical) return res.redirect(302, canonical);
  res.sendFile(path.join(__dirname, 'public', 'pages', PAGES[canonical]));
});


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ENTRY_FIELDS = ['cb','pb','rice','kabab','parcel','water','cp','pp','cw','pw','s1','s2','online','cash'];
const ITEMS_FIELDS = ['chicken_plates','veg_plates','chicken','rice'];

function pad2(n){ return String(n).padStart(2, '0'); }
function monthPrefix(year, month){ return `${year}-${pad2(month)}-`; }
function dayFromDate(dateStr){ return parseInt(dateStr.split('-')[2], 10); }

// ---------------------------------------------------------------------------
// Two-tier auth — WORKER_PASSWORD and OWNER_PASSWORD (set both in .env).
//
//   worker  -> can open Food Truck / JP Nagar / Items Used and change the DATE
//              (edit past dates). Cannot see Amount / Report / Payment.
//   owner   -> everything a worker can do, plus Amount, Report (incl. the
//              date-range report) and Payment.
//
// The browser sends the password in the `X-App-Password` header
// (`X-Owner-Password` is still accepted for backwards compatibility).
// If neither password is configured the app stays wide open, so a fresh
// install never locks you out before you've set them.
// ---------------------------------------------------------------------------
function ownerPassword(){ return process.env.OWNER_PASSWORD || ''; }
function workerPassword(){ return process.env.WORKER_PASSWORD || ''; }
function authConfigured(){ return !!(ownerPassword() || workerPassword()); }

// 'owner' | 'worker' | 'guest'
function roleOf(req){
  if (!authConfigured()) return 'owner';
  const pw = req.get('X-App-Password') || req.get('X-Owner-Password') || '';
  if (!pw) return 'guest';
  if (ownerPassword() && pw === ownerPassword()) return 'owner';
  if (workerPassword() && pw === workerPassword()) return 'worker';
  return 'guest';
}
function isOwnerRequest(req){ return roleOf(req) === 'owner'; }
// Workers and owners may both change the date they are writing to.
function canEditAnyDate(req){ const r = roleOf(req); return r === 'owner' || r === 'worker'; }
function todayDateStr(){ return istDateString(0); } // business is IST-based; see lib/dailyReport.js
function isValidDate(y, m, d){
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

// Small wrapper so every route's Postgres error becomes a clean 500 instead
// of an unhandled rejection (Express 4 doesn't auto-catch async handler errors).
function asyncRoute(handler) {
  return (req, res) => handler(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  });
}

// ---------------------------------------------------------------------------
// Entries API (Food Truck / JP Nagar — raw daily counts)
// ---------------------------------------------------------------------------

// GET /api/entries/:outlet/:year/:month -> { "1": {...}, "2": {...} }
app.get('/api/entries/:outlet/:year/:month', asyncRoute(async (req, res) => {
  const { outlet, year, month } = req.params;
  if (!['truck', 'jp'].includes(outlet)) return res.status(400).json({ error: 'invalid outlet' });
  const y = parseInt(year, 10), m = parseInt(month, 10);
  if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'invalid year/month' });

  const { rows } = await query(
    `SELECT * FROM entries WHERE outlet = $1 AND date LIKE $2 ORDER BY date`,
    [outlet, monthPrefix(y, m) + '%']
  );

  const result = {};
  for (const row of rows) {
    result[dayFromDate(row.date)] = {
      cb: row.cb, pb: row.pb, rice: row.rice, kabab: row.kabab, parcel: row.parcel, water: row.water,
      cp: row.cp, pp: row.pp, cw: row.cw, pw: row.pw, s1: row.s1, s2: row.s2, online: row.online, cash: row.cash,
      updated_at: row.updated_at,
    };
  }
  res.json(result);
}));

// PUT /api/entries/:outlet/:year/:month/:day  body: { cb, pb, ... } (any subset)
app.put('/api/entries/:outlet/:year/:month/:day', asyncRoute(async (req, res) => {
  const { outlet, year, month, day } = req.params;
  if (!['truck', 'jp'].includes(outlet)) return res.status(400).json({ error: 'invalid outlet' });
  const y = parseInt(year, 10), m = parseInt(month, 10), d = parseInt(day, 10);
  if (!isValidDate(y, m, d)) return res.status(400).json({ error: 'invalid date' });
  const date = `${y}-${pad2(m)}-${pad2(d)}`;
  if (date !== todayDateStr() && !canEditAnyDate(req)) {
    return res.status(403).json({ error: 'Sign in with the worker or owner password to edit other dates.' });
  }

  const { rows: existingRows } = await query(`SELECT * FROM entries WHERE outlet = $1 AND date = $2`, [outlet, date]);
  const existing = existingRows[0];
  const merged = {};
  for (const f of ENTRY_FIELDS) {
    merged[f] = req.body[f] !== undefined ? toNum(req.body[f]) : (existing ? existing[f] : 0);
  }

  await query(`
    INSERT INTO entries (outlet, date, cb, pb, rice, kabab, parcel, water, cp, pp, cw, pw, s1, s2, online, cash, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
    ON CONFLICT (outlet, date) DO UPDATE SET
      cb=excluded.cb, pb=excluded.pb, rice=excluded.rice, kabab=excluded.kabab, parcel=excluded.parcel,
      water=excluded.water, cp=excluded.cp, pp=excluded.pp, cw=excluded.cw, pw=excluded.pw,
      s1=excluded.s1, s2=excluded.s2, online=excluded.online, cash=excluded.cash, updated_at=now()
  `, [
    outlet, date, merged.cb, merged.pb, merged.rice, merged.kabab, merged.parcel, merged.water,
    merged.cp, merged.pp, merged.cw, merged.pw, merged.s1, merged.s2, merged.online, merged.cash,
  ]);

  res.json({ ok: true, date, ...merged });
}));

// ---------------------------------------------------------------------------
// Items Used API (combined kitchen usage — one entry per day, not per outlet)
// ---------------------------------------------------------------------------

app.get('/api/items-used/:year/:month', asyncRoute(async (req, res) => {
  const { year, month } = req.params;
  const y = parseInt(year, 10), m = parseInt(month, 10);
  if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'invalid year/month' });

  const { rows } = await query(`SELECT * FROM items_used WHERE date LIKE $1 ORDER BY date`, [monthPrefix(y, m) + '%']);
  const result = {};
  for (const row of rows) {
    result[dayFromDate(row.date)] = {
      chicken_plates: row.chicken_plates, veg_plates: row.veg_plates, chicken: row.chicken, rice: row.rice,
      updated_at: row.updated_at,
    };
  }
  res.json(result);
}));

app.put('/api/items-used/:year/:month/:day', asyncRoute(async (req, res) => {
  const { year, month, day } = req.params;
  const y = parseInt(year, 10), m = parseInt(month, 10), d = parseInt(day, 10);
  if (!isValidDate(y, m, d)) return res.status(400).json({ error: 'invalid date' });
  const date = `${y}-${pad2(m)}-${pad2(d)}`;
  if (date !== todayDateStr() && !canEditAnyDate(req)) {
    return res.status(403).json({ error: 'Sign in with the worker or owner password to edit other dates.' });
  }

  const { rows: existingRows } = await query(`SELECT * FROM items_used WHERE date = $1`, [date]);
  const existing = existingRows[0];
  const merged = {};
  for (const f of ITEMS_FIELDS) {
    merged[f] = req.body[f] !== undefined ? toNum(req.body[f]) : (existing ? existing[f] : 0);
  }

  await query(`
    INSERT INTO items_used (date, chicken_plates, veg_plates, chicken, rice, updated_at)
    VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (date) DO UPDATE SET
      chicken_plates=excluded.chicken_plates, veg_plates=excluded.veg_plates,
      chicken=excluded.chicken, rice=excluded.rice, updated_at=now()
  `, [date, merged.chicken_plates, merged.veg_plates, merged.chicken, merged.rice]);

  res.json({ ok: true, date, ...merged });
}));

// ---------------------------------------------------------------------------
// Owner view — one call that returns everything needed for Items Used / Amount / Report tabs
// ---------------------------------------------------------------------------
app.get('/api/owner-view/:year/:month', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  const { year, month } = req.params;
  const y = parseInt(year, 10), m = parseInt(month, 10);
  if (!y || !m || m < 1 || m > 12) return res.status(400).json({ error: 'invalid year/month' });

  const prefix = monthPrefix(y, m) + '%';
  const [{ rows: truckRows }, { rows: jpRows }, { rows: itemsRows }] = await Promise.all([
    query(`SELECT * FROM entries WHERE outlet='truck' AND date LIKE $1 ORDER BY date`, [prefix]),
    query(`SELECT * FROM entries WHERE outlet='jp' AND date LIKE $1 ORDER BY date`, [prefix]),
    query(`SELECT * FROM items_used WHERE date LIKE $1 ORDER BY date`, [prefix]),
  ]);

  const toMap = (rows) => {
    const map = {};
    for (const row of rows) map[dayFromDate(row.date)] = row;
    return map;
  };

  res.json({ truck: toMap(truckRows), jp: toMap(jpRows), itemsUsed: toMap(itemsRows) });
}));

// ---------------------------------------------------------------------------
// Report API — per-day and range aggregates, reusing the exact same formulas
// as the daily email (lib/dailyReport.js), so "amount" and "report" numbers
// are identical everywhere: the UI, the email, and the AI agent's tools all
// call this same function. Owner-only (same gate as owner-view above).
// ---------------------------------------------------------------------------
const { buildDailyReport } = require('./lib/dailyReport');

// GET /api/report/2026-08-05  -> one day's Amount + Report numbers
app.get('/api/report/:date', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const data = await buildDailyReport(date);
  res.json(data);
}));

// GET /api/report/range/2026-08-01/2026-08-05 -> per-day list + totals across the range
app.get('/api/report/range/:start/:end', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  const { start, end } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return res.status(400).json({ error: 'start/end must be YYYY-MM-DD' });
  }
  const startDt = new Date(start + 'T00:00:00');
  const endDt = new Date(end + 'T00:00:00');
  if (!(startDt <= endDt)) return res.status(400).json({ error: 'start must be on or before end' });
  const dayMs = 24 * 60 * 60 * 1000;
  const spanDays = Math.round((endDt - startDt) / dayMs) + 1;
  if (spanDays > 92) return res.status(400).json({ error: 'range too large (max 92 days)' });

  const dates = [];
  for (let i = 0; i < spanDays; i++) {
    const d = new Date(startDt.getTime() + i * dayMs);
    dates.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  }
  const days = await Promise.all(dates.map((d) => buildDailyReport(d)));

  // Sums and averages, computed only over days that actually have data —
  // same "skip empty days" rule the client's own month-summary code uses
  // (public/app.js renderMonthSummary), so these numbers line up with what
  // you'd get manually adding up the single-day Report view for each date.
  const daysWithData = days.filter((d) => d.hasAnyData);
  const sum = (key) => daysWithData.reduce((s, d) => s + (Number(d.report[key]) || 0), 0);
  const avg = (key) => {
    const vals = daysWithData.map((d) => d.report[key]).filter((v) => v !== null && v !== undefined && isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const totals = {
    // Sums
    jpSale: sum('jpSale'), truckSale: sum('truckSale'), totalSale: sum('totalSale'),
    jpDiff: sum('jpDiff'), truckDiff: sum('truckDiff'), totalDiff: sum('totalDiff'),
    chickenPlateDiffAll: sum('chickenPlateDiffAll'), ricePlateDiffAll: sum('ricePlateDiffAll'),
    // Averages (ignore days where the ratio is null, e.g. zero usage that day)
    chickenReadyRatio: avg('chickenReadyRatio'), chickenSaleRatio: avg('chickenSaleRatio'),
    chickenSaleWasteRatio: avg('chickenSaleWasteRatio'), riceReadyRatio: avg('riceReadyRatio'),
    riceSaleRatio: avg('riceSaleRatio'), riceSaleWasteRatio: avg('riceSaleWasteRatio'),
    // Context
    daysWithData: daysWithData.length, daysInRange: days.length,
  };

  res.json({ start, end, days, totals });
}));

// ---------------------------------------------------------------------------
// Payment / Salary API (employees + ad-hoc payments) — owner-only, same gate
// as owner-view above.
// ---------------------------------------------------------------------------
app.get('/api/employees', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  const { rows } = await query('SELECT * FROM employees ORDER BY name');
  res.json(rows);
}));

app.post('/api/employees', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  const { name, salary } = req.body;
  if (!name || !toNum(salary)) return res.status(400).json({ error: 'name and salary required' });
  const { rows } = await query(
    `INSERT INTO employees (name, salary) VALUES ($1, $2) RETURNING *`,
    [name, toNum(salary)]
  );
  res.json(rows[0]);
}));

app.delete('/api/employees/:id', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  await query('DELETE FROM employees WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/payments', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  const { rows } = await query('SELECT * FROM payments ORDER BY date DESC, id DESC');
  res.json(rows);
}));

app.post('/api/payments', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  const { emp_id, amount, date, note } = req.body;
  if (!emp_id || !toNum(amount) || !date) return res.status(400).json({ error: 'emp_id, amount, date required' });
  const { rows } = await query(
    `INSERT INTO payments (emp_id, amount, date, note) VALUES ($1, $2, $3, $4) RETURNING *`,
    [emp_id, toNum(amount), date, note || null]
  );
  res.json(rows[0]);
}));

app.delete('/api/payments/:id', asyncRoute(async (req, res) => {
  if (!isOwnerRequest(req)) return res.status(403).json({ error: 'Owner password required' });
  await query('DELETE FROM payments WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));


// Verify a password and report which role it grants.
// POST /api/auth/unlock { password } -> { ok, role }
app.post('/api/auth/unlock', (req, res) => {
  if (!authConfigured()) return res.json({ ok: true, role: 'owner', note: 'no passwords configured' });
  const pw = (req.body && req.body.password) || '';
  if (ownerPassword() && pw === ownerPassword()) return res.json({ ok: true, role: 'owner' });
  if (workerPassword() && pw === workerPassword()) return res.json({ ok: true, role: 'worker' });
  return res.status(401).json({ ok: false, error: 'wrong password' });
});

// GET /api/auth/status -> { role, authConfigured }
app.get('/api/auth/status', (req, res) => {
  res.json({ role: roleOf(req), authConfigured: authConfigured() });
});

// Legacy endpoint kept so old bookmarks/clients keep working.
app.post('/api/owner-unlock', (req, res) => {
  if (!authConfigured()) return res.json({ ok: true, note: 'no owner password configured' });
  const pw = (req.body && req.body.password) || '';
  if (ownerPassword() && pw === ownerPassword()) return res.json({ ok: true, role: 'owner' });
  return res.status(401).json({ ok: false, error: 'wrong password' });
});

app.get('/api/health', asyncRoute(async (req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, db: 'supabase-postgres' });
}));

// Vercel Cron hits this once a day (see vercel.json "crons"). Vercel Cron
// invocations are the only requests that carry `Authorization: Bearer
// <CRON_SECRET>` automatically when CRON_SECRET is set as an env var — that's
// how we tell "the real cron" apart from anyone who guesses the URL.
// If CRON_SECRET isn't set, this route refuses to run (fail closed).
app.get('/api/cron/daily-report', asyncRoute(async (req, res) => {
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  if (req.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { prevDateString, dayOfWeek } = require('./lib/dailyReport');
  const dateStr = prevDateString(istDateString(0)); // "yesterday" in IST, since this fires at 2am IST
  const { reportData, info } = await sendDailyReportEmail(dateStr);

  // If the day being reported on is a Monday, also send the week-over-week
  // comparison (this Monday vs last Monday) right after the regular report.
  let comparisonSent = false;
  if (dayOfWeek(dateStr) === 1) {
    const { sendWeeklyComparisonEmail } = require('./lib/mailer');
    await sendWeeklyComparisonEmail(dateStr);
    comparisonSent = true;
  }

  res.json({ ok: true, date: dateStr, hasAnyData: reportData.hasAnyData, messageId: info.messageId, comparisonSent });
}));

// Send the daily report email for a specific date right now — useful to test
// your SMTP settings without waiting for the 2 AM job.
// e.g. POST /api/send-report-email/2026-07-27
app.post('/api/send-report-email/:date', asyncRoute(async (req, res) => {
  const dateStr = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const { reportData, info } = await sendDailyReportEmail(dateStr);
    res.json({ ok: true, date: dateStr, hasAnyData: reportData.hasAnyData, messageId: info.messageId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}));

// Weekly comparison data as JSON (this date vs the same weekday 7 days
// earlier) — used by the Report page UI card, no email sent.
// e.g. GET /api/report/weekly-comparison/2026-08-18
app.get('/api/report/weekly-comparison/:date', asyncRoute(async (req, res) => {
  const dateStr = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const { buildWeeklyComparisonReport } = require('./lib/dailyReport');
  const comparison = await buildWeeklyComparisonReport(dateStr);
  res.json(comparison);
}));

// Send the weekly (Monday vs last Monday) comparison email for a specific
// date right now — useful to test without waiting for an actual Monday.
// e.g. POST /api/send-comparison-email/2026-08-18
app.post('/api/send-comparison-email/:date', asyncRoute(async (req, res) => {
  const dateStr = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const { sendWeeklyComparisonEmail } = require('./lib/mailer');
    const { comparison, info } = await sendWeeklyComparisonEmail(dateStr);
    res.json({ ok: true, date: dateStr, messageId: info.messageId, comparedAgainst: comparison.previous.date });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}));

// On Vercel, this file is imported by api/index.js as a serverless handler —
// it must NOT call app.listen(). Locally (`npm start`), it runs as a normal
// long-lived server exactly like before.
if (!process.env.VERCEL) {
  // startDailyReportScheduler(); // uncomment for long-lived-server deployments (see import above)
  app.listen(PORT, () => {
    console.log(`The Shallot Biriyani Sales Book running on http://localhost:${PORT}`);
    console.log(`Database: Supabase Postgres (${process.env.DATABASE_URL ? 'configured' : 'NOT CONFIGURED — set DATABASE_URL in .env'})`);
  });
}

module.exports = app;