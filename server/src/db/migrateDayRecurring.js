require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('./pool');

async function migrateDayRecurring() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Day-based recurring schedule config (one row per day of week)
    await client.query(`
      CREATE TABLE IF NOT EXISTS day_schedules (
        day_of_week INTEGER PRIMARY KEY CHECK (day_of_week >= 0 AND day_of_week <= 6),
        shift_type  VARCHAR(50) DEFAULT 'EDV',
        start_time  TIME DEFAULT '07:00',
        end_time    TIME DEFAULT '17:00',
        enabled     BOOLEAN DEFAULT TRUE,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Drivers assigned to each day's recurring schedule
    await client.query(`
      CREATE TABLE IF NOT EXISTS day_schedule_drivers (
        id          SERIAL PRIMARY KEY,
        day_of_week INTEGER NOT NULL,
        staff_id    INTEGER REFERENCES staff(id) ON DELETE CASCADE,
        UNIQUE(day_of_week, staff_id)
      )
    `);

    // Seed 7 day rows (idempotent)
    await client.query(`
      INSERT INTO day_schedules (day_of_week)
      VALUES (0),(1),(2),(3),(4),(5),(6)
      ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
    console.log('✅ Day recurring migration complete! 7 day rows seeded.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrateDayRecurring();
