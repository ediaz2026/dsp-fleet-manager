const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

router.use(authMiddleware);

// Ensure reject-tracking columns exist (idempotent — safe to run on every startup)
pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS prev_start_time TIME`).catch(() => {});
pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS prev_end_time TIME`).catch(() => {});

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

function getEasternDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().split('T')[0];
}

// ── GET /api/shifts?start=YYYY-MM-DD&end=YYYY-MM-DD ──────────────────────────
router.get('/', async (req, res) => {
  const { start, end, staff_id } = req.query;
  const today = getEasternDate();
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
           a.status as attendance_status, a.clock_in, a.clock_out, a.hours_worked, a.id as attendance_id,
           a.notes as attendance_notes, a.created_at as attendance_marked_at,
           att_st.first_name as attendance_marked_by_first, att_st.last_name as attendance_marked_by_last
    FROM shifts s
    JOIN staff st ON st.id = s.staff_id
    LEFT JOIN attendance a ON a.shift_id = s.id
    LEFT JOIN staff att_st ON att_st.id = a.created_by
    WHERE s.shift_date BETWEEN $1 AND $2
      AND st.status NOT IN ('terminated', 'deleted')`;
  const params = [startDate, endDate];

  if (isDriver) {
    // Drivers always see only their own shifts, regardless of query param
    q += " AND s.publish_status = 'published'";
    params.push(req.user.id);
    q += ' AND s.staff_id = $' + params.length;
  } else if (staff_id) {
    params.push(staff_id);
    q += ' AND s.staff_id = $' + params.length;
  }
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

  // When publishing, promote any pending_* changes to main columns
  const publishSet = `
    publish_status      = 'published',
    was_published       = TRUE,
    prev_shift_type     = NULL,
    prev_start_time     = NULL,
    prev_end_time       = NULL,
    shift_type          = CASE WHEN has_pending_changes AND pending_shift_type IS NOT NULL THEN pending_shift_type ELSE shift_type END,
    start_time          = CASE WHEN has_pending_changes AND pending_start_time IS NOT NULL THEN pending_start_time ELSE start_time END,
    end_time            = CASE WHEN has_pending_changes AND pending_end_time   IS NOT NULL THEN pending_end_time   ELSE end_time   END,
    pending_shift_type  = NULL,
    pending_start_time  = NULL,
    pending_end_time    = NULL,
    has_pending_changes = FALSE
  `;

  let q, params;
  if (days && days.length > 0) {
    q = `UPDATE shifts SET ${publishSet} WHERE shift_date = ANY($1::date[]) RETURNING id`;
    params = [days];
  } else {
    q = `UPDATE shifts SET ${publishSet} WHERE shift_date BETWEEN $1 AND $2 RETURNING id`;
    params = [week_start, weekEndStr];
  }

  const { rows } = await pool.query(q, params);

  // Mark all change log entries for this week as published
  await pool.query(
    `UPDATE shift_change_log SET publish_status='published'
     WHERE week_start = $1 AND publish_status = 'draft'`,
    [week_start]
  );

  logAudit(req, { action_type: 'PUBLISH_WEEK', entity_type: 'shifts', entity_description: `Published ${rows.length} shifts for week of ${week_start}`, new_value: { week_start, published: rows.length } });

  // Push notifications — notify drivers whose shifts were published
  try {
    const { sendPushToDriver } = require('./push');
    const shiftIds = rows.map(r => r.id);
    if (shiftIds.length > 0) {
      const { rows: drivers } = await pool.query(
        `SELECT DISTINCT staff_id FROM shifts WHERE id = ANY($1::int[])`, [shiftIds]
      );
      for (const d of drivers) {
        sendPushToDriver(d.staff_id, '📅 Schedule Published', 'Your schedule has been updated. Check your shifts.', { url: '/my-schedule' }).catch(() => {});
      }
    }
  } catch (e) { /* push not configured — silently skip */ }

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
  const { shift_ids, notify = false } = req.body;
  if (!Array.isArray(shift_ids) || shift_ids.length === 0) {
    return res.status(400).json({ error: 'shift_ids array required' });
  }

  // 1. Publish the shifts — promote any pending_* changes to main columns
  const { rows } = await pool.query(
    `UPDATE shifts SET
       publish_status      = 'published',
       was_published       = TRUE,
       prev_shift_type     = NULL,
       prev_start_time     = NULL,
       prev_end_time       = NULL,
       shift_type          = CASE WHEN has_pending_changes AND pending_shift_type IS NOT NULL THEN pending_shift_type ELSE shift_type END,
       start_time          = CASE WHEN has_pending_changes AND pending_start_time IS NOT NULL THEN pending_start_time ELSE start_time END,
       end_time            = CASE WHEN has_pending_changes AND pending_end_time   IS NOT NULL THEN pending_end_time   ELSE end_time   END,
       pending_shift_type  = NULL,
       pending_start_time  = NULL,
       pending_end_time    = NULL,
       has_pending_changes = FALSE
     WHERE id = ANY($1::int[]) RETURNING id`,
    [shift_ids]
  );
  await pool.query(
    `UPDATE shift_change_log SET publish_status='published'
     WHERE shift_id = ANY($1::int[]) AND publish_status = 'draft'`,
    [shift_ids]
  );

  const publishedCount = rows.length;
  let notifiedDrivers = [];

  // 2. If notify requested, email each affected driver + create in-app notifications
  if (notify && publishedCount > 0) {
    try {
      // Fetch full shift + driver details for the published shifts
      const { rows: shiftDetails } = await pool.query(
        `SELECT s.id, s.shift_date, s.shift_type, s.start_time, s.end_time,
                st.id AS staff_id, st.first_name, st.last_name, st.email
         FROM shifts s
         JOIN staff st ON st.id = s.staff_id
         WHERE s.id = ANY($1::int[])
         ORDER BY s.shift_date`,
        [shift_ids]
      );

      // Group shifts by driver
      const driverMap = new Map();
      for (const row of shiftDetails) {
        if (!driverMap.has(row.staff_id)) {
          driverMap.set(row.staff_id, {
            staff_id:   row.staff_id,
            first_name: row.first_name,
            last_name:  row.last_name,
            email:      row.email,
            shifts:     [],
          });
        }
        driverMap.get(row.staff_id).shifts.push(row);
      }

      // Build a week-range label from the shift dates
      const allDates = shiftDetails
        .map(s => String(s.shift_date).slice(0, 10))
        .sort();
      const fmtShort = (iso) => {
        const d = new Date(iso + 'T12:00:00Z');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      };
      const weekLabel = allDates.length
        ? `${fmtShort(allDates[0])} – ${fmtShort(allDates[allDates.length - 1])}`
        : '';

      const { sendScheduleNotification } = require('../services/emailService');

      for (const [, driver] of driverMap) {
        // Create in-app notification record
        await pool.query(
          `INSERT INTO notifications (staff_id, title, message, type)
           VALUES ($1, $2, $3, $4)`,
          [
            driver.staff_id,
            'Schedule Updated',
            `Your schedule for ${weekLabel} has been updated.`,
            'schedule_published',
          ]
        );

        // Send email (fire-and-forget; errors are logged inside the service)
        sendScheduleNotification(driver, weekLabel, driver.shifts).catch(() => {});

        // Send push notification
        try {
          const { sendPushToDriver } = require('./push');
          const shiftSummary = driver.shifts.length === 1
            ? `Your ${driver.shifts[0].shift_type} shift on ${fmtShort(String(driver.shifts[0].shift_date).slice(0,10))} has been confirmed.`
            : `Your schedule for ${weekLabel} has been updated. Check your shifts.`;
          sendPushToDriver(driver.staff_id, '📅 Schedule Update', shiftSummary, { url: '/my-schedule' }).catch(() => {});
        } catch (e) { /* push not configured */ }

        notifiedDrivers.push(`${driver.first_name} ${driver.last_name}`);
      }
    } catch (notifyErr) {
      // Notification failure must NOT roll back the publish — just log
      console.error('[publish-selected] notification error (non-fatal):', notifyErr.message);
    }
  }

  // 3. Audit log
  const action = notify ? 'PUBLISH_WITH_NOTIFY' : 'PUBLISH_WITHOUT_NOTIFY';
  const desc   = `${publishedCount} shift${publishedCount !== 1 ? 's' : ''} published` +
                 (notify && notifiedDrivers.length
                   ? ` · ${notifiedDrivers.length} driver${notifiedDrivers.length !== 1 ? 's' : ''} notified`
                   : '');
  logAudit(req, {
    action_type:        action,
    entity_type:        'shifts',
    entity_description: desc,
    new_value:          notify
      ? { published: publishedCount, notified: notifiedDrivers }
      : { published: publishedCount },
  });

  res.json({ published: publishedCount, notified: notifiedDrivers.length });
});

// Shift types that should not appear in Ops Planner
const OPS_EXCLUDED_TYPES = ['ON CALL', 'UTO', 'PTO', 'SUSPENSION', 'TRAINING', 'TRAINER'];

// ── POST /api/shifts ──────────────────────────────────────────────────────────
router.post('/', managerOnly, async (req, res) => {
  const { staff_id, shift_date, start_time, end_time, shift_type, notes, source } = req.body;
  const type = shift_type || 'regular';
  const pubStatus = source === 'ops_planner' ? 'published' : 'draft';
  const { rows } = await pool.query(
    `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, publish_status, was_published, notes)
     VALUES ($1,$2,$3,$4,$5,'scheduled',$6,$7,$8) RETURNING *`,
    [staff_id, shift_date, start_time, end_time, type, pubStatus, source === 'ops_planner', notes]
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

  // Auto-remove from Ops Planner if shift type is excluded
  if (OPS_EXCLUDED_TYPES.includes(type.toUpperCase())) {
    try {
      await pool.query(
        `DELETE FROM ops_assignments WHERE staff_id = $1 AND plan_date = $2`,
        [staff_id, shift_date]
      );
      console.log(`[shifts] Auto-removed ${staffName || staff_id} from Ops Planner for ${shift_date} (${type})`);
    } catch (e) { console.error('Auto-remove from ops failed (non-fatal):', e.message); }
  }

  logAudit(req, { action_type: 'CREATE_SHIFT', entity_type: 'shifts', entity_id: shift.id, entity_description: `${type} shift on ${shift_date}`, new_value: { staff_id, shift_date, shift_type: type } });
  res.status(201).json(shift);
});

// ── PUT /api/shifts/:id ───────────────────────────────────────────────────────
router.put('/:id', managerOnly, async (req, res) => {
  const { start_time, end_time, shift_type, status, notes, publish_status, source } = req.body;

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

  // Ops Planner changes bypass the publish workflow — always apply directly
  const fromOpsPlanner = source === 'ops_planner';

  // If this shift is currently live (published and was_published), protect drivers by
  // saving edits to pending_* columns instead of overwriting the published values.
  // Exception: Ops Planner changes are always instant.
  const isCurrentlyLive = !fromOpsPlanner && old.was_published && old.publish_status === 'published';

  let rows;

  if (coreChanged && isCurrentlyLive) {
    // ── Pending path: keep main columns intact, store edits in pending_* ──────
    ({ rows } = await pool.query(
      `UPDATE shifts
       SET pending_shift_type  = $1,
           pending_start_time  = $2,
           pending_end_time    = $3,
           has_pending_changes = TRUE,
           notes  = COALESCE($4, notes),
           status = COALESCE($5, status)
       WHERE id = $6 RETURNING *`,
      [
        shift_type != null ? shift_type : old.shift_type,
        start_time != null ? start_time : old.start_time,
        end_time   != null ? end_time   : old.end_time,
        notes  != null ? notes  : null,
        status != null ? status : null,
        req.params.id,
      ]
    ));
  } else {
    // ── Direct path: update main columns ─────────────────────────────────────
    // Ops Planner: mark as published so it takes effect immediately
    // Normal: revert to draft if core changed
    const resolvedPublishStatus = fromOpsPlanner ? 'published' : (coreChanged ? 'draft' : (publish_status || null));
    const isRevertingToDraft    = !fromOpsPlanner && coreChanged && !!old.was_published;

    ({ rows } = await pool.query(
      `UPDATE shifts
       SET start_time=$1, end_time=$2, shift_type=$3, status=$4, notes=$5,
           publish_status=COALESCE($6, publish_status),
           was_published = CASE WHEN $12 THEN TRUE ELSE was_published END,
           has_pending_changes = CASE WHEN $12 THEN FALSE ELSE has_pending_changes END,
           pending_shift_type = CASE WHEN $12 THEN NULL ELSE pending_shift_type END,
           pending_start_time = CASE WHEN $12 THEN NULL ELSE pending_start_time END,
           pending_end_time = CASE WHEN $12 THEN NULL ELSE pending_end_time END,
           prev_shift_type  = CASE WHEN $7 AND prev_shift_type  IS NULL THEN $8  ELSE prev_shift_type  END,
           prev_start_time  = CASE WHEN $7 AND prev_start_time  IS NULL THEN $9  ELSE prev_start_time  END,
           prev_end_time    = CASE WHEN $7 AND prev_end_time    IS NULL THEN $10 ELSE prev_end_time    END
       WHERE id=$11 RETURNING *`,
      [start_time, end_time, shift_type, status, notes, resolvedPublishStatus,
       isRevertingToDraft, oldType, oldStart, oldEnd, req.params.id, fromOpsPlanner]
    ));
  }

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

    // Auto-remove from Ops Planner if new shift type is excluded
    const newType = (shift_type || oldType).toUpperCase();
    if (OPS_EXCLUDED_TYPES.includes(newType)) {
      try {
        const shiftDate = old.shift_date instanceof Date
          ? old.shift_date.toISOString().split('T')[0]
          : String(old.shift_date).slice(0, 10);
        const { rowCount } = await pool.query(
          `DELETE FROM ops_assignments WHERE staff_id = $1 AND plan_date = $2`,
          [old.staff_id, shiftDate]
        );
        if (rowCount > 0) {
          console.log(`[shifts] Auto-removed ${old.first_name} ${old.last_name} from Ops Planner for ${shiftDate} (${newType})`);
          rows[0].ops_removed = true;
        }
      } catch (e) { console.error('Auto-remove from ops failed (non-fatal):', e.message); }
    }
  }

  res.json(rows[0]);
});

// ── DELETE /api/shifts/:id ────────────────────────────────────────────────────
router.delete('/:id', managerOnly, async (req, res) => {
  // Fetch before delete so we can record a recurring_skip
  const { rows: pre } = await pool.query(
    'SELECT staff_id, shift_date FROM shifts WHERE id = $1', [req.params.id]
  );
  await pool.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
  if (pre[0]) {
    const dateStr = pre[0].shift_date instanceof Date
      ? pre[0].shift_date.toISOString().split('T')[0]
      : String(pre[0].shift_date).slice(0, 10);
    // Record skip for the whole current + any future week.
    // Use week-start comparison (not individual date) so that deleting a Monday
    // shift on a Friday still records the skip for the current week's auto-apply.
    const todayD = new Date();
    const todaySunday = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth(), todayD.getUTCDate() - todayD.getUTCDay()));
    const todayWeekStartStr = todaySunday.toISOString().split('T')[0];
    if (dateStr >= todayWeekStartStr) {
      try {
        await pool.query(
          'INSERT INTO recurring_skip (staff_id, skip_date) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [pre[0].staff_id, dateStr]
        );
      } catch (skipErr) {
        console.warn('[delete] Could not record recurring_skip:', skipErr.message);
      }
    }
  }
  if (pre[0]) logAudit(req, { action_type: 'DELETE_SHIFT', entity_type: 'shifts', entity_id: parseInt(req.params.id), entity_description: `Deleted shift for staff #${pre[0].staff_id} on ${String(pre[0].shift_date).slice(0,10)}` });
  res.json({ message: 'Shift deleted' });
});

