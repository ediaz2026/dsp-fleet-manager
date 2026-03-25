const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const { checkAndApplyConsequences } = require('../services/consequences');

router.use(authMiddleware);

// GET /api/attendance?date=YYYY-MM-DD&start=&end=&staff_id=
router.get('/', async (req, res) => {
  const { date, start, end, staff_id } = req.query;
  let q = `
    SELECT a.*, st.first_name, st.last_name, st.employee_id
    FROM attendance a
    JOIN staff st ON st.id = a.staff_id
    WHERE 1=1`;
  const params = [];
  if (date) { params.push(date); q += ` AND a.attendance_date = $${params.length}`; }
  if (start && end) { params.push(start, end); q += ` AND a.attendance_date BETWEEN $${params.length-1} AND $${params.length}`; }
  if (req.user.role === 'driver') {
    // Drivers always see only their own attendance
    params.push(req.user.id);
    q += ` AND a.staff_id = $${params.length}`;
  } else if (staff_id) {
    params.push(staff_id);
    q += ` AND a.staff_id = $${params.length}`;
  }
  q += ' ORDER BY a.attendance_date DESC, st.last_name';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// GET /api/attendance/today
router.get('/today', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, st.first_name, st.last_name, st.employee_id, st.role
     FROM attendance a
     JOIN staff st ON st.id = a.staff_id
     WHERE a.attendance_date = CURRENT_DATE
     ORDER BY st.last_name`
  );
  res.json(rows);
});

// POST /api/attendance - record/update attendance
router.post('/', managerOnly, async (req, res) => {
  const { staff_id, shift_id, attendance_date, status, call_out_reason, late_minutes = 0, notes } = req.body;

  // Upsert attendance record
  const { rows } = await pool.query(
    `INSERT INTO attendance (staff_id, shift_id, attendance_date, status, call_out_reason, late_minutes, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (staff_id, attendance_date)
     DO UPDATE SET status=$4, call_out_reason=$5, late_minutes=$6, notes=$7, created_by=$8, created_at=NOW()
     RETURNING *`,
    [staff_id, shift_id, attendance_date, status, call_out_reason, late_minutes, notes, req.user.id]
  );

  // Check consequences for NCNS, called_out, late
  let consequences = [];
  if (['ncns', 'called_out', 'late'].includes(status)) {
    consequences = await checkAndApplyConsequences(staff_id, status);
  }

  res.status(201).json({ attendance: rows[0], consequences });
});

// PUT /api/attendance/:id
router.put('/:id', managerOnly, async (req, res) => {
  const { status, call_out_reason, late_minutes, clock_in, clock_out, notes } = req.body;
  let hours = null;
  if (clock_in && clock_out) {
    hours = (new Date(clock_out) - new Date(clock_in)) / 3600000;
  }
  const { rows } = await pool.query(
    `UPDATE attendance SET status=$1, call_out_reason=$2, late_minutes=$3,
     clock_in=$4, clock_out=$5, hours_worked=$6, notes=$7 WHERE id=$8 RETURNING *`,
    [status, call_out_reason, late_minutes, clock_in, clock_out, hours, notes, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  let consequences = [];
  if (['ncns', 'called_out', 'late'].includes(status)) {
    consequences = await checkAndApplyConsequences(rows[0].staff_id, status);
  }
  res.json({ attendance: rows[0], consequences });
});

// POST /api/attendance/clock-in/:staffId
router.post('/clock-in/:staffId', async (req, res) => {
  const staffId = req.params.staffId;
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // Find today's shift
  const shift = await pool.query(
    `SELECT id, start_time FROM shifts WHERE staff_id = $1 AND shift_date = $2`,
    [staffId, today]
  );

  let lateMinutes = 0;
  let status = 'present';
  if (shift.rows[0]) {
    const [h, m] = shift.rows[0].start_time.split(':').map(Number);
    const scheduled = new Date(now);
    scheduled.setHours(h, m, 0, 0);
    lateMinutes = Math.max(0, Math.round((now - scheduled) / 60000));
    if (lateMinutes >= 10) status = 'late';
  }

  const { rows } = await pool.query(
    `INSERT INTO attendance (staff_id, shift_id, attendance_date, clock_in, status, late_minutes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (staff_id, attendance_date)
     DO UPDATE SET clock_in=$4, status=$5, late_minutes=$6 RETURNING *`,
    [staffId, shift.rows[0]?.id || null, today, now, status, lateMinutes]
  );
  res.json(rows[0]);
});

// POST /api/attendance/clock-out/:staffId
router.post('/clock-out/:staffId', async (req, res) => {
  const staffId = req.params.staffId;
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  const { rows } = await pool.query(
    `UPDATE attendance SET clock_out = $1,
     hours_worked = ROUND(EXTRACT(EPOCH FROM ($1 - clock_in)) / 3600, 2)
     WHERE staff_id = $2 AND attendance_date = $3 RETURNING *`,
    [now, staffId, today]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No clock-in found' });
  res.json(rows[0]);
});

// GET /api/attendance/metrics/:staffId
router.get('/metrics/:staffId', async (req, res) => {
  const { days = 90 } = req.query;
  const { rows } = await pool.query(
    `SELECT
       attendance_date,
       status,
       clock_in,
       clock_out,
       hours_worked,
       late_minutes
     FROM attendance
     WHERE staff_id = $1 AND attendance_date >= CURRENT_DATE - $2
     ORDER BY attendance_date DESC`,
    [req.params.staffId, parseInt(days)]
  );
  res.json(rows);
});

// GET /api/attendance/export?start=&end=
router.get('/export', managerOnly, async (req, res) => {
  const { start, end } = req.query;
  const { rows } = await pool.query(
    `SELECT st.employee_id, st.first_name, st.last_name,
       COUNT(*) FILTER (WHERE a.status='present') as present,
       COUNT(*) FILTER (WHERE a.status='called_out') as called_out,
       COUNT(*) FILTER (WHERE a.status='ncns') as ncns,
       COUNT(*) FILTER (WHERE a.status='late') as late,
       COALESCE(SUM(a.hours_worked), 0) as total_hours
     FROM staff st
     LEFT JOIN attendance a ON a.staff_id = st.id AND a.attendance_date BETWEEN $1 AND $2
     WHERE st.role = 'driver'
     GROUP BY st.id, st.employee_id, st.first_name, st.last_name
     ORDER BY st.last_name`,
    [start || '2024-01-01', end || new Date().toISOString().split('T')[0]]
  );
  res.json(rows);
});

// Add unique constraint if missing (idempotent helper)
pool.query(`
  DO $$ BEGIN
    ALTER TABLE attendance ADD CONSTRAINT attendance_staff_date_unique UNIQUE (staff_id, attendance_date);
  EXCEPTION WHEN duplicate_table THEN NULL;
  WHEN others THEN NULL;
  END $$;
`).catch(() => {});

module.exports = router;
