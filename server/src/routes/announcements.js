const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware);

// Ensure table exists
pool.query(`
  CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    created_by INT REFERENCES staff(id),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
  )
`).catch(e => console.error('[announcements] Table creation error:', e.message));

// GET /api/announcements — active announcements (all authenticated users)
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, s.first_name AS author_first, s.last_name AS author_last
     FROM announcements a
     LEFT JOIN staff s ON s.id = a.created_by
     WHERE a.active = true AND (a.expires_at IS NULL OR a.expires_at > NOW())
     ORDER BY a.created_at DESC`
  );
  res.json(rows);
});

// POST /api/announcements — create (admin only)
router.post('/', adminOnly, async (req, res) => {
  const { message, expires_at } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const { rows } = await pool.query(
    `INSERT INTO announcements (message, created_by, expires_at) VALUES ($1, $2, $3) RETURNING *`,
    [message.trim(), req.user.id, expires_at || null]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/announcements/:id — update (admin only)
router.put('/:id', adminOnly, async (req, res) => {
  const { message, active, expires_at } = req.body;
  const sets = []; const vals = [];
  if (message !== undefined) { vals.push(message); sets.push(`message=$${vals.length}`); }
  if (active !== undefined) { vals.push(active); sets.push(`active=$${vals.length}`); }
  if (expires_at !== undefined) { vals.push(expires_at || null); sets.push(`expires_at=$${vals.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.params.id);
  const { rows } = await pool.query(`UPDATE announcements SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING *`, vals);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /api/announcements/:id — delete (admin only)
router.delete('/:id', adminOnly, async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

module.exports = router;
