// lib/dailyReport.js
// Pulls one calendar day's data from Postgres (Supabase) and re-computes the
// same formulas the frontend uses (public/app.js), so the emailed report
// always matches what's on screen in the app.
//
// Changed from the SQLite version: every DB call is now async (await query()
// instead of db.prepare().get()), and callers (mailer.js, server.js) must
// await buildDailyReport(). The math itself is untouched.

const { query } = require('./db');

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function pad2(n) { return String(n).padStart(2, '0'); }

// Current date in Asia/Kolkata as 'YYYY-MM-DD', optionally offset by whole days.
function istDateString(offsetDays = 0) {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  ist.setDate(ist.getDate() + offsetDays);
  return `${ist.getFullYear()}-${pad2(ist.getMonth() + 1)}-${pad2(ist.getDate())}`;
}

function prevDateString(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function isFirstOfMonth(dateStr) { return dateStr.split('-')[2] === '01'; }

// Generic version of prevDateString — shift by any number of days (+ or -).
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

// 0=Sun, 1=Mon ... 6=Sat — using local date parts, same pattern as prevDateString,
// so it can't be thrown off by UTC/local timezone parsing quirks.
function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

async function getEntryRow(outlet, dateStr) {
  const { rows } = await query(`SELECT * FROM entries WHERE outlet = $1 AND date = $2`, [outlet, dateStr]);
  return rows[0] || {};
}
async function getItemsRow(dateStr) {
  const { rows } = await query(`SELECT * FROM items_used WHERE date = $1`, [dateStr]);
  return rows[0] || {};
}

// Same formulas as public/app.js's computeEntryDay, working off two single rows
// (today + yesterday, for the 12am-1am carry-over) instead of a whole month map.
function computeOutletDay(dayRow, prevRow, firstOfMonth) {
  const cb=num(dayRow.cb), pb=num(dayRow.pb), rice=num(dayRow.rice), cp=num(dayRow.cp), pp=num(dayRow.pp),
        cw=num(dayRow.cw), pw=num(dayRow.pw), s1=num(dayRow.s1), s2=num(dayRow.s2),
        online=num(dayRow.online), cash=num(dayRow.cash);
  const chickenPlateDiff = cp - cb - cw;
  const paneerPlateDiff = pp - pb - pw;
  const totalSale = firstOfMonth ? (s1 + s2) : (s1 + s2 - num(prevRow.s2));
  const difference = totalSale - online - cash;
  const riceDiff = cp + pp - cb - pb - rice - cw - pw;
  const riceSale = cb + pb + rice;
  return { cb, pb, rice, cp, pp, cw, pw, s1, s2, online, cash, chickenPlateDiff, paneerPlateDiff, totalSale, difference, riceDiff, riceSale };
}

function safeDiv(a, b) { return b ? a / b : null; }

// Builds everything needed for one day's email: Food Truck, JP Nagar, combined
// Amount and Report figures — same formulas as the web app, computed server-side.
async function buildDailyReport(dateStr) {
  const firstOfMonth = isFirstOfMonth(dateStr);
  const prevDate = prevDateString(dateStr);

  const [jpRow, jpPrevRow, truckRow, truckPrevRow, itemsRow] = await Promise.all([
    getEntryRow('jp', dateStr),
    getEntryRow('jp', prevDate),
    getEntryRow('truck', dateStr),
    getEntryRow('truck', prevDate),
    getItemsRow(dateStr),
  ]);

  const jc = computeOutletDay(jpRow, jpPrevRow, firstOfMonth);
  const tc = computeOutletDay(truckRow, truckPrevRow, firstOfMonth);

  const amount = {
    jpOnline: jc.online, jpCash: jc.cash, jpTotal: jc.online + jc.cash,
    truckOnline: tc.online, truckCash: tc.cash, truckTotal: tc.online + tc.cash,
  };
  amount.combinedTotal = amount.jpTotal + amount.truckTotal;

  const chickenUsed = num(itemsRow.chicken), riceUsed = num(itemsRow.rice);
  const chickenPlatesMade = num(itemsRow.chicken_plates), vegPlatesMade = num(itemsRow.veg_plates);
  const chickenSold = jc.cb + tc.cb;
  const chickenSoldWaste = (jc.cb + jc.cw) + (tc.cb + tc.cw);
  const riceSoldTotal = jc.riceSale + tc.riceSale;
  const riceSoldWaste = (jc.riceSale + jc.cw + jc.pw) + (tc.riceSale + tc.cw + tc.pw);

  const report = {
    jpSale: jc.totalSale, truckSale: tc.totalSale, totalSale: jc.totalSale + tc.totalSale,
    jpDiff: jc.difference, truckDiff: tc.difference, totalDiff: jc.difference + tc.difference,
    chickenPlateDiffAll: jc.chickenPlateDiff + tc.chickenPlateDiff,
    ricePlateDiffAll: jc.riceDiff + tc.riceDiff,
    chickenReadyRatio: safeDiv(chickenPlatesMade, chickenUsed),
    chickenSaleRatio: safeDiv(chickenSold, chickenUsed),
    chickenSaleWasteRatio: safeDiv(chickenSoldWaste, chickenUsed),
    riceReadyRatio: safeDiv(chickenPlatesMade + vegPlatesMade, riceUsed),
    riceSaleRatio: safeDiv(riceSoldTotal, riceUsed),
    riceSaleWasteRatio: safeDiv(riceSoldWaste, riceUsed),
  };

  const hasAnyData = ['cb','pb','cp','pp','s1','s2','online','cash'].some(k => num(jpRow[k])!==0 || num(truckRow[k])!==0)
    || ['chicken_plates','veg_plates','chicken','rice'].some(k => num(itemsRow[k])!==0);

  return { date: dateStr, hasAnyData, truck: tc, jp: jc, items: itemsRow, amount, report };
}

// Builds today's report + the same weekday from 7 days ago, for the
// week-over-week comparison email (e.g. this Monday vs last Monday).
async function buildWeeklyComparisonReport(dateStr) {
  const lastWeekDate = addDays(dateStr, -7);
  const [current, previous] = await Promise.all([
    buildDailyReport(dateStr),
    buildDailyReport(lastWeekDate),
  ]);
  return { current, previous };
}

module.exports = { buildDailyReport, buildWeeklyComparisonReport, istDateString, prevDateString, addDays, dayOfWeek };