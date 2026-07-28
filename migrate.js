// migrate.js
// One-time script: copies every row out of the local data/hotel.db (SQLite)
// into your Supabase Postgres database. Run this ONCE, locally, after you've
// applied supabase/schema.sql to the new database.
//
// Usage:
//   1. Make sure supabase/schema.sql has already been run against your
//      Supabase project (SQL Editor, or `psql "$DATABASE_URL" -f supabase/schema.sql`).
//   2. Set DATABASE_URL in .env to your Supabase connection string.
//   3. npm run migrate
//
// Safe to re-run: uses ON CONFLICT DO UPDATE, so re-running just re-syncs
// rows instead of duplicating them.
//
// better-sqlite3 is only needed for this script (to read the OLD database) —
// it's listed in devDependencies, not a runtime dependency of the deployed app.

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const SQLITE_PATH = process.env.OLD_DB_PATH || path.join(__dirname, 'data', 'hotel.db');

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`No SQLite file found at ${SQLITE_PATH}. Nothing to migrate.`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — point it at your Supabase connection string in .env first.');
    process.exit(1);
  }

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.error('better-sqlite3 is not installed. Run: npm install --save-dev better-sqlite3');
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // --- entries ---
    const entries = sqlite.prepare('SELECT * FROM entries').all();
    console.log(`Found ${entries.length} rows in entries`);
    for (const row of entries) {
      await pool.query(
        `INSERT INTO entries
           (outlet, date, cb, pb, rice, kabab, parcel, water, cp, pp, cw, pw, s1, s2, online, cash, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (outlet, date) DO UPDATE SET
           cb=excluded.cb, pb=excluded.pb, rice=excluded.rice, kabab=excluded.kabab, parcel=excluded.parcel,
           water=excluded.water, cp=excluded.cp, pp=excluded.pp, cw=excluded.cw, pw=excluded.pw,
           s1=excluded.s1, s2=excluded.s2, online=excluded.online, cash=excluded.cash, updated_at=excluded.updated_at`,
        [
          row.outlet, row.date, row.cb, row.pb, row.rice, row.kabab, row.parcel, row.water,
          row.cp, row.pp, row.cw, row.pw, row.s1, row.s2, row.online, row.cash, row.updated_at,
        ]
      );
    }

    // --- items_used ---
    const items = sqlite.prepare('SELECT * FROM items_used').all();
    console.log(`Found ${items.length} rows in items_used`);
    for (const row of items) {
      await pool.query(
        `INSERT INTO items_used (date, chicken_plates, veg_plates, chicken, rice, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (date) DO UPDATE SET
           chicken_plates=excluded.chicken_plates, veg_plates=excluded.veg_plates,
           chicken=excluded.chicken, rice=excluded.rice, updated_at=excluded.updated_at`,
        [row.date, row.chicken_plates, row.veg_plates, row.chicken, row.rice, row.updated_at]
      );
    }

    console.log('✅ Migration complete.');
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
