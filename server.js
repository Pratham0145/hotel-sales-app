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
// Helpers
// ---------------------------------------------------------------------------
const ENTRY_FIELDS = ['cb','pb','rice','kabab','parcel','water','cp','pp','cw','pw','s1','s2','online','cash'];
const ITEMS_FIELDS = ['chicken_plates','veg_plates','chicken','rice'];

function pad2(n){ return String(n).padStart(2, '0'); }
function monthPrefix(year, month){ return `${year}-${pad2(month)}-`; }
function dayFromDate(dateStr){ return parseInt(dateStr.split('-')[2], 10); }

// ---------------------------------------------------------------------------
// Owner auth — a single shared password (set OWNER_PASSWORD in .env).
// Workers can only write today's date; the owner unlocks past dates and the
// Amount/Report tabs by sending the password in the X-Owner-Password header.
// If OWNER_PASSWORD isn't set at all, the feature is off (nothing is restricted)
// so a fresh install never locks you out before you've configured it.
// ---------------------------------------------------------------------------
function ownerPasswordConfigured(){ return !!process.env.OWNER_PASSWORD; }
function isOwnerRequest(req){
  if (!ownerPasswordConfigured()) return true;
  return req.get('X-Owner-Password') === process.env.OWNER_PASSWORD;
}
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
  if (date !== todayDateStr() && !isOwnerRequest(req)) {
    return res.status(403).json({ error: 'Only the owner can edit past dates. Enter the owner password in the app.' });
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
  if (date !== todayDateStr() && !isOwnerRequest(req)) {
    return res.status(403).json({ error: 'Only the owner can edit past dates. Enter the owner password in the app.' });
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

// Verify the owner password. If OWNER_PASSWORD isn't configured, this always
// succeeds (the feature is simply off until you set one).
app.post('/api/owner-unlock', (req, res) => {
  if (!ownerPasswordConfigured()) return res.json({ ok: true, note: 'no owner password configured' });
  const pw = (req.body && req.body.password) || '';
  if (pw === process.env.OWNER_PASSWORD) return res.json({ ok: true });
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
  const { prevDateString } = require('./lib/dailyReport');
  const dateStr = prevDateString(istDateString(0)); // "yesterday" in IST, since this fires at 2am IST
  const { reportData, info } = await sendDailyReportEmail(dateStr);
  res.json({ ok: true, date: dateStr, hasAnyData: reportData.hasAnyData, messageId: info.messageId });
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
