const { Pool } = require('pg');

// Railway injects DATABASE_URL automatically — use that to detect production and enable SSL.
// Local dev never sets DATABASE_URL, so SSL is always off locally.
const isRailway = !!process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: isRailway ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle DB client:', err.message);
});

// Test connection on startup and log result
pool.query('SELECT NOW() AS now, current_database() AS db')
  .then(({ rows }) => {
    console.log(`🗄️  DB connected: ${rows[0].db} at ${rows[0].now} (SSL: ${isRailway})`);
  })
  .catch((err) => {
    console.error(`❌ DB connection FAILED: ${err.message}`);
  });

module.exports = pool;
