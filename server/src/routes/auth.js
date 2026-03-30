const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db/pool');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { sendPasswordResetEmail, sendInvitationEmail, sendTestEmail } = require('../services/emailService');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const { rows } = await pool.query(
    'SELECT * FROM staff WHERE email = $1',
    [email]
  );
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'EMAIL_NOT_FOUND' });

  // Block non-active accounts before checking password
  if (user.status !== 'active') {
    return res.status(401).json({ error: 'ACCOUNT_INACTIVE' });
  }

  // Lockout check
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    req.user = { id: user.id, name: `${user.first_name} ${user.last_name}`, role: user.role };
    logAudit(req, { action_type: 'ACCOUNT_LOCKED', entity_type: 'staff', entity_id: user.id, entity_description: `Locked login attempt: ${email}` });
    return res.status(423).json({ error: 'ACCOUNT_LOCKED', minutesLeft });
  }

  const MAX_ATTEMPTS = 5;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const attempts = (user.failed_login_attempts || 0) + 1;
    const lockUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + 30 * 60 * 1000) : null;
    await pool.query(
      'UPDATE staff SET failed_login_attempts=$1, locked_until=$2 WHERE id=$3',
      [attempts, lockUntil, user.id]
    );
    req.user = { id: user.id, name: `${user.first_name} ${user.last_name}`, role: user.role };
    logAudit(req, { action_type: 'FAILED_LOGIN', entity_type: 'staff', entity_id: user.id, entity_description: `Failed login attempt ${attempts} for ${email}` });
    if (attempts >= MAX_ATTEMPTS) {
      return res.status(423).json({ error: 'ACCOUNT_LOCKED', minutesLeft: 30 });
    }
    return res.status(401).json({ error: 'WRONG_PASSWORD', attemptsLeft: MAX_ATTEMPTS - attempts });
  }

  // Success: reset attempts, record last_login
  await pool.query(
    'UPDATE staff SET failed_login_attempts=0, locked_until=NULL, last_login=NOW() WHERE id=$1',
    [user.id]
  );
  req.user = { id: user.id, name: `${user.first_name} ${user.last_name}`, role: user.role };
  logAudit(req, { action_type: 'LOGIN', entity_type: 'staff', entity_id: user.id, entity_description: `${user.first_name} ${user.last_name} logged in` });

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
  logAudit(req, { action_type: 'CHANGE_PASSWORD', entity_type: 'staff', entity_id: req.user.id, entity_description: `Password changed by ${req.user.name}` });
  res.json({ message: 'Password updated' });
});

// ─── Forgot Password / Reset / Invitation ──────────────────────────────────

// POST /api/auth/forgot-password (PUBLIC)
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Always return success to prevent email enumeration
  try {
    const { rows } = await pool.query('SELECT id, first_name FROM staff WHERE email = $1 AND status = $2', [email.toLowerCase().trim(), 'active']);
    if (rows[0]) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await pool.query(
        'UPDATE staff SET reset_token=$1, reset_token_expiry=$2 WHERE id=$3',
        [token, expiry, rows[0].id]
      );
      await sendPasswordResetEmail({ ...rows[0], email }, token);
    }
  } catch (err) {
    console.error('[forgot-password]', err.message);
  }

  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

// POST /api/auth/reset-password (PUBLIC)
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'token and newPassword required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const { rows } = await pool.query(
    'SELECT id FROM staff WHERE reset_token = $1 AND reset_token_expiry > NOW()',
    [token]
  );
  if (!rows[0]) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    'UPDATE staff SET password_hash=$1, reset_token=NULL, reset_token_expiry=NULL, must_change_password=FALSE, failed_login_attempts=0, locked_until=NULL WHERE id=$2',
    [hash, rows[0].id]
  );

  res.json({ message: 'Password reset successful. You can now log in.' });
});

// GET /api/auth/verify-invitation/:token (PUBLIC) — validate before showing form
router.get('/verify-invitation/:token', async (req, res) => {
  const { token } = req.params;
  const { rows } = await pool.query(
    'SELECT first_name, email FROM staff WHERE invitation_token = $1 AND invitation_token_expiry > NOW()',
    [token]
  );
  if (!rows[0]) return res.json({ valid: false });
  res.json({ valid: true, firstName: rows[0].first_name, email: rows[0].email });
});

// POST /api/auth/accept-invitation (PUBLIC) — set password, auto-login
router.post('/accept-invitation', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'token and newPassword required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const { rows } = await pool.query(
    'SELECT id, employee_id, first_name, last_name, email, role, status FROM staff WHERE invitation_token = $1 AND invitation_token_expiry > NOW()',
    [token]
  );
  if (!rows[0]) return res.status(400).json({ error: 'This invitation link has expired. Contact your manager.' });

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    'UPDATE staff SET password_hash=$1, invitation_token=NULL, invitation_token_expiry=NULL, must_change_password=FALSE WHERE id=$2',
    [hash, rows[0].id]
  );

  const user = rows[0];
  const jwtToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token: jwtToken,
    user: {
      id: user.id,
      employeeId: user.employee_id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role,
      status: user.status,
      mustChangePassword: false,
    }
  });
});