// ── POST /api/shifts/:id/reject ───────────────────────────────────────────────
// Reject a pending shift from the Publish modal:
//   • NEW shift (was_published=false) → delete entirely
//   • CHANGED shift (was_published=true) → restore prev_shift_type/start/end, mark published
router.post('/:id/reject', managerOnly, async (req, res) => {
  const { rows: cur } = await pool.query('SELECT * FROM shifts WHERE id = $1', [req.params.id]);
  const shift = cur[0];
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  // Pending change on a live shift — discard pending, driver keeps seeing original
  if (shift.has_pending_changes) {
    const { rows } = await pool.query(
      `UPDATE shifts SET
         pending_shift_type  = NULL,
         pending_start_time  = NULL,
         pending_end_time    = NULL,
         has_pending_changes = FALSE
       WHERE id = $1 RETURNING *`,
      [shift.id]
    );
    return res.json(rows[0]);
  }

  if (!shift.was_published) {
    // New draft shift — delete it entirely
    await pool.query('DELETE FROM shifts WHERE id = $1', [shift.id]);
    const dateStr = shift.shift_date instanceof Date
      ? shift.shift_date.toISOString().split('T')[0]
      : String(shift.shift_date).slice(0, 10);
    const todayD = new Date();
    const todaySunday = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth(), todayD.getUTCDate() - todayD.getUTCDay()));
    if (dateStr >= todaySunday.toISOString().split('T')[0]) {
      try {
        await pool.query(
          'INSERT INTO recurring_skip (staff_id, skip_date) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [shift.staff_id, dateStr]
        );
      } catch (_) {}
    }
    return res.json({ deleted: true, id: shift.id });
  }

  // Changed shift — restore to previously published state, clear prev_ fields
  const { rows } = await pool.query(
    `UPDATE shifts SET
       shift_type      = COALESCE(prev_shift_type,  shift_type),
       start_time      = COALESCE(prev_start_time,  start_time),
       end_time        = COALESCE(prev_end_time,    end_time),
       publish_status  = 'published',
       prev_shift_type = NULL,
       prev_start_time = NULL,
       prev_end_time   = NULL
     WHERE id = $1 RETURNING *`,
    [shift.id]
  );
  res.json(rows[0]);
});

