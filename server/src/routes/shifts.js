const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getVisibilityDays() {
  try {
    const { rows } = await pool.query(
      "SELECT setting_value FROM settings WHERE setting_key = 'schedule_visibility_days'"
    );
    const val = parseInt(rows[0] && rows[0].setting_value ? rows[0].setting_value : '14');
    return isNaN(val) ? 14 : val;
  } catch(e) {
    return 14;
  }
}

function getWeekStart(dateStr) {
  const d = new Date((String(dateStr)).slice(0, 10) + 'T12:00:00Z');
  const diff = d.getUTCDate() - d.getUTCDay();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)).toISOString().split('T')[0];
}

function buildChangeDesc(oldShift, newVals) {
  const oldType = oldShift.shift_type || '';
  const newType = newVals.shift_type || oldType;
  const newStart = (newVals.start_time || oldShift.start_time || '').slice(0, 5);
  const newEnd   = (newVals.end_time   || oldShift.end_time   || '').slice(0, 5);
  if (newType !== oldType) return `${oldType} → ${newType}`;
  return `${newType} ${newStart}–${newEnd} (time changed)`;
}

// ── GET /api/shifts?start=YYYY-MM-DD&end=YYYY-MM-DD ──────────────────────────
router.get('/', async (req, res) => {
  const { start, end, staff_id } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const startDate = start || today;
  let endDate = end || today;

  const isDriver = req.user && req.user.role === 'driver';

  if (isDriver) {
    const days = await getVisibilityDays();
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + days);
    const maxDateStr = maxDate.toISOString().split('T')[0];
    if (endDate > maxDateStr) endDate = maxDateStr;
  }

  let q = `
    SELECT s.*, st.first_name, st.last_name, st.employee_id, st.role,
           a.status as attendance_status, a.clock_in, a.clock_out, a.hours_worked, a.id as attendance_id
    FROM shifts s
    JOIN staff st ON st.id = s.staff_id
    LEFT JOIN attendance a ON a.shift_id = s.id
    WHERE s.shift_date BETWEEN $1 AND $2`;
  const params = [startDate, endDate];

  if (isDriver) q += " AND s.publish_status = 'published'";

  if (staff_id) { params.push(staff_id); q += ' AND s.staff_id = $' + params.length; }
  q += ' ORDER BY s.shift_date, s.start_time, st.last_name';
  const { rows } = await pool.query(q, params);
  res.json(rows);
});

// ── GET /api/shifts/today ─────────────────────────────────────────────────────
router.get('/today', async (req, res) => {
  const isDriver = req.user && req.user.role === 'driver';
  let q = `
    SELECT s.*, st.first_name, st.last_name, st.employee_id, st.role,
            a.status as attendance_status, a.clock_in, a.clock_out, a.hours_worked
     FROM shifts s
     JOIN staff st ON st.id = s.staff_id
     LEFT JOIN attendance a ON a.shift_id = s.id
     WHERE s.shift_date = CURRENT_DATE`;
  if (isDriver) q += " AND s.publish_status = 'published'";
  q += ' ORDER BY s.start_time, st.last_name';
  const { rows } = await pool.query(q);
  res.json(rows);
});

