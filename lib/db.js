// lib/db.js
// Postgres connection (Supabase) via the `pg` driver — replaces better-sqlite3.
//
// Why `pg` instead of @supabase/supabase-js: Supabase IS Postgres under the
// hood. The supabase-js client is a REST wrapper (PostgREST) built for
// browser/RLS-scoped access; this app is a trusted single backend talking
// straight to the database, so plain SQL over `pg` is simpler, faster, and
// keeps the queries almost identical to the old SQLite ones.
//
// Serverless note: Vercel functions are stateless and can spin up many
// concurrent instances, each wanting its own DB connection. A direct
// Postgres connection (port 5432) will exhaust Supabase's connection limit
// fast. Use Supabase's **connection pooler** instead:
//   Project Settings -> Database -> Connection string -> "Transaction" mode
//   (port 6543). Put that full string in DATABASE_URL.
// We also cap the local pool to a single connection per function instance,
// which is the recommended pattern for pgbouncer transaction-mode pooling.

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and set it to your ' +
    'Supabase connection string (use the "Transaction" pooler, port 6543, ' +
    'for serverless deployments).'
  );
}

// Reuse a single Pool across invocations in the same warm Lambda instance.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.VERCEL ? 1 : 10, // 1 connection per serverless instance; more if running as a long-lived server
  idleTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL; their cert chain works fine with this setting
});

pool.on('error', (err) => {
  // Idle clients can emit background errors (e.g. pooler recycling connections) — log, don't crash.
  console.error('[db] Unexpected error on idle Postgres client', err);
});

// Thin helper so call sites read like `await query('SELECT ...', [a, b])`.
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
