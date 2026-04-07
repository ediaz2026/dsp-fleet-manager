const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware, managerOnly);

function getEasternDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().split('T')[0];
}

// GET /api/payroll/records
router.get('/records', async (req, res) => {
  const { pay_period_start, pay_period_end } = req.query;
  let q = `
    SELECT pr.*, s.first_name, s.last_name, s.employee_id,
           pr.actual_hours - pr.scheduled_hours as hours_variance
    FROM payroll_records pr
    JOIN staff s ON s.id = pr.staff_id
    WHERE 1=1`;
  const params = [];
  if (pay_period_start) { params.push(pay_period_start); q += ` AND pr.pay_period_start >= $${params.length}`; }
  if (pay_period_end) { params.push(pay_period_end); q += ` AND pr.pay_period_end <= $${params.length}`; }
  q += ' ORDER BY s.last_name, pr.pay_period_start DESC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// GET /api/payroll/summary
router.get('/summary', async (req, res) => {
  const { start, end } = req.query;
  const { rows } = await pool.query(
    `SELECT s.employee_id, s.first_name, s.last_name,
       COALESCE(SUM(a.hours_worked), 0) as actual_hours,
       COUNT(sh.id) * 9.5 as scheduled_hours,
       COUNT(a.id) FILTER (WHERE a.status='present') as days_present,
       COUNT(a.id) FILTER (WHERE a.status='ncns') as ncns_count,
       COUNT(a.id) FILTER (WHERE a.status='called_out') as callout_count
     FROM staff s
     LEFT JOIN shifts sh ON sh.staff_id = s.id AND sh.shift_date BETWEEN $1 AND $2
     LEFT JOIN attendance a ON a.staff_id = s.id AND a.attendance_date BETWEEN $1 AND $2
     WHERE s.role = 'driver' AND s.status = 'active'
     GROUP BY s.id, s.employee_id, s.first_name, s.last_name
     ORDER BY s.last_name`,
    [start || (() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().split('T')[0]; })(),
     end || getEasternDate()]
  );
  res.json(rows);
});

// POST /api/payroll/sync/:provider - simulate Paycom/ADP sync
router.post('/sync/:provider', async (req, res) => {
  const { provider } = req.params;
  const { pay_period_start, pay_period_end } = req.body;

  if (!['paycom', 'adp'].includes(provider)) {
    return res.status(400).json({ error: 'Provider must be paycom or adp' });
  }

  // Check if provider is configured
  const cfg = await pool.query(
    `SELECT setting_value FROM settings WHERE setting_key = $1`,
    [`${provider}_enabled`]
  );
  if (!cfg.rows[0] || cfg.rows[0].setting_value !== 'true') {
    return res.status(400).json({ error: `${provider.toUpperCase()} integration is not enabled in Settings` });
  }

  // Simulate API call - in production, replace with actual Paycom/ADP API calls
  const drivers = await pool.query(
    `SELECT id, employee_id FROM staff WHERE role='driver' AND status='active'`
  );

  let synced = 0;
  for (const d of drivers.rows) {
    // Simulate fetching hours from payroll provider
    const hours = 80 + Math.random() * 20;
    const overtime = Math.max(0, hours - 80);

    await pool.query(
      `INSERT INTO payroll_records (staff_id, pay_period_start, pay_period_end, actual_hours, overtime_hours, source, sync_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),'synced')
       ON CONFLICT (staff_id, pay_period_start, pay_period_end) DO UPDATE
       SET actual_hours=$4, overtime_hours=$5, source=$6, sync_date=NOW(), status='synced'`,
      [d.id, pay_period_start, pay_period_end, hours.toFixed(2), overtime.toFixed(2), provider]
    );
    synced++;
  }

  res.json({ message: `Synced ${synced} records from ${provider.toUpperCase()}`, synced });
});

// POST /api/payroll/manual - manual entry
router.post('/manual', async (req, res) => {
  const { staff_id, pay_period_start, pay_period_end, actual_hours, overtime_hours = 0 } = req.body;

  // Calculate scheduled hours from shifts
  const { rows: shiftRows } = await pool.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time))/3600), 0) as scheduled
     FROM shifts WHERE staff_id=$1 AND shift_date BETWEEN $2 AND $3`,
    [staff_id, pay_period_start, pay_period_end]
  );

  const { rows } = await pool.query(
    `INSERT INTO payroll_records (staff_id, pay_period_start, pay_period_end, scheduled_hours, actual_hours, overtime_hours, source, status)
     VALUES ($1,$2,$3,$4,$5,$6,'manual','synced')
     ON CONFLICT (staff_id, pay_period_start, pay_period_end) DO UPDATE
     SET actual_hours=$5, overtime_hours=$6, source='manual', status='synced'
     RETURNING *`,
    [staff_id, pay_period_start, pay_period_end, shiftRows[0].scheduled, actual_hours, overtime_hours]
  );
  res.status(201).json(rows[0]);
});

// Add unique constraint if missing
pool.query(`
  DO $$ BEGIN
    ALTER TABLE payroll_records ADD CONSTRAINT payroll_staff_period_unique UNIQUE (staff_id, pay_period_start, pay_period_end);
  EXCEPTION WHEN others THEN NULL;
  END $$;
`).catch(() => {});

module.exports = router;
