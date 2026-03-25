const pool = require('../db/pool');

/**
 * logAudit — write one row to audit_log.
 * Swallows errors so a logging failure never breaks the main request.
 *
 * @param {object} req   - Express request (for user + IP)
 * @param {object} opts  - { action_type, entity_type, entity_id, entity_description, old_value, new_value }
 */
async function logAudit(req, { action_type, entity_type, entity_id, entity_description, old_value, new_value } = {}) {
  try {
    const user = req?.user || {};
    const ip   = (req?.headers?.['x-forwarded-for'] || req?.ip || '').split(',')[0].trim() || null;
    await pool.query(
      `INSERT INTO audit_log
         (user_id, user_name, user_role, action_type, entity_type, entity_id,
          entity_description, old_value, new_value, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        user.id   || null,
        user.name || null,
        user.role || null,
        action_type,
        entity_type || null,
        entity_id   || null,
        entity_description || null,
        old_value != null ? JSON.stringify(old_value) : null,
        new_value != null ? JSON.stringify(new_value) : null,
        ip,
      ]
    );
  } catch (err) {
    console.error('[audit] log error:', err.message);
  }
}

module.exports = { logAudit };
