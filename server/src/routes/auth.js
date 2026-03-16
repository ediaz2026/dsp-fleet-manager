const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { rows } = await pool.query(
    'SELECT * FROM staff WHERE email = $1 AND status != $2',
    [email, 'terminated']
  );
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      employeeId: user.employee_id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      status: user.status,
    }
  });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, employee_id, first_name, last_name, email, role, status, hire_date FROM staff WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const { rows } = await pool.query('SELECT password_hash FROM staff WHERE id = $1', [req.user.id]);
  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE staff SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'Password updated' });
});

module.exports = router;
