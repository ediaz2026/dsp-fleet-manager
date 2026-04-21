const pool = require('./pool');

module.exports = async function migrateRaffle() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raffle_tickets (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER REFERENCES staff(id),
      period VARCHAR NOT NULL,
      rescue_id INTEGER REFERENCES ops_rescues(id),
      tickets_earned INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(staff_id, rescue_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raffle_draws (
      id SERIAL PRIMARY KEY,
      period VARCHAR NOT NULL,
      winner_staff_id INTEGER REFERENCES staff(id),
      winner_name VARCHAR,
      winner_tickets INTEGER,
      total_participants INTEGER,
      drawn_at TIMESTAMPTZ DEFAULT NOW(),
      drawn_by INTEGER REFERENCES staff(id),
      notes TEXT
    )
  `);
  console.log('✅ raffle_tickets + raffle_draws tables ready');
};
