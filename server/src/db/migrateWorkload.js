const pool = require('./pool');

module.exports = async function migrateWorkload() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS driver_daily_workload (
      id SERIAL PRIMARY KEY,
      work_date DATE NOT NULL,
      staff_id INTEGER REFERENCES staff(id),
      driver_name VARCHAR,
      route_code VARCHAR,
      shift_type VARCHAR,
      wave_time VARCHAR,
      duration_minutes INTEGER,
      eft_time VARCHAR,
      eft_color VARCHAR,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(work_date, staff_id)
    )
  `);
  console.log('✅ driver_daily_workload table ready');
};
