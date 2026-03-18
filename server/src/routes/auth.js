const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { rows } = await pool.query(
    'SELECT * FROM staff WHERE email = $1 AND status != $2',
    [email, 'terminated']
  );
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  // Lockout check
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(423).json({ error: 'Account locked. Try again in 30 minutes.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const attempts = (user.failed_login_attempts || 0) + 1;
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
    await pool.query(
      'UPDATE staff SET failed_login_attempts=$1, locked_until=$2 WHERE id=$3',
      [attempts, lockUntil, user.id]
    );
    const msg = attempts >= 5
      ? 'Account locked after 5 failed attempts. Try again in 30 minutes.'
      : 'Invalid credentials';
    return res.status(401).json({ error: msg });
  }

  // Success: reset attempts, record last_login
  await pool.query(
    'UPDATE staff SET failed_login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=$1',
    [user.id]
  );

  const expiresIn = rememberMe ? '30d' : '8h';
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
    JWT_SECRET,
    { expiresIn }
  );

  res.json({
    token,
    must_change_password: user.must_change_password || false,
    user: {
      id: user.id,
      employeeId: user.employee_id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      status: user.status,
      mustChangePassword: user.must_change_password || false,
    }
  });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, employee_id, first_name, last_name, email, role, status, hire_date, must_change_password FROM staff WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const { rows } = await pool.query(
    'SELECT password_hash, must_change_password FROM staff WHERE id = $1',
    [req.user.id]
  );
  const record = rows[0];

  // If must_change_password is true, skip current password check (admin-forced reset)
  if (!record.must_change_password) {
    if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
    const valid = await bcrypt.compare(currentPassword, record.password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    'UPDATE staff SET password_hash=$1, must_change_password=FALSE, updated_at=NOW() WHERE id=$2',
    [hash, req.user.id]
  );
  res.json({ message: 'Password updated' });
});

// ─── User Management (admin only) ──────────────────────────────────────────

// GET /api/auth/users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, employee_id, first_name, last_name, email, role, status, last_login, must_change_password
     FROM staff
     ORDER BY first_name, last_name`
  );
  res.json(rows);
});

// POST /api/auth/users
router.post('/users', authMiddleware, adminOnly, async (req, res) => {
  const { first_name, last_name, email, role, password, must_change_password = true } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, and role are required' });
  }

  const existing = await pool.query('SELECT id FROM staff WHERE email=$1', [email]);
  if (existing.rows[0]) return res.status(409).json({ error: 'Email already in use' });

  const hash = await bcrypt.hash(password, 10);
  // Generate a sequential employee_id
  const empIdResult = await pool.query(
    `SELECT 'EMP' || LPAD((COALESCE(MAX(id), 0) + 1)::text, 4, '0') as emp_id FROM staff`
  );
  const empId = empIdResult.rows[0].emp_id;

  const { rows } = await pool.query(
    `INSERT INTO staff (employee_id, first_name, last_name, email, role, password_hash, status, hire_date, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', CURRENT_DATE, $7)
     RETURNING id, employee_id, first_name, last_name, email, role, status, must_change_password`,
    [empId, first_name || '', last_name || '', email, role, hash, must_change_password]
  );
  res.json(rows[0]);
});

// PUT /api/auth/users/:id
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const { role, status, password } = req.body;
  const setClauses = [];
  const vals = [];

  if (role) {
    setClauses.push(`role=$${vals.length + 1}`);
    vals.push(role);
  }
  if (status) {
    setClauses.push(`status=$${vals.length + 1}`);
    vals.push(status);
  }
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    setClauses.push(`password_hash=$${vals.length + 1}`);
    vals.push(hash);
    setClauses.push(`must_change_password=TRUE`);
    setClauses.push(`failed_login_attempts=0`);
    setClauses.push(`locked_until=NULL`);
  }

  if (!setClauses.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE staff SET ${setClauses.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}
     RETURNING id, first_name, last_name, email, role, status, must_change_password`,
    vals
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

module.exports = router;