// ── GET /api/shifts/week-status?week_start=YYYY-MM-DD ────────────────────────
router.get('/week-status', async (req, res) => {
  const { week_start } = req.query;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });

  const weekEnd = new Date(week_start + 'T12:00:00Z');
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE publish_status = 'published') AS published,
       COUNT(*) FILTER (WHERE publish_status = 'draft' OR publish_status IS NULL) AS draft,
       COUNT(*) AS total
     FROM shifts
     WHERE shift_date BETWEEN $1 AND $2`,
    [week_start, weekEndStr]
  );
  const r = rows[0];
  const pub = parseInt(r.published);
  const dft = parseInt(r.draft);
  const tot = parseInt(r.total);
  const status = tot === 0 ? 'empty' : dft === 0 ? 'published' : pub === 0 ? 'draft' : 'partial';
  res.json({ published: pub, draft: dft, total: tot, status: status });
});

// ── GET /api/shifts/change-log?week_start=YYYY-MM-DD ─────────────────────────
router.get('/change-log', managerOnly, async (req, res) => {
  const { week_start } = req.query;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });
  const { rows } = await pool.query(
    `SELECT * FROM shift_change_log
     WHERE week_start = $1 AND publish_status = 'draft'
     ORDER BY created_at DESC`,
    [week_start]
  );
  res.json(rows);
});

// ── POST /api/shifts/publish-week ─────────────────────────────────────────────
router.post('/publish-week', managerOnly, async (req, res) => {
  const { week_start, days } = req.body;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });

  const weekEnd = new Date(week_start + 'T12:00:00Z');
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  let q, params;
  if (days && days.length > 0) {
    q = "UPDATE shifts SET publish_status='published' WHERE shift_date = ANY($1::date[]) RETURNING id";
    params = [days];
  } else {
    q = "UPDATE shifts SET publish_status='published' WHERE shift_date BETWEEN $1 AND $2 RETURNING id";
    params = [week_start, weekEndStr];
  }

  const { rows } = await pool.query(q, params);

  // Mark all change log entries for this week as published
  await pool.query(
    `UPDATE shift_change_log SET publish_status='published'
     WHERE week_start = $1 AND publish_status = 'draft'`,
    [week_start]
  );

  res.json({ published: rows.length });
});

// ── POST /api/shifts/unpublish-week ───────────────────────────────────────────
router.post('/unpublish-week', managerOnly, async (req, res) => {
  const { week_start, days } = req.body;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });

  const weekEnd = new Date(week_start + 'T12:00:00Z');
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  let q, params;
  if (days && days.length > 0) {
    q = "UPDATE shifts SET publish_status='draft' WHERE shift_date = ANY($1::date[]) RETURNING id";
    params = [days];
  } else {
    q = "UPDATE shifts SET publish_status='draft' WHERE shift_date BETWEEN $1 AND $2 RETURNING id";
    params = [week_start, weekEndStr];
  }

  const { rows } = await pool.query(q, params);
  res.json({ unpublished: rows.length });
});

// ── POST /api/shifts/publish-selected ────────────────────────────────────────
router.post('/publish-selected', managerOnly, async (req, res) => {
  const { shift_ids } = req.body;
  if (!Array.isArray(shift_ids) || shift_ids.length === 0) {
    return res.status(400).json({ error: 'shift_ids array required' });
  }
  const { rows } = await pool.query(
    `UPDATE shifts SET publish_status='published' WHERE id = ANY($1::int[]) RETURNING id`,
    [shift_ids]
  );
  await pool.query(
    `UPDATE shift_change_log SET publish_status='published'
     WHERE shift_id = ANY($1::int[]) AND publish_status = 'draft'`,
    [shift_ids]
  );
  res.json({ published: rows.length });
});

// ── POST /api/shifts ──────────────────────────────────────────────────────────
router.post('/', managerOnly, async (req, res) => {
  const { staff_id, shift_date, start_time, end_time, shift_type, notes } = req.body;
  const type = shift_type || 'regular';
  const { rows } = await pool.query(
    "INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, publish_status, notes) VALUES ($1,$2,$3,$4,$5,'scheduled','draft',$6) RETURNING *",
    [staff_id, shift_date, start_time, end_time, type, notes]
  );
  const shift = rows[0];

  // Log creation
  try {
    const staffRow = await pool.query('SELECT first_name, last_name FROM staff WHERE id=$1', [staff_id]);
    const staffName = staffRow.rows[0]
      ? `${staffRow.rows[0].first_name} ${staffRow.rows[0].last_name}`
      : '';
    const s = (start_time || '').slice(0, 5);
    const e = (end_time   || '').slice(0, 5);
    await pool.query(
      `INSERT INTO shift_change_log
         (shift_id, staff_id, staff_name, changed_by_id, changed_by_name,
          change_type, description, new_value, shift_date, week_start)
       VALUES ($1,$2,$3,$4,$5,'create',$6,$7,$8,$9)`,
      [
        shift.id, staff_id, staffName,
        req.user.id, req.user.name,
        `${type} ${s}–${e} (New shift)`,
        JSON.stringify({ shift_type: type, start_time, end_time }),
        shift_date, getWeekStart(shift_date),
      ]
    );
  } catch (logErr) {
    console.error('Change log insert failed (non-fatal):', logErr.message);
  }

  res.status(201).json(shift);
});

// ── PUT /api/shifts/:id ───────────────────────────────────────────────────────
router.put('/:id', managerOnly, async (req, res) => {
  const { start_time, end_time, shift_type, status, notes, publish_status } = req.body;

  // Fetch current shift + staff name for comparison / logging
  const { rows: cur } = await pool.query(
    `SELECT s.*, st.first_name, st.last_name
     FROM shifts s JOIN staff st ON st.id = s.staff_id
     WHERE s.id = $1`,
    [req.params.id]
  );
  const old = cur[0];
  if (!old) return res.status(404).json({ error: 'Shift not found' });

  const oldType  = old.shift_type || '';
  const oldStart = (old.start_time || '').slice(0, 5);
  const oldEnd   = (old.end_time   || '').slice(0, 5);

  const coreChanged =
    (shift_type  != null && shift_type  !== oldType)  ||
    (start_time  != null && start_time  !== oldStart) ||
    (end_time    != null && end_time    !== oldEnd);

  // If core fields changed, force back to draft (edit = needs re-publishing)
  const resolvedPublishStatus = coreChanged ? 'draft' : (publish_status || null);

  const { rows } = await pool.query(
    `UPDATE shifts
     SET start_time=$1, end_time=$2, shift_type=$3, status=$4, notes=$5,
         publish_status=COALESCE($6, publish_status)
     WHERE id=$7 RETURNING *`,
    [start_time, end_time, shift_type, status, notes, resolvedPublishStatus, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Shift not found' });

  // Log if core fields changed
  if (coreChanged) {
    try {
      const shiftDateStr = old.shift_date
        ? (old.shift_date instanceof Date
            ? old.shift_date.toISOString().split('T')[0]
            : String(old.shift_date).slice(0, 10))
        : null;

      await pool.query(
        `INSERT INTO shift_change_log
           (shift_id, staff_id, staff_name, changed_by_id, changed_by_name,
            change_type, description, previous_value, new_value, shift_date, week_start)
         VALUES ($1,$2,$3,$4,$5,'update',$6,$7,$8,$9,$10)`,
        [
          old.id,
          old.staff_id,
          `${old.first_name} ${old.last_name}`,
          req.user.id,
          req.user.name,
          buildChangeDesc(old, { shift_type, start_time, end_time }),
          JSON.stringify({ shift_type: oldType, start_time: oldStart, end_time: oldEnd }),
          JSON.stringify({ shift_type: shift_type || oldType, start_time: start_time || oldStart, end_time: end_time || oldEnd }),
          shiftDateStr,
          shiftDateStr ? getWeekStart(shiftDateStr) : null,
        ]
      );
    } catch (logErr) {
      console.error('Change log update failed (non-fatal):', logErr.message);
    }
  }

  res.json(rows[0]);
});

// ── DELETE /api/shifts/:id ────────────────────────────────────────────────────
router.delete('/:id', managerOnly, async (req, res) => {
  await pool.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
  res.json({ message: 'Shift deleted' });
});

// ── POST /api/shifts/bulk-apply ───────────────────────────────────────────────
// Bulk create or update cells: [{ staff_id, shift_date, shift_id? }]
router.post('/bulk-apply', managerOnly, async (req, res) => {
  try {
    const { cells, shift_type, start_time, end_time } = req.body;
    if (!Array.isArray(cells) || cells.length === 0) return res.status(400).json({ error: 'cells required' });
    if (!shift_type) return res.status(400).json({ error: 'shift_type required' });

    let created = 0, updated = 0;

    for (const cell of cells) {
      const { staff_id, shift_date, shift_id } = cell;

      if (shift_id) {
        // Fetch old for logging
        const { rows: cur } = await pool.query(
          `SELECT s.*, st.first_name, st.last_name FROM shifts s JOIN staff st ON st.id=s.staff_id WHERE s.id=$1`,
          [shift_id]
        );
        const old = cur[0];
        if (!old) continue;

        await pool.query(
          `UPDATE shifts SET shift_type=$1, start_time=$2, end_time=$3 WHERE id=$4`,
          [shift_type, start_time, end_time, shift_id]
        );

        // Log bulk edit
        try {
          const shiftDateStr = old.shift_date instanceof Date
            ? old.shift_date.toISOString().split('T')[0]
            : String(old.shift_date).slice(0, 10);
          await pool.query(
            `INSERT INTO shift_change_log
               (shift_id, staff_id, staff_name, changed_by_id, changed_by_name,
                change_type, description, previous_value, new_value, shift_date, week_start)
             VALUES ($1,$2,$3,$4,$5,'bulk_edit',$6,$7,$8,$9,$10)`,
            [
              shift_id, old.staff_id, `${old.first_name} ${old.last_name}`,
              req.user.id, req.user.name,
              `${old.shift_type} → ${shift_type} (Bulk Edit)`,
              JSON.stringify({ shift_type: old.shift_type }),
              JSON.stringify({ shift_type }),
              shiftDateStr, getWeekStart(shiftDateStr),
            ]
          );
        } catch (e) { /* non-fatal */ }
        updated++;
      } else {
        // Create new shift
        const { rows: ins } = await pool.query(
          `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status)
           VALUES ($1,$2,$3,$4,$5,'scheduled') RETURNING *`,
          [staff_id, shift_date, start_time, end_time, shift_type]
        );
        if (ins[0]) {
          try {
            const stRow = await pool.query('SELECT first_name, last_name FROM staff WHERE id=$1', [staff_id]);
            const staffName = stRow.rows[0] ? `${stRow.rows[0].first_name} ${stRow.rows[0].last_name}` : '';
            const s = (start_time || '').slice(0, 5);
            const e = (end_time   || '').slice(0, 5);
            await pool.query(
              `INSERT INTO shift_change_log
                 (shift_id, staff_id, staff_name, changed_by_id, changed_by_name,
                  change_type, description, new_value, shift_date, week_start)
               VALUES ($1,$2,$3,$4,$5,'bulk_edit',$6,$7,$8,$9)`,
              [
                ins[0].id, staff_id, staffName,
                req.user.id, req.user.name,
                `${shift_type} ${s}–${e} (Bulk Add)`,
                JSON.stringify({ shift_type, start_time, end_time }),
                shift_date, getWeekStart(shift_date),
              ]
            );
          } catch (e) { /* non-fatal */ }
          created++;
        }
      }
    }

    res.json({ created, updated });
  } catch (err) {
    console.error('bulk-apply error:', err);
    res.status(500).json({ error: err.message || 'Failed to apply shifts' });
  }
});

// ── POST /api/shifts/bulk-delete ──────────────────────────────────────────────
router.post('/bulk-delete', managerOnly, async (req, res) => {
  try {
    const { shift_ids } = req.body;
    if (!Array.isArray(shift_ids) || shift_ids.length === 0) return res.status(400).json({ error: 'shift_ids required' });
    const intIds = shift_ids.map(Number).filter(n => !isNaN(n));
    if (intIds.length === 0) return res.status(400).json({ error: 'No valid shift IDs' });
    await pool.query('DELETE FROM shifts WHERE id = ANY($1::int[])', [intIds]);
    res.json({ deleted: intIds.length });
  } catch (err) {
    console.error('bulk-delete error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete shifts' });
  }
});

// ── POST /api/shifts/bulk ─────────────────────────────────────────────────────
router.post('/bulk', managerOnly, async (req, res) => {
  const { staff_ids, dates, start_time, end_time, shift_type } = req.body;
  const type = shift_type || 'regular';
  const created = [];
  for (const sid of staff_ids) {
    for (const date of dates) {
      const { rows } = await pool.query(
        "INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, publish_status) VALUES ($1,$2,$3,$4,$5,'scheduled','draft') ON CONFLICT DO NOTHING RETURNING *",
        [sid, date, start_time, end_time, type]
      );
      if (rows[0]) created.push(rows[0]);
    }
  }
  res.status(201).json({ created: created.length, shifts: created });
});

module.exports = router;
