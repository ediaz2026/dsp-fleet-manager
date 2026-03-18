require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running driver recurring schedule migration…');

    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_recurring_shifts (
        id         SERIAL PRIMARY KEY,
        staff_id   INTEGER REFERENCES staff(id) ON DELETE CASCADE,
        shift_type VARCHAR(50) NOT NULL DEFAULT 'EDV',
        start_time TIME NOT NULL DEFAULT '07:00',
        end_time   TIME NOT NULL DEFAULT '17:00',
        sun        BOOLEAN DEFAULT FALSE,
        mon        BOOLEAN DEFAULT FALSE,
        tue        BOOLEAN DEFAULT FALSE,
        wed        BOOLEAN DEFAULT FALSE,
        thu        BOOLEAN DEFAULT FALSE,
        fri        BOOLEAN DEFAULT FALSE,
        sat        BOOLEAN DEFAULT FALSE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅  driver_recurring_shifts table ready');

    await client.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_rotating BOOLEAN DEFAULT FALSE`);
    console.log('✅  staff.is_rotating column ready');

    console.log('\nMigration complete.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
