const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/shifts?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/', async (req, res) => {
  const { start, end, staff_id } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const startDate = start || today;
  const endDate = end || today;
  let q = `
    SELECT s.*, st.first_name, st.last_name, st.employee_id, st.role,
           a.status as attendance_status, a.clock_in, a.clock_out, a.hours_worked, a.id as attendance_id
    FROM shifts s
    JOIN staff st ON st.id = s.staff_id
    LEFT JOIN attendance a ON a.shift_id = s.id
    WHERE s.shift_date BETWEEN $1 AND $2`;
  const params = [startDate, endDate];
  if (staff_id) { params.push(staff_id); q += ` AND s.staff_id = $${params.length}`; }
  q += ' ORDER BY s.shift_date, s.start_time, st.last_name';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// GET /api/shifts/today
router.get('/today', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, st.first_name, st.last_name, st.employee_id, st.role,
            a.status as attendance_status, a.clock_in, a.clock_out, a.hours_worked
     FROM shifts s
     JOIN staff st ON st.id = s.staff_id
     LEFT JOIN attendance a ON a.shift_id = s.id
     WHERE s.shift_date = CURRENT_DATE
     ORDER BY s.start_time, st.last_name`
  );
  res.json(rows);
});

// POST /api/shifts
router.post('/', managerOnly, async (req, res) => {
  const { staff_id, shift_date, start_time, end_time, shift_type = 'regular', notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, notes)
     VALUES ($1,$2,$3,$4,$5,'scheduled',$6) RETURNING *`,
    [staff_id, shift_date, start_time, end_time, shift_type, notes]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/shifts/:id
router.put('/:id', managerOnly, async (req, res) => {
  const { start_time, end_time, shift_type, status, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE shifts SET start_time=$1, end_time=$2, shift_type=$3, status=$4, notes=$5 WHERE id=$6 RETURNING *`,
    [start_time, end_time, shift_type, status, notes, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Shift not found' });
  res.json(rows[0]);
});

// DELETE /api/shifts/:id
router.delete('/:id', managerOnly, async (req, res) => {
  await pool.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
  res.json({ message: 'Shift deleted' });
});

// POST /api/shifts/bulk - create shifts for multiple staff on multiple days
router.post('/bulk', managerOnly, async (req, res) => {
  const { staff_ids, dates, start_time, end_time, shift_type = 'regular' } = req.body;
  const created = [];
  for (const sid of staff_ids) {
    for (const date of dates) {
      const { rows } = await pool.query(
        `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status)
         VALUES ($1,$2,$3,$4,$5,'scheduled')
         ON CONFLICT DO NOTHING RETURNING *`,
        [sid, date, start_time, end_time, shift_type]
      );
      if (rows[0]) created.push(rows[0]);
    }
  }
  res.status(201).json({ created: created.length, shifts: created });
});

module.exports = router;
