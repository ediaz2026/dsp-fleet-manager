const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const fs   = require('fs');
const path = require('path');
const csv  = require('csv-parse/sync');
const bcrypt = require('bcryptjs');

router.use(authMiddleware);

// GET /api/dashboard - all widget data in one call
router.get('/', async (req, res) => {
  const [
    todayShifts,
    fleetAlerts,
    attendanceIssues,
    hoursSummary,
    flaggedInspections,
    upcomingExpirations,
    recentViolations,
    staffStats,
    vehicleStats,
    repairStats,
    driverReportStats,
    routesToday,
    driverAlerts,
    driversScheduled,
    weeklyScheduleStatus,
  ] = await Promise.all([
    // Today's schedule
    pool.query(`
      SELECT s.*, st.first_name, st.last_name, st.employee_id, st.role,
             a.status as attendance_status, a.clock_in, a.clock_out
      FROM shifts s
      JOIN staff st ON st.id = s.staff_id
      LEFT JOIN attendance a ON a.shift_id = s.id
      WHERE s.shift_date = CURRENT_DATE
      ORDER BY s.start_time, st.last_name
    `),

    // Active fleet alerts
    pool.query(`
      SELECT fa.*, v.vehicle_name, v.license_plate
      FROM fleet_alerts fa
      JOIN vehicles v ON v.id = fa.vehicle_id
      WHERE fa.is_resolved = false
      ORDER BY CASE fa.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END
      LIMIT 10
    `),

    // Recent attendance issues (last 7 days)
    pool.query(`
      SELECT a.*, st.first_name, st.last_name, st.employee_id
      FROM attendance a
      JOIN staff st ON st.id = a.staff_id
      WHERE a.status IN ('ncns', 'called_out', 'late')
        AND a.attendance_date >= CURRENT_DATE - 7
      ORDER BY a.attendance_date DESC LIMIT 10
    `),

    // Weekly attendance: Sun–Sat, scheduled shift-days as denominator, unexcused NCNS + CO as absent
    pool.query(`
      WITH week AS (
        SELECT
          (date_trunc('week', (NOW() AT TIME ZONE 'America/New_York')::date + INTERVAL '1 day') - INTERVAL '1 day')::date AS ws,
          (date_trunc('week', (NOW() AT TIME ZONE 'America/New_York')::date + INTERVAL '1 day') - INTERVAL '1 day' + INTERVAL '6 days')::date AS we
      )
      SELECT
        (SELECT COUNT(*) FROM shifts, week
         WHERE shift_date BETWEEN week.ws AND week.we
           AND shift_type NOT IN ('ON CALL','UTO','PTO','SUSPENSION','TRAINING','TRAINER','DISPATCH AM','DISPATCH PM')
        ) as scheduled_count,
        COUNT(*) FILTER (WHERE a.status = 'ncns'       AND (a.excused IS NOT TRUE)) as ncns_count,
        COUNT(*) FILTER (WHERE a.status = 'called_out'  AND (a.excused IS NOT TRUE)) as called_out_count,
        COUNT(*) FILTER (WHERE a.status = 'late') as late_count,
        COUNT(*) FILTER (WHERE a.status = 'sent_home') as sent_home_count,
        (SELECT ws FROM week) as week_start,
        (SELECT we FROM week) as week_end
      FROM attendance a, week
      WHERE a.attendance_date BETWEEN week.ws AND week.we
    `),

    // AI-flagged inspections
    pool.query(`
      SELECT i.*, v.vehicle_name, v.license_plate
      FROM inspections i
      JOIN vehicles v ON v.id = i.vehicle_id
      WHERE i.ai_analysis_status = 'flagged' OR i.damage_detected = true
      ORDER BY i.inspection_date DESC LIMIT 5
    `),

    // Upcoming expirations — drivers + vehicles combined (90 days)
    pool.query(`
      SELECT 'driver' as type, s.first_name || ' ' || s.last_name as name,
        d.license_expiration as expiry_date, 'Driver License' as document,
        (d.license_expiration - CURRENT_DATE)::int as days_remaining
      FROM drivers d JOIN staff s ON s.id = d.staff_id
      WHERE s.status = 'active' AND s.role = 'driver'
        AND d.license_expiration IS NOT NULL
        AND d.license_expiration <= CURRENT_DATE + 90
      UNION ALL
      SELECT 'vehicle', v.vehicle_name, v.insurance_expiration, 'Insurance',
        (v.insurance_expiration - CURRENT_DATE)::int
      FROM vehicles v WHERE v.status = 'active'
        AND v.insurance_expiration IS NOT NULL AND v.insurance_expiration <= CURRENT_DATE + 90
      UNION ALL
      SELECT 'vehicle', v.vehicle_name, v.registration_expiration, 'Registration',
        (v.registration_expiration - CURRENT_DATE)::int
      FROM vehicles v WHERE v.status = 'active'
        AND v.registration_expiration IS NOT NULL AND v.registration_expiration <= CURRENT_DATE + 90
      UNION ALL
      SELECT 'vehicle', v.vehicle_name, v.next_inspection_date, 'Inspection',
        (v.next_inspection_date - CURRENT_DATE)::int
      FROM vehicles v WHERE v.status = 'active'
        AND v.next_inspection_date IS NOT NULL AND v.next_inspection_date <= CURRENT_DATE + 90
      ORDER BY days_remaining ASC
      LIMIT 20
    `),

    // Recent violations
    pool.query(`
      SELECT sv.*, st.first_name, st.last_name, cr.rule_name, cr.consequence_action
      FROM staff_violations sv
      JOIN staff st ON st.id = sv.staff_id
      JOIN consequence_rules cr ON cr.id = sv.rule_id
      WHERE sv.created_at >= CURRENT_DATE - 30
      ORDER BY sv.created_at DESC LIMIT 5
    `),

    // Staff stats
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='active') as active_staff,
        COUNT(*) FILTER (WHERE role='driver' AND status='active') as active_drivers,
        COUNT(*) FILTER (WHERE status='active' AND role='manager') as managers
      FROM staff
    `),

    // Vehicle fleet health
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE van_status = 'Active')                                      AS active_vehicles,
        COUNT(*) FILTER (WHERE van_status = 'Out of Service')                              AS inactive_vehicles,
        COUNT(*) FILTER (WHERE van_status = 'Active' AND amazon_status = 'Grounded')       AS grounded_by_amazon,
        COUNT(*)                                                                            AS total_vehicles
      FROM vehicles
    `),

    // Repair stats (open only)
    pool.query(`
      SELECT
        COUNT(*)                                          AS open_total,
        COUNT(*) FILTER (WHERE priority = 'severe')      AS open_severe,
        COUNT(*) FILTER (WHERE priority = 'medium')      AS open_medium,
        COUNT(*) FILTER (WHERE priority = 'low')         AS open_low
      FROM repairs WHERE status = 'open'
    `).catch(() => ({ rows: [{ open_total: 0, open_severe: 0, open_medium: 0, open_low: 0 }] })),

    // Driver reports — pending count
    pool.query(`SELECT COUNT(*) AS pending FROM driver_reports WHERE status = 'pending'`)
      .catch(() => ({ rows: [{ pending: 0 }] })),

    // Routes + helpers today — from ops_assignments + ops_daily_routes + shifts
    (async () => {
      const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const today = etNow.toISOString().split('T')[0];
      // Routes from ops_assignments
      const { rows: asgnRoutes } = await pool.query(
        `SELECT COUNT(*) AS c FROM ops_assignments WHERE plan_date = $1 AND removed_from_ops IS NOT TRUE AND route_code IS NOT NULL`, [today]
      ).catch(() => ({ rows: [{ c: 0 }] }));
      // Routes from TID matching in ops_daily_routes
      const { rows: drRows } = await pool.query(`SELECT routes FROM ops_daily_routes WHERE plan_date = $1`, [today]).catch(() => ({ rows: [] }));
      const tidRouteCount = drRows[0]?.routes?.length || 0;
      const routeCount = Math.max(parseInt(asgnRoutes[0]?.c || 0), tidRouteCount);
      // Helpers from shifts
      const { rows: helpRows } = await pool.query(
        `SELECT COUNT(*) AS c FROM shifts WHERE shift_date = $1 AND UPPER(shift_type) = 'HELPER'`, [today]
      ).catch(() => ({ rows: [{ c: 0 }] }));
      const helpers = parseInt(helpRows[0]?.c || 0);
      return { rows: [{ routes_today: routeCount, helpers_today: helpers, blocks_today: routeCount + helpers }] };
    })().catch(() => ({ rows: [{ routes_today: 0, helpers_today: 0, blocks_today: 0 }] })),

    // Driver license expiration alerts (30 / 60 / 90 day windows) — from drivers table
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE d.license_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)      AS d30,
        COUNT(*) FILTER (WHERE d.license_expiration BETWEEN CURRENT_DATE + 31 AND CURRENT_DATE + 60) AS d60,
        COUNT(*) FILTER (WHERE d.license_expiration BETWEEN CURRENT_DATE + 61 AND CURRENT_DATE + 90) AS d90
      FROM drivers d
      JOIN staff s ON s.id = d.staff_id
      WHERE s.role = 'driver' AND s.status = 'active' AND d.license_expiration IS NOT NULL
    `).catch(() => ({ rows: [{ d30: 0, d60: 0, d90: 0 }] })),

    // Total drivers scheduled today by shift type
    pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE UPPER(shift_type) = 'EDV') AS edv,
        COUNT(*) FILTER (WHERE UPPER(shift_type) = 'STEP VAN') AS step_van,
        COUNT(*) FILTER (WHERE UPPER(shift_type) = 'HELPER') AS helper,
        COUNT(*) FILTER (WHERE UPPER(shift_type) = 'EXTRA') AS extra,
        COUNT(*) FILTER (WHERE UPPER(shift_type) = 'DISPATCH AM') AS dispatch_am,
        COUNT(*) FILTER (WHERE UPPER(shift_type) = 'DISPATCH PM') AS dispatch_pm
      FROM shifts
      WHERE shift_date = CURRENT_DATE
        AND UPPER(shift_type) IN ('EDV','STEP VAN','HELPER','EXTRA','DISPATCH AM','DISPATCH PM')
    `).catch(() => ({ rows: [{ total: 0, edv: 0, step_van: 0, helper: 0, extra: 0, dispatch_am: 0, dispatch_pm: 0 }] })),

    // Weekly schedule status (Sun–Sat Eastern) — new + modified unpublished
    pool.query(`
      WITH week AS (
        SELECT
          (date_trunc('week', (NOW() AT TIME ZONE 'America/New_York')::date + INTERVAL '1 day') - INTERVAL '1 day')::date AS ws,
          (date_trunc('week', (NOW() AT TIME ZONE 'America/New_York')::date + INTERVAL '1 day') - INTERVAL '1 day' + INTERVAL '6 days')::date AS we
      )
      SELECT
        COUNT(*)::int AS total_shifts,
        COUNT(*) FILTER (WHERE publish_status = 'published'
          AND (has_pending_changes = false OR has_pending_changes IS NULL))::int AS published_shifts,
        COUNT(*) FILTER (WHERE publish_status != 'published'
          OR publish_status IS NULL)::int AS unpublished_new,
        COUNT(*) FILTER (WHERE publish_status = 'published'
          AND has_pending_changes = true)::int AS unpublished_changes,
        (SELECT ws FROM week) AS week_start,
        (SELECT we FROM week) AS week_end
      FROM shifts, week
      WHERE shift_date BETWEEN week.ws AND week.we
        AND shift_type NOT IN ('SUSPENSION','PTO','UTO')
    `).catch(() => ({ rows: [{ total_shifts: 0, published_shifts: 0, unpublished_new: 0, unpublished_changes: 0 }] })),
  ]);

  res.json({
    todayShifts: todayShifts.rows,
    fleetAlerts: fleetAlerts.rows,
    attendanceIssues: attendanceIssues.rows,
    hoursSummary: hoursSummary.rows[0],
    flaggedInspections: flaggedInspections.rows,
    upcomingExpirations: upcomingExpirations.rows,
    recentViolations: recentViolations.rows,
    staffStats: staffStats.rows[0],
    vehicleStats: vehicleStats.rows[0],
    repairStats: repairStats.rows[0],
    pendingDriverReports: parseInt(driverReportStats.rows[0]?.pending || 0, 10),
    routes_today: parseInt(routesToday.rows[0]?.routes_today || 0, 10),
    helpers_today: parseInt(routesToday.rows[0]?.helpers_today || 0, 10),
    blocks_today: parseInt(routesToday.rows[0]?.blocks_today || 0, 10),
    driverAlerts: driverAlerts.rows[0] || { d30: 0, d60: 0, d90: 0 },
    driversScheduled: driversScheduled.rows[0] || { total: 0, edv: 0, step_van: 0, helper: 0, extra: 0, dispatch_am: 0, dispatch_pm: 0 },
    weeklySchedule: weeklyScheduleStatus.rows[0] || { total_shifts: 0, published_shifts: 0, unpublished_shifts: 0 },
    generatedAt: new Date(),
  });
});

