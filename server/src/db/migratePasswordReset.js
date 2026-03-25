const pool = require('../db/pool');

async function migratePasswordReset() {
  try {
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS reset_token VARCHAR(64)`);
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS invitation_token VARCHAR(64)`);
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS invitation_token_expiry TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_reset_token ON staff(reset_token) WHERE reset_token IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_invitation_token ON staff(invitation_token) WHERE invitation_token IS NOT NULL`);
    console.log('✅ Password reset / invitation token columns ready');
  } catch (err) {
    console.error('⚠️  migratePasswordReset error:', err.message);
  }
}

module.exports = migratePasswordReset;
