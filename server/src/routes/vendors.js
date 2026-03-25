const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/vendors
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM vendors ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vendors
router.post('/', managerOnly, async (req, res) => {
  try {
    const { name, vendor_type = 'other', phone, email, address, notes, status = 'active' } = req.body;
    if (!name) return res.status(400).json({ error: 'Vendor name is required' });
    const { rows } = await pool.query(
      `INSERT INTO vendors (name, vendor_type, phone, email, address, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, vendor_type, phone || null, email || null, address || null, notes || null, status]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/vendors/:id
router.put('/:id', managerOnly, async (req, res) => {
  try {
    const { name, vendor_type, phone, email, address, notes, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Vendor name is required' });
    const { rows } = await pool.query(
      `UPDATE vendors SET name=$1, vendor_type=$2, phone=$3, email=$4, address=$5, notes=$6, status=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [name, vendor_type || 'other', phone || null, email || null, address || null, notes || null, status || 'active', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Vendor not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/vendors/:id
router.delete('/:id', managerOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM vendors WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
