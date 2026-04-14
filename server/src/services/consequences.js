const pool = require('../db/pool');

async function checkAndApplyConsequences(staffId, violationType) {
  const rules = await pool.query(
    `SELECT * FROM consequence_rules WHERE violation_type = $1 AND is_active = true ORDER BY threshold DESC`,
    [violationType]
  );

  const violations = [];
  for (const rule of rules.rows) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM attendance
       WHERE staff_id = $1 AND status = $2
       AND (excused IS NOT TRUE)
       AND attendance_date >= CURRENT_DATE - $3`,
      [staffId, violationType, rule.time_period_days]
    );
    const count = parseInt(rows[0].cnt);

    if (count >= rule.threshold) {
      // Check if we already logged this consequence recently
      const existing = await pool.query(
        `SELECT id FROM staff_violations
         WHERE staff_id = $1 AND rule_id = $2
         AND created_at >= CURRENT_DATE - 7`,
        [staffId, rule.id]
      );
      if (existing.rows.length === 0) {
        const v = await pool.query(
          `INSERT INTO staff_violations (staff_id, rule_id, violation_type, action_taken, notes)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [staffId, rule.id, violationType, rule.consequence_action,
           `Auto-triggered: ${count} ${violationType} incidents in last ${rule.time_period_days} days`]
        );
        violations.push({ rule: rule.rule_name, action: rule.consequence_action, violation: v.rows[0] });
      }
      break; // Apply most severe applicable rule only
    }
  }
  return violations;
}

module.exports = { checkAndApplyConsequences };
