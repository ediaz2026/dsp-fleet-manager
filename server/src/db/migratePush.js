const pool = require('./pool');

module.exports = async function migratePush() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER REFERENCES staff(id),
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(staff_id, endpoint)
    )
  `);
  console.log('✅ push_subscriptions table ready');
};
