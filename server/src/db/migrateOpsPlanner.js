require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_planner_sessions (
        id               SERIAL PRIMARY KEY,
        plan_date        DATE NOT NULL UNIQUE,
        rows             JSONB NOT NULL DEFAULT '[]',
        route_summary    JSONB,
        station_summary  JSONB,
        volume_summary   JSONB,
        created_by       INT REFERENCES staff(id),
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ ops_planner_sessions table ready');

    await client.query(`
      CREATE TABLE IF NOT EXISTS week_schedules (
        id           SERIAL PRIMARY KEY,
        week_start   DATE NOT NULL UNIQUE,
        file_name    VARCHAR(255),
        rows         JSONB NOT NULL DEFAULT '[]',
        created_by   INT REFERENCES staff(id),
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅ week_schedules table ready');

    await client.query('COMMIT');
    console.log('\n🎉 Ops Planner migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
