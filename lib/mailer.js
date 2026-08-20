// lib/mailer.js
// Formats the daily report as an email and sends it over SMTP via nodemailer
// (open source, works with any SMTP provider — Gmail, Outlook, Brevo, your own mail server, etc).
const nodemailer = require('nodemailer');
const { buildDailyReport } = require('./dailyReport');

function fmtMoney(n) { return '₹' + Math.round(n || 0).toLocaleString('en-IN'); }
function fmtRatio(n) { return (n === null || n === undefined || !isFinite(n)) ? '—' : n.toFixed(2); }

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

function row(label, value) {
  return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555;">${label}</td>
    <td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600;text-align:right;">${value}</td></tr>`;
}
function sectionTable(title, rows) {
  return `
    <h3 style="font-family:sans-serif;color:#B5731A;font-size:14px;text-transform:uppercase;letter-spacing:.04em;margin:22px 0 8px;">${title}</h3>
    <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px;">${rows.join('')}</table>
  `;
}

function buildEmailHtml(r) {
  const diffColor = r.report.totalDiff > 0 ? '#C13B2D' : (r.report.totalDiff < -500 ? '#8A6A12' : '#3F6B3A');
  return `
  <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#221C18;">
    <div style="background:#221C18;color:#F3EFE4;padding:18px 22px;border-radius:8px 8px 0 0;">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#DE9A2E;">Daily Sales Report</div>
      <div style="font-size:20px;font-weight:700;text-transform:uppercase;">The Shallot Biriyani — ${r.date}</div>
    </div>
    <div style="border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px;padding:10px 22px 22px;">
      ${!r.hasAnyData ? `<p style="color:#8B9490;">No entries were logged for either outlet on this date.</p>` : ''}
      ${sectionTable('Food Truck', [
        row('Total Sale', fmtMoney(r.truck.totalSale)),
        row('Difference', fmtMoney(r.truck.difference)),
        row('Chicken Plate Diff', r.truck.chickenPlateDiff),
        row('Paneer Plate Diff', r.truck.paneerPlateDiff),
        row('Rice Diff', r.truck.riceDiff),
      ])}
      ${sectionTable('JP Nagar', [
        row('Total Sale', fmtMoney(r.jp.totalSale)),
        row('Difference', fmtMoney(r.jp.difference)),
        row('Chicken Plate Diff', r.jp.chickenPlateDiff),
        row('Paneer Plate Diff', r.jp.paneerPlateDiff),
        row('Rice Diff', r.jp.riceDiff),
      ])}
      ${sectionTable('Amount — Collections', [
        row('JP Online', fmtMoney(r.amount.jpOnline)),
        row('JP Cash', fmtMoney(r.amount.jpCash)),
        row('Truck Online', fmtMoney(r.amount.truckOnline)),
        row('Truck Cash', fmtMoney(r.amount.truckCash)),
        row('Combined Total', fmtMoney(r.amount.combinedTotal)),
      ])}
      ${sectionTable('Report — Combined', [
        row('Total Sale', fmtMoney(r.report.totalSale)),
        row('Total Difference', `<span style="color:${diffColor};">${fmtMoney(r.report.totalDiff)}</span>`),
        row('Chicken Plate Diff', r.report.chickenPlateDiffAll),
        row('Rice Plate Diff', r.report.ricePlateDiffAll),
        row('Chicken Ready Ratio', fmtRatio(r.report.chickenReadyRatio)),
        row('Chicken Sale Ratio', fmtRatio(r.report.chickenSaleRatio)),
        row('Chicken Sale+Waste Ratio', fmtRatio(r.report.chickenSaleWasteRatio)),
        row('Rice Ready Ratio', fmtRatio(r.report.riceReadyRatio)),
        row('Rice Sale Ratio', fmtRatio(r.report.riceSaleRatio)),
        row('Rice Sale+Waste Ratio', fmtRatio(r.report.riceSaleWasteRatio)),
      ])}
      <p style="font-size:11px;color:#8B9490;margin-top:20px;">Sent automatically at 2:00 AM IST for the previous day's business.</p>
    </div>
  </div>`;
}

function buildComparisonEmailHtml({ current, previous }) {
  const diff = (a, b) => a - b;
  const pct = (a, b) => (b ? (((a - b) / Math.abs(b)) * 100).toFixed(1) + '%' : '—');

  const sideBySide = (label, curVal, prevVal) => sectionTable(label, [
    row(current.date, fmtMoney(curVal)),
    row(previous.date, fmtMoney(prevVal)),
    row('Change', `${fmtMoney(diff(curVal, prevVal))} (${pct(curVal, prevVal)})`),
  ]);

  return `
  <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#221C18;">
    <div style="background:#221C18;color:#F3EFE4;padding:18px 22px;border-radius:8px 8px 0 0;">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#DE9A2E;">Weekly Comparison</div>
      <div style="font-size:20px;font-weight:700;text-transform:uppercase;">${current.date} vs ${previous.date}</div>
    </div>
    <div style="border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px;padding:10px 22px 22px;">
      ${sideBySide('JP Nagar Sale', current.report.jpSale, previous.report.jpSale)}
      ${sideBySide('Truck Sale', current.report.truckSale, previous.report.truckSale)}
      <p style="font-size:11px;color:#8B9490;margin-top:20px;">Auto-sent because ${current.date} is a Monday — compared against the same weekday last week.</p>
    </div>
  </div>`;
}

async function sendWeeklyComparisonEmail(dateStr, overrideTransporter) {
  const { buildWeeklyComparisonReport } = require('./dailyReport');
  const comparison = await buildWeeklyComparisonReport(dateStr);
  const transporter = overrideTransporter || getTransporter();
  if (!transporter) throw new Error('SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS in .env');
  if (!process.env.REPORT_EMAIL_TO) throw new Error('REPORT_EMAIL_TO not set in .env');

  const info = await transporter.sendMail({
    from: process.env.REPORT_EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.REPORT_EMAIL_TO,
    subject: `The Shallot Biriyani — Weekly Comparison for ${dateStr}`,
    html: buildComparisonEmailHtml(comparison),
  });
  return { comparison, info };
}

async function sendDailyReportEmail(dateStr, overrideTransporter) {
  // db is no longer a parameter — dailyReport.js now talks to Postgres itself via lib/db.js
  const reportData = await buildDailyReport(dateStr);
  const transporter = overrideTransporter || getTransporter();
  if (!transporter) throw new Error('SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS in .env');
  if (!process.env.REPORT_EMAIL_TO) throw new Error('REPORT_EMAIL_TO not set in .env');

  const info = await transporter.sendMail({
    from: process.env.REPORT_EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.REPORT_EMAIL_TO,
    subject: `The Shallot Biriyani — Daily Report for ${dateStr}`,
    html: buildEmailHtml(reportData),
  });
  return { reportData, info };
}

module.exports = { sendDailyReportEmail, sendWeeklyComparisonEmail, buildEmailHtml, buildComparisonEmailHtml, getTransporter };