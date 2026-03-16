require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Seeding database...');

    // Clear existing data
    await client.query(`
      TRUNCATE TABLE inspection_photos, inspections, amazon_routes, amazon_route_files,
        payroll_records, staff_violations, attendance, shifts, drivers,
        fleet_alerts, vehicles, consequence_rules, settings, staff RESTART IDENTITY CASCADE
    `);

    const passwordHash = await bcrypt.hash('password123', 10);

    // --- STAFF ---
    const staffData = [
      ['MGR001', 'James', 'Mitchell', 'jmitchell@dspfleet.com', '555-0101', 'manager', 'active', '2022-01-15'],
      ['OPS001', 'Sarah', 'Thompson', 'sthompson@dspfleet.com', '555-0102', 'dispatcher', 'active', '2022-03-01'],
      ['DRV001', 'Mike', 'Johnson', 'mjohnson@dspfleet.com', '555-0103', 'driver', 'active', '2023-02-10'],
      ['DRV002', 'Emma', 'Davis', 'edavis@dspfleet.com', '555-0104', 'driver', 'active', '2023-04-15'],
      ['DRV003', 'Carlos', 'Martinez', 'cmartinez@dspfleet.com', '555-0105', 'driver', 'active', '2023-05-20'],
      ['DRV004', 'Lisa', 'Chen', 'lchen@dspfleet.com', '555-0106', 'driver', 'active', '2023-06-01'],
      ['DRV005', 'David', 'Brown', 'dbrown@dspfleet.com', '555-0107', 'driver', 'active', '2023-07-12'],
      ['DRV006', 'Jennifer', 'Wilson', 'jwilson@dspfleet.com', '555-0108', 'driver', 'active', '2023-08-05'],
      ['DRV007', 'Robert', 'Taylor', 'rtaylor@dspfleet.com', '555-0109', 'driver', 'active', '2023-09-18'],
      ['DRV008', 'Amanda', 'Garcia', 'agarcia@dspfleet.com', '555-0110', 'driver', 'active', '2023-10-02'],
    ];

    const staffIds = [];
    for (const s of staffData) {
      const r = await client.query(
        `INSERT INTO staff (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [...s, passwordHash]
      );
      staffIds.push(r.rows[0].id);
    }
    console.log(`  ✓ ${staffIds.length} staff members`);

    // --- DRIVER PROFILES ---
    const driverProfiles = [
      [staffIds[2], 'D1234567', '2026-03-15', 'FL', 'D', '1990-05-12', 'TXP-001', 'Mary Johnson', '555-1001', 'Mother'],
      [staffIds[3], 'D2345678', '2025-11-20', 'FL', 'D', '1992-08-22', 'TXP-002', 'John Davis', '555-1002', 'Husband'],
      [staffIds[4], 'D3456789', '2026-06-10', 'FL', 'D', '1988-12-05', 'TXP-003', 'Rosa Martinez', '555-1003', 'Wife'],
      [staffIds[5], 'D4567890', '2027-01-30', 'FL', 'D', '1995-03-18', 'TXP-004', 'Wei Chen', '555-1004', 'Father'],
      [staffIds[6], 'D5678901', '2025-09-05', 'FL', 'D', '1987-07-25', 'TXP-005', 'Patricia Brown', '555-1005', 'Mother'],
      [staffIds[7], 'D6789012', '2026-12-15', 'FL', 'D', '1993-11-08', 'TXP-006', 'Tom Wilson', '555-1006', 'Spouse'],
      [staffIds[8], 'D7890123', '2025-08-20', 'FL', 'D', '1986-04-30', 'TXP-007', 'Helen Taylor', '555-1007', 'Mother'],
      [staffIds[9], 'D8901234', '2026-05-25', 'FL', 'D', '1994-09-14', 'TXP-008', 'Jose Garcia', '555-1008', 'Father'],
    ];

    for (const d of driverProfiles) {
      await client.query(
        `INSERT INTO drivers (staff_id, license_number, license_expiration, license_state, license_class, dob,
          transponder_id, emergency_contact_name, emergency_contact_phone, emergency_contact_relation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        d
      );
    }
    console.log(`  ✓ ${driverProfiles.length} driver profiles`);

    // --- VEHICLES ---
    const today = new Date();
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r.toISOString().split('T')[0]; };

    const vehicleData = [
      ['VAN-001', 'ABC1234', '1FTBF2B63MEA12345', 'Ford', 'Transit', 2021, 'White', 'TXP-V001', addDays(today, 5), addDays(today, 120), 'active'],
      ['VAN-002', 'XYZ5678', '1FTBF2B63MEA67890', 'Ford', 'Transit', 2020, 'White', 'TXP-V002', addDays(today, 90), addDays(today, 8), 'active'],
      ['VAN-003', 'DEF9012', 'WD3PE8CD5JP123456', 'Mercedes', 'Sprinter', 2022, 'Silver', 'TXP-V003', addDays(today, 180), addDays(today, 200), 'active'],
      ['VAN-004', 'GHI3456', '1FTBF2B63MEA11111', 'Ford', 'Transit', 2019, 'Gray', 'TXP-V004', addDays(today, 60), addDays(today, 90), 'maintenance'],
      ['VAN-005', 'JKL7890', '3C6TRVDG1JE123456', 'Ram', 'ProMaster', 2021, 'White', 'TXP-V005', addDays(today, 250), addDays(today, 12), 'active'],
    ];

    const vehicleIds = [];
    for (const v of vehicleData) {
      const r = await client.query(
        `INSERT INTO vehicles (vehicle_name, license_plate, vin, make, model, year, color, transponder_id,
          insurance_expiration, registration_expiration, last_inspection_date, next_inspection_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CURRENT_DATE - 30, CURRENT_DATE + 30, $11) RETURNING id`,
        v
      );
      vehicleIds.push(r.rows[0].id);
    }
    console.log(`  ✓ ${vehicleIds.length} vehicles`);

    // --- FLEET ALERTS ---
    await client.query(
      `INSERT INTO fleet_alerts (vehicle_id, alert_type, alert_message, severity) VALUES
       ($1, 'insurance_expiry', 'VAN-001 insurance expires in 5 days', 'critical'),
       ($2, 'registration_expiry', 'VAN-002 registration expires in 8 days', 'critical'),
       ($3, 'registration_expiry', 'VAN-005 registration expires in 12 days', 'warning')`,
      [vehicleIds[0], vehicleIds[1], vehicleIds[4]]
    );
    console.log('  ✓ Fleet alerts');

    // --- CONSEQUENCE RULES ---
    await client.query(`
      INSERT INTO consequence_rules (rule_name, violation_type, threshold, time_period_days, consequence_action) VALUES
      ('NCNS Termination Review', 'ncns', 3, 90, 'termination_review'),
      ('NCNS Written Warning', 'ncns', 2, 30, 'written_warning'),
      ('Call-Out Warning', 'called_out', 5, 90, 'verbal_warning'),
      ('Call-Out Written Warning', 'called_out', 8, 90, 'written_warning'),
      ('Late Pattern Warning', 'late', 3, 30, 'verbal_warning'),
      ('Late Written Warning', 'late', 5, 60, 'written_warning')
    `);
    console.log('  ✓ Consequence rules');

    // --- SHIFTS (last 14 days + next 7 days) ---
    const driverStaffIds = staffIds.slice(2); // DRV001-DRV008
    let shiftCount = 0;
    for (let dayOffset = -14; dayOffset <= 7; dayOffset++) {
      const shiftDate = addDays(today, dayOffset);
      const dow = new Date(shiftDate).getDay();
      if (dow === 0) continue; // skip Sundays

      for (const sid of driverStaffIds) {
        const r = await client.query(
          `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status)
           VALUES ($1, $2, '07:00', '17:00', 'regular', $3) RETURNING id`,
          [sid, shiftDate, dayOffset < 0 ? 'completed' : dayOffset === 0 ? 'in_progress' : 'scheduled']
        );
        shiftCount++;

        // Create attendance for past shifts
        if (dayOffset < 0) {
          let attStatus = 'present';
          let clockIn = null, clockOut = null, hours = 9.5, late = 0;

          // Carlos (staffIds[4]) has 2 NCNS
          if (sid === staffIds[4] && (dayOffset === -3 || dayOffset === -10)) attStatus = 'ncns';
          // Robert (staffIds[8]) has called out 3 times
          else if (sid === staffIds[8] && (dayOffset === -2 || dayOffset === -5 || dayOffset === -9)) attStatus = 'called_out';
          // Amanda (staffIds[9]) was late twice
          else if (sid === staffIds[9] && (dayOffset === -1 || dayOffset === -6)) { attStatus = 'late'; late = 22; }
          else if (attStatus === 'present') {
            const d = new Date(shiftDate + 'T07:00:00');
            clockIn = new Date(d.getTime() + (Math.random() * 5 - 2) * 60000);
            clockOut = new Date(d.getTime() + 9.5 * 3600000 + (Math.random() * 10 - 5) * 60000);
          }

          await client.query(
            `INSERT INTO attendance (staff_id, shift_id, attendance_date, clock_in, clock_out, status, late_minutes, hours_worked)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [sid, r.rows[0].id, shiftDate,
              attStatus === 'present' || attStatus === 'late' ? clockIn : null,
              attStatus === 'present' || attStatus === 'late' ? clockOut : null,
              attStatus, late,
              attStatus === 'present' || attStatus === 'late' ? hours : 0]
          );
        }
      }
    }
    console.log(`  ✓ ${shiftCount} shifts + attendance records`);

    // --- VIOLATIONS ---
    const ruleRes = await client.query('SELECT id, violation_type, threshold FROM consequence_rules');
    const rules = ruleRes.rows;
    const ncnsRule = rules.find(r => r.violation_type === 'ncns' && r.threshold === 2);
    const calloutRule = rules.find(r => r.violation_type === 'called_out' && r.threshold === 5);

    if (ncnsRule) {
      await client.query(
        `INSERT INTO staff_violations (staff_id, rule_id, violation_type, action_taken, notes)
         VALUES ($1, $2, 'ncns', 'written_warning', 'Second NCNS in 30 days - written warning issued')`,
        [staffIds[4], ncnsRule.id]
      );
    }
    console.log('  ✓ Violations');

    // --- PAYROLL RECORDS ---
    const periodStart = addDays(today, -14);
    const periodEnd = addDays(today, -1);
    for (let i = 0; i < driverStaffIds.length; i++) {
      const sid = driverStaffIds[i];
      const scheduled = 95;
      const actual = scheduled - Math.random() * 10;
      await client.query(
        `INSERT INTO payroll_records (staff_id, pay_period_start, pay_period_end, scheduled_hours, actual_hours, overtime_hours, source, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual', 'synced')`,
        [sid, periodStart, periodEnd, scheduled, actual.toFixed(2), Math.max(0, actual - 80).toFixed(2)]
      );
    }
    console.log('  ✓ Payroll records');

    // --- AMAZON ROUTES ---
    const routeFile = await client.query(
      `INSERT INTO amazon_route_files (file_name, route_date, total_routes, matched_routes, mismatched_routes, unmatched_routes, uploaded_by)
       VALUES ('amazon_routes_${today.toISOString().split('T')[0]}.csv', $1, 8, 6, 1, 1, $2) RETURNING id`,
      [today.toISOString().split('T')[0], staffIds[0]]
    );
    const rfId = routeFile.rows[0].id;

    const routeData = [
      ['RT-001', 'Mike Johnson', 'AMZ001', staffIds[2], 'matched'],
      ['RT-002', 'Emma Davis', 'AMZ002', staffIds[3], 'matched'],
      ['RT-003', 'Carlos Martinez', 'AMZ003', staffIds[4], 'matched'],
      ['RT-004', 'Lisa Chen', 'AMZ004', staffIds[5], 'matched'],
      ['RT-005', 'David Brown', 'AMZ005', staffIds[6], 'matched'],
      ['RT-006', 'Jennifer Wilson', 'AMZ006', staffIds[7], 'matched'],
      ['RT-007', 'Bob Smith', 'AMZ007', null, 'unmatched'],
      ['RT-008', 'Amanda Clarke', 'AMZ008', staffIds[9], 'mismatched'],
    ];

    for (const r of routeData) {
      await client.query(
        `INSERT INTO amazon_routes (route_file_id, route_code, amazon_driver_name, amazon_driver_id, internal_staff_id, match_status, route_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [rfId, r[0], r[1], r[2], r[3], r[4], today.toISOString().split('T')[0]]
      );
    }
    console.log('  ✓ Amazon routes');

    // --- INSPECTIONS ---
    const inspDate = addDays(today, -1);
    const insp = await client.query(
      `INSERT INTO inspections (vehicle_id, driver_id, inspection_date, inspection_type, status, overall_condition, ai_analysis_status)
       VALUES ($1, $2, $3, 'pre_trip', 'completed', 'good', 'flagged') RETURNING id`,
      [vehicleIds[0], staffIds[2], inspDate + 'T07:15:00']
    );
    await client.query(
      `INSERT INTO inspection_photos (inspection_id, photo_angle, file_path, ai_flagged, ai_confidence)
       VALUES ($1, 'front', '/uploads/inspections/demo_front.jpg', true, 87.5),
              ($1, 'rear', '/uploads/inspections/demo_rear.jpg', false, null),
              ($1, 'left_side', '/uploads/inspections/demo_left.jpg', false, null),
              ($1, 'right_side', '/uploads/inspections/demo_right.jpg', false, null),
              ($1, 'interior', '/uploads/inspections/demo_interior.jpg', false, null)`,
      [insp.rows[0].id]
    );
    console.log('  ✓ Inspections');

    // --- SETTINGS ---
    await client.query(`
      INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES
      ('company_name', 'Fleet DSP Solutions', 'string', 'Company display name'),
      ('paycom_enabled', 'false', 'boolean', 'Enable Paycom API integration'),
      ('adp_enabled', 'false', 'boolean', 'Enable ADP API integration'),
      ('paycom_api_key', '', 'string', 'Paycom API key'),
      ('adp_client_id', '', 'string', 'ADP Client ID'),
      ('adp_client_secret', '', 'string', 'ADP Client Secret'),
      ('ai_damage_detection', 'true', 'boolean', 'Enable AI damage detection'),
      ('alert_days_insurance', '30', 'number', 'Days before insurance expiry to alert'),
      ('alert_days_registration', '30', 'number', 'Days before registration expiry to alert'),
      ('alert_days_inspection', '14', 'number', 'Days before inspection due to alert'),
      ('default_shift_start', '07:00', 'string', 'Default shift start time'),
      ('default_shift_end', '17:00', 'string', 'Default shift end time')
    `);
    console.log('  ✓ Settings');

    await client.query('COMMIT');
    console.log('\n✅ Database seeded successfully!');
    console.log('   Login: jmitchell@dspfleet.com / password123 (manager)');
    console.log('   Login: mjohnson@dspfleet.com / password123 (driver)\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
