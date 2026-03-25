const pool = require('./pool');

async function migrateAuditLog() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id                 SERIAL PRIMARY KEY,
      user_id            INT REFERENCES staff(id) ON DELETE SET NULL,
      user_name          VARCHAR(255),
      user_role          VARCHAR(50),
      action_type        VARCHAR(50) NOT NULL,
      entity_type        VARCHAR(50),
      entity_id          INT,
      entity_description TEXT,
      old_value          JSONB,
      new_value          JSONB,
      ip_address         VARCHAR(45),
      timestamp          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp   ON audit_log(timestamp DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_user_id     ON audit_log(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action_type ON audit_log(action_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON audit_log(entity_type)`);
  console.log('✅ migrateAuditLog done');
}

module.exports = migrateAuditLog;
