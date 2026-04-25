const pool = require('./pool');

module.exports = async function migrateRouteTargets() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_targets (
      id SERIAL PRIMARY KEY,
      target_date DATE NOT NULL UNIQUE,
      route_target INTEGER NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Migrate existing cr_tracker route_target data into route_targets
  await pool.query(`
    INSERT INTO route_targets (target_date, route_target)
    SELECT plan_date, route_target FROM cr_tracker WHERE route_target IS NOT NULL
    ON CONFLICT (target_date) DO NOTHING
  `).catch(() => {});
  console.log('✅ route_targets table ready');
};
