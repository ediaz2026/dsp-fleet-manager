const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running publish_status migration...');

    // Add publish_status column to shifts
    await client.query(`
      ALTER TABLE shifts
      ADD COLUMN IF NOT EXISTS publish_status VARCHAR(20) DEFAULT 'draft'
    `);

    // Existing shifts (before this feature) should default to published so they remain visible
    await client.query(`
      UPDATE shifts SET publish_status = 'published'
      WHERE publish_status IS NULL OR publish_status = 'draft'
        AND created_at < NOW() - INTERVAL '1 minute'
    `);

    // Add schedule_visibility_days setting
    await client.query(`
      INSERT INTO settings (setting_key, setting_value, setting_type, description)
      VALUES ('schedule_visibility_days', '14', 'number', 'How far ahead (in days) drivers can see the schedule')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
