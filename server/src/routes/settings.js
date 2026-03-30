const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM settings ORDER BY setting_key');
  const obj = {};
  rows.forEach(r => { obj[r.setting_key] = r.setting_value; });
  res.json(obj);
});

router.put('/', managerOnly, async (req, res) => {
  const settings = req.body;
  for (const [key, value] of Object.entries(settings)) {
    await pool.query(
      `INSERT INTO settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value=$2, updated_at=NOW()`,
      [key, String(value)]
    );
  }
  res.json({ message: 'Settings saved' });
});

// Consequence rules
router.get('/consequence-rules', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM consequence_rules ORDER BY violation_type, threshold');
  res.json(rows);
});

router.post('/consequence-rules', managerOnly, async (req, res) => {
  const { rule_name, violation_type, threshold, time_period_days, consequence_action } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO consequence_rules (rule_name, violation_type, threshold, time_period_days, consequence_action)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [rule_name, violation_type, threshold, time_period_days, consequence_action]
  );
  res.status(201).json(rows[0]);
});

router.put('/consequence-rules/:id', managerOnly, async (req, res) => {
  const { rule_name, violation_type, threshold, time_period_days, consequence_action, is_active } = req.body;
  const { rows } = await pool.query(
    `UPDATE consequence_rules SET rule_name=$1, violation_type=$2, threshold=$3, time_period_days=$4,
     consequence_action=$5, is_active=$6 WHERE id=$7 RETURNING *`,
    [rule_name, violation_type, threshold, time_period_days, consequence_action, is_active, req.params.id]
  );
  res.json(rows[0]);
});

router.delete('/consequence-rules/:id', managerOnly, async (req, res) => {
  await pool.query('DELETE FROM consequence_rules WHERE id=$1', [req.params.id]);
  res.json({ message: 'Rule deleted' });
});

module.exports = router;
