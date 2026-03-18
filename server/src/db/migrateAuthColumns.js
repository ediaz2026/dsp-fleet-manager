const pool = require('./pool');

async function migrate() {
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE`);
  console.log('Auth columns migrated successfully');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