// ── POST /api/shifts/bulk-apply ───────────────────────────────────────────────
// Bulk create or update cells: [{ staff_id, shift_date, shift_id? }]
router.post('/bulk-apply', managerOnly, async (req, res) => {
  try {
    const { cells, shift_type, start_time, end_time } = req.body;
    if (!Array.isArray(cells) || cells.length === 0) return res.status(400).json({ error: 'cells required' });
    if (!shift_type) return res.status(400).json({ error: 'shift_type required' });

    // Cap at 8 weeks ahead
    const MAX_WEEKS_AHEAD = 8;
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + MAX_WEEKS_AHEAD * 7);
    const maxDateStr = maxDate.toISOString().split('T')[0];
    const tooFar = cells.find(c => c.shift_date > maxDateStr);
    if (tooFar) return res.status(400).json({ error: 'Cannot apply shifts more than 8 weeks in advance', maxDate: maxDateStr });

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

    // Fetch before delete to record recurring_skip entries
    const { rows: preRows } = await pool.query(
      'SELECT staff_id, shift_date FROM shifts WHERE id = ANY($1::int[])', [intIds]
    );

    await pool.query('DELETE FROM shifts WHERE id = ANY($1::int[])', [intIds]);

    // Use week-start comparison so current-week past-days are also skipped
    const todayD = new Date();
    const todaySunday = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth(), todayD.getUTCDate() - todayD.getUTCDay()));
    const todayWeekStartStr = todaySunday.toISOString().split('T')[0];
    for (const s of preRows) {
      const dateStr = s.shift_date instanceof Date
        ? s.shift_date.toISOString().split('T')[0]
        : String(s.shift_date).slice(0, 10);
      if (dateStr >= todayWeekStartStr) {
        try {
          await pool.query(
            'INSERT INTO recurring_skip (staff_id, skip_date) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [s.staff_id, dateStr]
          );
        } catch (skipErr) {
          console.warn('[bulk-delete] Could not record recurring_skip:', skipErr.message);
        }
      }
    }

    res.json({ deleted: intIds.length });
  } catch (err) {
    console.error('bulk-delete error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete shifts' });
  }
});

