const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware, adminOnly);

// GET /api/audit-log  — paginated, filtered
router.get('/', async (req, res) => {
  const {
    page = 1, limit = 50,
    user_id, role, action_type, entity_type,
    date_from, date_to, search,
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [];
  const conditions = [];

  if (user_id)     { params.push(parseInt(user_id));     conditions.push(`al.user_id = $${params.length}`); }
  if (role)        { params.push(role);                  conditions.push(`al.user_role = $${params.length}`); }
  if (action_type) { params.push(action_type);           conditions.push(`al.action_type = $${params.length}`); }
  if (entity_type) { params.push(entity_type);           conditions.push(`al.entity_type = $${params.length}`); }
  if (date_from)   { params.push(date_from);             conditions.push(`al.timestamp >= $${params.length}::date`); }
  if (date_to)     { params.push(date_to);               conditions.push(`al.timestamp < ($${params.length}::date + interval '1 day')`); }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(al.user_name ILIKE $${params.length} OR al.entity_description ILIKE $${params.length} OR al.action_type ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM audit_log al ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  params.push(parseInt(limit));
  params.push(offset);
  const { rows } = await pool.query(
    `SELECT al.* FROM audit_log al
     ${where}
     ORDER BY al.timestamp DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/audit-log/users  — distinct users who have audit entries (for filter dropdown)
router.get('/users', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT user_id, user_name, user_role
     FROM audit_log
     WHERE user_id IS NOT NULL
     ORDER BY user_name`
  );
  res.json(rows);
});

module.exports = router;
