// lib/scheduler.js
// Fires every day at 2:00 AM India time and emails the report for the day that
// just closed (the outlets' last sale slot is 12am-1am, so by 2am "yesterday"
// is complete and ready to report on).
const cron = require('node-cron');
const { sendDailyReportEmail, sendWeeklyComparisonEmail } = require('./mailer');
const { istDateString, prevDateString, dayOfWeek } = require('./dailyReport');

// Note: this only works on a long-lived process (VPS, Railway, Render, etc).
// Vercel serverless functions don't stay running, so on Vercel this scheduler
// is never invoked — use the Vercel Cron config in vercel.json + api/cron.js
// instead (it hits sendDailyReportEmail on a schedule the same way).
function startDailyReportScheduler() {
  cron.schedule('0 2 * * *', async () => {
    const dateStr = prevDateString(istDateString(0));
    try {
      await sendDailyReportEmail(dateStr);
      console.log(`[report-email] Sent daily report for ${dateStr}`);
      if (dayOfWeek(dateStr) === 1) {
        await sendWeeklyComparisonEmail(dateStr);
        console.log(`[report-email] Sent weekly comparison for ${dateStr}`);
      }
    } catch (err) {
      console.error(`[report-email] Failed to send report for ${dateStr}:`, err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  console.log('[report-email] Scheduler armed — daily report will send at 2:00 AM IST');
}

module.exports = { startDailyReportScheduler };