// ── POST /api/shifts/copy-last-week ───────────────────────────────────────────
// Copies all shifts from last week into the current week as draft.
// For each driver+day, reverts to their recurring profile shift type if one exists.
router.post('/copy-last-week', managerOnly, async (req, res) => {
  const { week_start } = req.body;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });

  // Ensure recurring_skip table exists — run without silently swallowing the error
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recurring_skip (
        staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        skip_date DATE    NOT NULL,
        PRIMARY KEY (staff_id, skip_date)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_skip_date ON recurring_skip(skip_date)`);
  } catch (tableErr) {
    console.warn('[copy-last-week] Could not ensure recurring_skip table:', tableErr.message);
  }

  const thisWeek  = new Date(week_start + 'T12:00:00Z');
  const lastWeek  = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastEnd   = new Date(lastWeek);
  lastEnd.setDate(lastEnd.getDate() + 6);
  const lastStartStr = lastWeek.toISOString().split('T')[0];
  const lastEndStr   = lastEnd.toISOString().split('T')[0];

  const { rows: lastShifts } = await pool.query(
    `SELECT staff_id, shift_date, shift_type, start_time, end_time
     FROM shifts WHERE shift_date BETWEEN $1 AND $2 AND publish_status = 'published'`,
    [lastStartStr, lastEndStr]
  );

  const { rows: recurring } = await pool.query('SELECT * FROM driver_recurring_shifts');
  const DAY_COLS = ['sun','mon','tue','wed','thu','fri','sat'];

  let created = 0, skipped = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const ls of lastShifts) {
      const lastDate = ls.shift_date instanceof Date
        ? ls.shift_date.toISOString().split('T')[0]
        : String(ls.shift_date).slice(0, 10);
      const dow = new Date(lastDate + 'T12:00:00Z').getDay();

      const thisDate = new Date(thisWeek);
      thisDate.setDate(thisDate.getDate() + dow);
      const thisDateStr = thisDate.toISOString().split('T')[0];

      // Skip if shift already exists for this driver on this date
      const { rows: existing } = await client.query(
        'SELECT id FROM shifts WHERE staff_id=$1 AND shift_date=$2',
        [ls.staff_id, thisDateStr]
      );
      if (existing.length > 0) { skipped++; continue; }

      // Use recurring profile type/times for this driver+day if available
      const rec = recurring.find(r => r.staff_id === ls.staff_id && r[DAY_COLS[dow]]);
      const shiftType = rec ? rec.shift_type  : ls.shift_type;
      const startTime = rec ? rec.start_time  : ls.start_time;
      const endTime   = rec ? rec.end_time    : ls.end_time;

      // Clear any skip entry so the shift can persist (non-fatal if table missing)
      try {
        await client.query(
          'DELETE FROM recurring_skip WHERE staff_id=$1 AND skip_date=$2',
          [ls.staff_id, thisDateStr]
        );
      } catch (skipErr) { /* table may not exist yet — harmless, skip proceeds */ }

      await client.query(
        `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, publish_status)
         VALUES ($1,$2,$3,$4,$5,'scheduled','draft')`,
        [ls.staff_id, thisDateStr, startTime, endTime, shiftType]
      );
      created++;
    }
    await client.query('COMMIT');
    res.json({ created, skipped });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('copy-last-week error:', err);
    res.status(500).json({ error: err.message || 'Failed to copy week' });
  } finally {
    client.release();
  }
});

// ── POST /api/shifts/:id/move ─────────────────────────────────────────────────
// Drag-and-drop: reassign a shift to a different driver/day. Resets to draft.
router.post('/:id/move', managerOnly, async (req, res) => {
  const { staff_id, shift_date } = req.body;
  if (!staff_id || !shift_date) return res.status(400).json({ error: 'staff_id and shift_date required' });

  // Capture original location before moving (needed for recurring_skip)
  const { rows: original } = await pool.query(
    'SELECT staff_id, shift_date FROM shifts WHERE id=$1',
    [req.params.id]
  );
  if (!original[0]) return res.status(404).json({ error: 'Shift not found' });

  // Block if the target cell already has a shift
  const { rows: conflict } = await pool.query(
    'SELECT id FROM shifts WHERE staff_id=$1 AND shift_date=$2 AND id != $3',
    [staff_id, shift_date, req.params.id]
  );
  if (conflict.length > 0) return res.status(409).json({ error: 'Driver already has a shift on that day' });

  const { rows } = await pool.query(
    `UPDATE shifts SET staff_id=$1, shift_date=$2, publish_status='draft' WHERE id=$3 RETURNING *`,
    [staff_id, shift_date, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Shift not found' });

  // Record skip for the ORIGINAL slot so the recurring engine doesn't recreate there
  const origDateStr = original[0].shift_date instanceof Date
    ? original[0].shift_date.toISOString().split('T')[0]
    : String(original[0].shift_date).slice(0, 10);
  const origStaffId = original[0].staff_id;
  const todayD = new Date();
  const todaySunday = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth(), todayD.getUTCDate() - todayD.getUTCDay()));
  if (origDateStr >= todaySunday.toISOString().split('T')[0]) {
    pool.query(
      'INSERT INTO recurring_skip (staff_id, skip_date) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [origStaffId, origDateStr]
    ).catch(e => console.warn('[move] Could not record recurring_skip for source:', e.message));
  }

  res.json(rows[0]);
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
