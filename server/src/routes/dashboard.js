const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

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
    generatedAt: new Date(),
  });
});

module.exports = router;
