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

    // Hours summary this week
    pool.query(`
      SELECT COALESCE(SUM(hours_worked), 0) as total_hours,
             COUNT(*) FILTER (WHERE status='present') as present_count,
             COUNT(*) FILTER (WHERE status='ncns') as ncns_count,
             COUNT(*) FILTER (WHERE status='called_out') as called_out_count,
             COUNT(*) FILTER (WHERE status='late') as late_count
      FROM attendance
      WHERE attendance_date >= date_trunc('week', CURRENT_DATE)
    `),

    // AI-flagged inspections
    pool.query(`
      SELECT i.*, v.vehicle_name, v.license_plate
      FROM inspections i
      JOIN vehicles v ON v.id = i.vehicle_id
      WHERE i.ai_analysis_status = 'flagged' OR i.damage_detected = true
      ORDER BY i.inspection_date DESC LIMIT 5
    `),

    // Upcoming document expirations (30 days)
    pool.query(`
      SELECT vehicle_name, license_plate,
             insurance_expiration, registration_expiration, next_inspection_date,
             LEAST(
               CASE WHEN insurance_expiration IS NOT NULL THEN insurance_expiration END,
               CASE WHEN registration_expiration IS NOT NULL THEN registration_expiration END,
               CASE WHEN next_inspection_date IS NOT NULL THEN next_inspection_date END
             ) as earliest_expiry
      FROM vehicles
      WHERE status = 'active'
        AND (insurance_expiration <= CURRENT_DATE + 30
          OR registration_expiration <= CURRENT_DATE + 30
          OR next_inspection_date <= CURRENT_DATE + 14)
      ORDER BY earliest_expiry LIMIT 10
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
        COUNT(*) FILTER (WHERE status = 'active')                        AS active_vehicles,
        COUNT(*) FILTER (WHERE status IN ('inactive','maintenance'))      AS inactive_vehicles,
        COUNT(*) FILTER (WHERE status = 'retired')                       AS retired_vehicles,
        COUNT(*)                                                          AS total_vehicles
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

    // Routes today — from ops planner session
    pool.query(`
      SELECT COALESCE(jsonb_array_length(rows), 0) AS routes_today
      FROM ops_planner_sessions WHERE plan_date = CURRENT_DATE
    `).catch(() => ({ rows: [] })),

    // Driver license expiration alerts (30 / 60 / 90 day windows)
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE license_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)      AS d30,
        COUNT(*) FILTER (WHERE license_expiration BETWEEN CURRENT_DATE + 31 AND CURRENT_DATE + 60) AS d60,
        COUNT(*) FILTER (WHERE license_expiration BETWEEN CURRENT_DATE + 61 AND CURRENT_DATE + 90) AS d90
      FROM staff
      WHERE role = 'driver' AND status = 'active' AND license_expiration IS NOT NULL
    `).catch(() => ({ rows: [{ d30: 0, d60: 0, d90: 0 }] })),
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
    driverAlerts: driverAlerts.rows[0] || { d30: 0, d60: 0, d90: 0 },
    generatedAt: new Date(),
  });
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
