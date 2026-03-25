const pool = require('./pool');

async function migrateNotifications() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         SERIAL PRIMARY KEY,
      staff_id   INTEGER REFERENCES staff(id) ON DELETE CASCADE,
      title      VARCHAR(255) NOT NULL,
      message    TEXT,
      type       VARCHAR(50)  NOT NULL DEFAULT 'general',
      is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_staff_id  ON notifications(staff_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_is_read   ON notifications(staff_id, is_read)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_created   ON notifications(created_at DESC)`);
  console.log('✅ migrateNotifications done');
}

module.exports = migrateNotifications;