// GET /api/dashboard/birthdays — upcoming birthdays (next 7 days)
router.get('/birthdays', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.first_name, s.last_name,
        TO_CHAR(d.dob, 'Mon DD') AS birthday_display,
        CASE
          WHEN TO_CHAR(d.dob, 'MMDD') = TO_CHAR(CURRENT_DATE, 'MMDD') THEN 0
          WHEN TO_CHAR(d.dob, 'MMDD') > TO_CHAR(CURRENT_DATE, 'MMDD')
            THEN (TO_DATE(TO_CHAR(CURRENT_DATE, 'YYYY') || TO_CHAR(d.dob, 'MMDD'), 'YYYYMMDD') - CURRENT_DATE)::int
          ELSE (TO_DATE(TO_CHAR(CURRENT_DATE, 'YYYY') || TO_CHAR(d.dob, 'MMDD'), 'YYYYMMDD') + INTERVAL '1 year' - CURRENT_DATE)::int
        END AS days_until
      FROM drivers d
      JOIN staff s ON s.id = d.staff_id
      WHERE d.dob IS NOT NULL AND s.status NOT IN ('terminated','deleted')
      ORDER BY
        CASE WHEN TO_CHAR(d.dob, 'MMDD') >= TO_CHAR(CURRENT_DATE, 'MMDD')
          THEN TO_CHAR(d.dob, 'MMDD') ELSE 'Z' || TO_CHAR(d.dob, 'MMDD') END
    `);
    const upcoming = rows.filter(r => r.days_until >= 0 && r.days_until <= 7);
    res.json(upcoming);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/attendance-daily — today's attendance counts
router.get('/attendance-daily', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM shifts
         WHERE shift_date = (NOW() AT TIME ZONE 'America/New_York')::date
           AND shift_type NOT IN ('SUSPENSION','PTO','UTO','ON CALL','TRAINING','TRAINER','DISPATCH AM','DISPATCH PM')
        )::int AS scheduled,
        COUNT(*) FILTER (WHERE a.status = 'ncns'       AND (a.excused IS NOT TRUE))::int AS ncns,
        COUNT(*) FILTER (WHERE a.status = 'called_out'  AND (a.excused IS NOT TRUE))::int AS call_out,
        COUNT(*) FILTER (WHERE a.status = 'late'        AND (a.excused IS NOT TRUE))::int AS late,
        COUNT(*) FILTER (WHERE a.status = 'sent_home'   AND (a.excused IS NOT TRUE))::int AS sent_home,
        TO_CHAR((NOW() AT TIME ZONE 'America/New_York')::date, 'Dy Mon DD') AS today_label
      FROM attendance a
      WHERE a.attendance_date = (NOW() AT TIME ZONE 'America/New_York')::date
    `);
    const r = rows[0] || {};
    const scheduled = parseInt(r.scheduled || 0);
    const absent = parseInt(r.ncns || 0) + parseInt(r.call_out || 0);
    const rate = scheduled > 0 ? Math.round(((scheduled - absent) / scheduled) * 1000) / 10 : null;
    res.json({ ...r, attendance_rate: rate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dashboard/wipe-reimport  (admin only)
router.post('/wipe-reimport', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Wipe vehicles
    await client.query('DELETE FROM inspection_photos');
    await client.query('DELETE FROM inspections');
    await client.query('DELETE FROM fleet_alerts');
    try { await client.query('DELETE FROM repairs'); } catch {}
    await client.query('DELETE FROM vehicles');

    // Wipe drivers
    const { rows: driverStaff } = await client.query("SELECT id FROM staff WHERE role = 'driver'");
    const driverIds = driverStaff.map(r => r.id);
    if (driverIds.length > 0) {
      await client.query('DELETE FROM driver_recurring_shifts WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM day_schedule_drivers    WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM staff_violations        WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM payroll_records         WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM attendance              WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM shifts                  WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM amazon_routes WHERE internal_staff_id = ANY($1::int[])', [driverIds]);
      try { await client.query('DELETE FROM driver_reports WHERE staff_id = ANY($1::int[])', [driverIds]); } catch {}
    }
    await client.query('DELETE FROM drivers');
    await client.query("DELETE FROM staff WHERE role = 'driver'");

    // Find CSV
    const roots = [process.cwd(), path.join(__dirname,'..','..','..'), path.join(__dirname,'..','..','..','..') ];
    let csvPath = null;
    for (const r of roots) {
      const p = path.join(r, 'AssociateData (2).csv');
      if (fs.existsSync(p)) { csvPath = p; break; }
    }
    if (!csvPath) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'AssociateData (2).csv not found on server disk' });
    }

    let content = fs.readFileSync(csvPath, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const records = csv.parse(content, { columns: true, skip_empty_lines: true, trim: true });

    const passwordHash = await bcrypt.hash('password123', 10);
    let driverCount = 0;
    const driverErrors = [];

    for (const row of records) {
      try {
        const nameKey  = Object.keys(row).find(k => k.replace(/^\uFEFF/,'').trim() === 'Name and ID') || Object.keys(row)[0];
        const fullName = (row[nameKey] || '').trim().replace(/\s+/g,' ');
        if (!fullName) continue;
        const nameParts    = fullName.split(' ');
        const firstName    = nameParts[0];
        const lastName     = nameParts.slice(1).join(' ') || 'Unknown';
        const transponderId = (row['TransporterID'] || '').trim();
        const email         = (row['Email'] || '').trim().toLowerCase();
        const phone         = (row['Personal Phone Number'] || '').toString().trim();
        const status        = (row['Status'] || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'active' : 'inactive';
        const notes         = [
          row['Position']       ? `Position: ${row['Position']}` : '',
          row['Qualifications'] ? `Qualifications: ${row['Qualifications']}` : '',
        ].filter(Boolean).join(' | ');

        let licenseExpiration = null;
        const expRaw = (row['ID expiration'] || '').trim();
        if (expRaw) {
          const p = expRaw.split('/');
          if (p.length === 3) licenseExpiration = `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
        }

        const employeeId = transponderId.substring(0, 20);
        if (!email || !employeeId) continue;

        const { rows: sr } = await client.query(
          `INSERT INTO staff (employee_id,first_name,last_name,email,phone,role,status,hire_date,password_hash)
           VALUES ($1,$2,$3,$4,$5,'driver',$6,CURRENT_DATE,$7)
           ON CONFLICT (email) DO UPDATE
             SET first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,
                 phone=EXCLUDED.phone,status=EXCLUDED.status,updated_at=NOW()
           RETURNING id`,
          [employeeId,firstName,lastName,email,phone,status,passwordHash]
        );
        await client.query(
          `INSERT INTO drivers (staff_id,transponder_id,license_expiration,notes)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (staff_id) DO UPDATE
             SET transponder_id=EXCLUDED.transponder_id,
                 license_expiration=EXCLUDED.license_expiration,
                 notes=EXCLUDED.notes, updated_at=NOW()`,
          [sr[0].id, transponderId, licenseExpiration, notes]
        );
        driverCount++;
      } catch (e) {
        driverErrors.push(`${row['Name and ID']||'?'}: ${e.message}`);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, drivers_imported: driverCount, vehicles_imported: 0, errors: driverErrors });

  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