// ─── User Management (admin only) ──────────────────────────────────────────

// GET /api/auth/users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, employee_id, first_name, last_name, email, role, status, last_login, must_change_password, invitation_sent_at
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
  logAudit(req, { action_type: 'CREATE_USER', entity_type: 'staff', entity_id: rows[0].id, entity_description: `Created user ${email} with role ${role}`, new_value: { email, role } });
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
  logAudit(req, { action_type: 'UPDATE_USER', entity_type: 'staff', entity_id: rows[0].id, entity_description: `Updated user ${rows[0].email}`, new_value: { role: rows[0].role, status: rows[0].status, password_reset: !!password } });
  res.json(rows[0]);
});

// POST /api/auth/test-email (adminOnly) — SMTP diagnostic
router.post('/test-email', authMiddleware, adminOnly, async (req, res) => {
  const toEmail = req.body?.to || req.user.email;
  console.log(`[test-email] Sending test email to ${toEmail}...`);
  const result = await sendTestEmail(toEmail);
  res.status(result.ok ? 200 : 500).json(result);
});

// POST /api/auth/test-invitation (adminOnly) — send a real invitation email for diagnostics
router.post('/test-invitation', authMiddleware, adminOnly, async (req, res) => {
  const toEmail = req.body?.to || 'ericdiaz.lsmd@gmail.com';
  console.log(`[test-invitation] Sending test invitation to ${toEmail}...`);
  const token = crypto.randomBytes(32).toString('hex');
  const fakeStaff = { first_name: 'Test', last_name: 'Driver', email: toEmail, invitation_token: token };
  const emailSent = await sendInvitationEmail(fakeStaff);
  const inviteUrl = `${process.env.APP_URL || ''}/accept-invitation/${token}`;
  console.log(`[test-invitation] emailSent=${emailSent}, inviteUrl=${inviteUrl}`);
  res.json({ emailSent, inviteUrl, to: toEmail });
});

// POST /api/auth/send-invitations (adminOnly) — bulk send
router.post('/send-invitations', authMiddleware, adminOnly, async (req, res) => {
  const { staffIds } = req.body;
  if (!Array.isArray(staffIds) || staffIds.length === 0) {
    return res.status(400).json({ error: 'staffIds array required' });
  }
  const results = [];
  for (const id of staffIds) {
    try {
      const { rows } = await pool.query(
        'SELECT id, first_name, last_name, email, role FROM staff WHERE id=$1 AND status != $2',
        [id, 'terminated']
      );
      if (!rows[0]) { results.push({ id, success: false, error: 'Not found' }); continue; }
      const staff = rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await pool.query(
        'UPDATE staff SET invitation_token=$1, invitation_token_expiry=$2, invitation_sent_at=NOW() WHERE id=$3',
        [token, expiry, id]
      );
      const inviteUrl = `${process.env.APP_URL || ''}/accept-invitation/${token}`;
      const emailSent = await sendInvitationEmail({ ...staff, invitation_token: token });
      if (emailSent) {
        results.push({ id, success: true, name: `${staff.first_name} ${staff.last_name}` });
      } else {
        results.push({ id, success: false, error: 'SMTP not configured — link saved but email not sent', inviteUrl, name: `${staff.first_name} ${staff.last_name}` });
      }
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }
  const sent = results.filter(r => r.success).length;
  logAudit(req, { action_type: 'SEND_INVITATIONS', entity_type: 'staff', entity_description: `Sent invitations to ${sent} driver(s)` });
  res.json({ results });
});

// POST /api/auth/resend-invitation/:staffId (adminOnly) — single resend
router.post('/resend-invitation/:staffId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { rows } = await pool.query(
      'SELECT id, first_name, last_name, email, role FROM staff WHERE id=$1 AND status != $2',
      [staffId, 'terminated']
    );
    if (!rows[0]) return res.status(404).json({ error: 'Driver not found' });
    const staff = rows[0];
    // Always generate a fresh token and reset expiry
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    // Reset token, expiry, password hash, and must_change_password so the invite flow works fresh
    await pool.query(
      `UPDATE staff
         SET invitation_token=$1, invitation_token_expiry=$2, invitation_sent_at=NOW(),
             password_hash=NULL, must_change_password=TRUE
       WHERE id=$3`,
      [token, expiry, staffId]
    );
    const inviteUrl = `${process.env.APP_URL || ''}/accept-invitation/${token}`;
    const emailSent = await sendInvitationEmail({ ...staff, invitation_token: token });
    logAudit(req, { action_type: 'RESEND_INVITATION', entity_type: 'staff', entity_id: parseInt(staffId), entity_description: `Resent invitation to ${staff.first_name} ${staff.last_name}` });
    res.json({ success: true, name: `${staff.first_name} ${staff.last_name}`, inviteUrl, emailSent });
  } catch (err) {
    console.error('[resend-invitation] Error:', err.message);
    res.status(500).json({ error: 'Failed to resend invitation. Please try again.' });
  }
});

module.exports = router;
