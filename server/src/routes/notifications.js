const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

router.use(authMiddleware);

// ── GET /api/notifications ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, message, type, is_read, created_at
       FROM notifications
       WHERE staff_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    const unread = rows.filter(n => !n.is_read).length;
    res.json({ notifications: rows, unread });
  } catch (err) {
    console.error('GET /notifications error:', err.message);
    res.json({ notifications: [], unread: 0 });
  }
});

// ── PUT /api/notifications/read-all ───────────────────────────────────────
router.put('/read-all', async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE staff_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /notifications/read-all error:', err.message);
    res.json({ ok: false });
  }
});

// ── PUT /api/notifications/:id/read ───────────────────────────────────────
router.put('/:id/read', async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND staff_id = $2`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /notifications/:id/read error:', err.message);
    res.json({ ok: false });
  }
});

module.exports = router;
