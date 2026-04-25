const pool = require('./pool');

module.exports = async function migrateCR() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cr_tracker (
      id SERIAL PRIMARY KEY,
      plan_date DATE NOT NULL UNIQUE,
      route_target INTEGER,
      available_capacity INTEGER,
      amazon_paid_cancels INTEGER DEFAULT 0,
      dsp_dropped_routes INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('✅ cr_tracker table ready');
};
