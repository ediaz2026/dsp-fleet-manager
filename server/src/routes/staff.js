const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/staff
router.get('/', async (req, res) => {
  const { role, status, search } = req.query;
  let q = `
    SELECT s.id, s.employee_id, s.first_name, s.last_name, s.email, s.phone,
           s.role, s.status, s.hire_date, s.personal_email,
           s.failed_login_attempts, s.locked_until, s.last_login,
           s.must_change_password, s.invitation_sent_at, s.created_at, s.updated_at,
           d.license_expiration, d.transponder_id as driver_transponder
    FROM staff s LEFT JOIN drivers d ON d.staff_id = s.id WHERE 1=1`;
  const params = [];

  // Drivers can only see their own record
  if (req.user.role === 'driver') {
    params.push(req.user.id);
    q += ` AND s.id = $${params.length}`;
  }

  if (role) { params.push(role); q += ` AND s.role = $${params.length}`; }
  if (status) { params.push(status); q += ` AND s.status = $${params.length}`; }
  if (search) {
    params.push(`%${search}%`);
    q += ` AND (s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.employee_id ILIKE $${params.length})`;
  }
  q += ' ORDER BY s.last_name, s.first_name';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// GET /api/staff/:id
router.get('/:id', async (req, res) => {
  // Drivers can only fetch their own record
  if (req.user.role === 'driver' && parseInt(req.params.id) !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { rows } = await pool.query(
    `SELECT s.id, s.employee_id, s.first_name, s.last_name, s.email, s.phone,
            s.role, s.status, s.hire_date, s.personal_email,
            s.failed_login_attempts, s.locked_until, s.last_login,
            s.must_change_password, s.invitation_sent_at, s.created_at, s.updated_at,
            d.id as driver_id, d.license_number, d.license_expiration,
            d.license_state, d.transponder_id, d.emergency_contact_name,
            d.emergency_contact_phone, d.notes as driver_notes
     FROM staff s LEFT JOIN drivers d ON d.staff_id = s.id WHERE s.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Staff not found' });
  res.json(rows[0]);
});

// POST /api/staff
router.post('/', managerOnly, async (req, res) => {
  const { employee_id, first_name, last_name, email, phone, role, hire_date, status = 'active', password = 'password123' } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO staff (employee_id, first_name, last_name, email, phone, role, hire_date, status, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, employee_id, first_name, last_name, email, phone, role, status, hire_date, created_at, updated_at`,
    [employee_id, first_name, last_name, email, phone, role, hire_date, status, hash]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/staff/:id
router.put('/:id', managerOnly, async (req, res) => {
  const { first_name, last_name, email, phone, role, hire_date, status } = req.body;
  const { rows } = await pool.query(
    `UPDATE staff SET first_name=$1, last_name=$2, email=$3, phone=$4, role=$5, hire_date=$6, status=$7, updated_at=NOW()
     WHERE id=$8 RETURNING id, employee_id, first_name, last_name, email, phone, role, status, hire_date, created_at, updated_at`,
    [first_name, last_name, email, phone, role, hire_date, status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /api/staff/:id (soft delete)
router.delete('/:id', managerOnly, async (req, res) => {
  await pool.query("UPDATE staff SET status='terminated', updated_at=NOW() WHERE id=$1", [req.params.id]);
  res.json({ message: 'Staff member terminated' });
});

// GET /api/staff/:id/violations
router.get('/:id/violations', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT sv.*, cr.rule_name FROM staff_violations sv
     JOIN consequence_rules cr ON cr.id = sv.rule_id
     WHERE sv.staff_id = $1 ORDER BY sv.created_at DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// GET /api/staff/:id/attendance-summary
router.get('/:id/attendance-summary', async (req, res) => {
  const { days = 90 } = req.query;
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'present') as present_count,
       COUNT(*) FILTER (WHERE status = 'called_out') as called_out_count,
       COUNT(*) FILTER (WHERE status = 'ncns') as ncns_count,
       COUNT(*) FILTER (WHERE status = 'late') as late_count,
       COALESCE(SUM(hours_worked), 0) as total_hours,
       COALESCE(AVG(late_minutes) FILTER (WHERE status = 'late'), 0) as avg_late_minutes
     FROM attendance
     WHERE staff_id = $1 AND attendance_date >= CURRENT_DATE - $2`,
    [req.params.id, parseInt(days)]
  );
  res.json(rows[0]);
});

module.exports = router;
