const pool = require('./pool');

module.exports = async function migrateRTS() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rts_log (
      id SERIAL PRIMARY KEY,
      plan_date DATE NOT NULL,
      staff_id INTEGER REFERENCES staff(id),
      route_code VARCHAR,
      depart_time VARCHAR,
      rts_time VARCHAR,
      cortex_undeliverables INTEGER DEFAULT 0,
      packages_returned INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(plan_date, staff_id)
    )
  `);
  console.log('✅ rts_log table ready');
};
