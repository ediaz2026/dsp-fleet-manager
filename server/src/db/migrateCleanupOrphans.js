/**
 * migrateCleanupOrphans.js
 *
 * One-time + idempotent cleanup of orphaned records from previously
 * deleted drivers, plus FK constraint corrections:
 *
 *  • attendance.staff_id        → ON DELETE SET NULL  (preserve historical records)
 *  • payroll_records.staff_id   → ON DELETE SET NULL  (preserve historical records)
 *  • shifts.staff_id            → ON DELETE CASCADE   (future shifts die with driver)
 *  • ops_assignments.staff_id   → ON DELETE CASCADE   (ops data dies with driver)
 *  • driver_recurring_shifts.staff_id → ON DELETE CASCADE
 *  • recurring_skip.staff_id    → ON DELETE CASCADE
 */

const pool = require('./pool');

async function migrateCleanupOrphans() {
  // ── Step 1: Nullify orphaned attendance staff_id (staff was deleted) ──────────
  const { rowCount: attendanceNulled } = await pool.query(`
    UPDATE attendance
    SET staff_id = NULL
    WHERE staff_id IS NOT NULL
      AND staff_id NOT IN (SELECT id FROM staff)
  `);

  // ── Step 2: Nullify orphaned payroll_records staff_id ─────────────────────────
  const { rowCount: payrollNulled } = await pool.query(`
    UPDATE payroll_records
    SET staff_id = NULL
    WHERE staff_id IS NOT NULL
      AND staff_id NOT IN (SELECT id FROM staff)
  `);

  // ── Step 3: Delete orphaned future shifts ─────────────────────────────────────
  const { rowCount: shiftsDeleted } = await pool.query(`
    DELETE FROM shifts
    WHERE staff_id NOT IN (SELECT id FROM staff)
      AND shift_date >= CURRENT_DATE
  `);

  // ── Step 4: Delete orphaned future ops assignments ────────────────────────────
  const { rowCount: opsDeleted } = await pool.query(`
    DELETE FROM ops_assignments
    WHERE staff_id NOT IN (SELECT id FROM staff)
      AND plan_date >= CURRENT_DATE
  `);

  // ── Step 5: Delete orphaned recurring shifts ──────────────────────────────────
  const { rowCount: recurringDeleted } = await pool.query(`
    DELETE FROM driver_recurring_shifts
    WHERE staff_id NOT IN (SELECT id FROM staff)
  `);

  // ── Step 6: Delete orphaned recurring_skip entries ────────────────────────────
  const { rowCount: skipDeleted } = await pool.query(`
    DELETE FROM recurring_skip
    WHERE staff_id NOT IN (SELECT id FROM staff)
  `);

  // ── Step 7: Fix attendance FK → SET NULL on delete ───────────────────────────
  await pool.query(`ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_staff_id_fkey`);
  await pool.query(`
    ALTER TABLE attendance
    ADD CONSTRAINT attendance_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL
  `);

  // ── Step 8: Fix payroll_records FK → SET NULL on delete ──────────────────────
  await pool.query(`ALTER TABLE payroll_records DROP CONSTRAINT IF EXISTS payroll_records_staff_id_fkey`);
  await pool.query(`
    ALTER TABLE payroll_records
    ADD CONSTRAINT payroll_records_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL
  `);

  // ── Step 9: Ensure shifts FK has CASCADE ──────────────────────────────────────
  await pool.query(`ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_staff_id_fkey`);
  await pool.query(`
    ALTER TABLE shifts
    ADD CONSTRAINT shifts_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
  `);

  // ── Step 10: Ensure ops_assignments FK has CASCADE ────────────────────────────
  await pool.query(`ALTER TABLE ops_assignments DROP CONSTRAINT IF EXISTS ops_assignments_staff_id_fkey`);
  await pool.query(`
    ALTER TABLE ops_assignments
    ADD CONSTRAINT ops_assignments_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
  `);

  // ── Step 11: Ensure driver_recurring_shifts FK has CASCADE ────────────────────
  await pool.query(`ALTER TABLE driver_recurring_shifts DROP CONSTRAINT IF EXISTS driver_recurring_shifts_staff_id_fkey`);
  await pool.query(`
    ALTER TABLE driver_recurring_shifts
    ADD CONSTRAINT driver_recurring_shifts_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
  `);

  // ── Step 12: Ensure recurring_skip FK has CASCADE ─────────────────────────────
  await pool.query(`ALTER TABLE recurring_skip DROP CONSTRAINT IF EXISTS recurring_skip_staff_id_fkey`);
  await pool.query(`
    ALTER TABLE recurring_skip
    ADD CONSTRAINT recurring_skip_staff_id_fkey
    FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
  `);

  console.log(
    `✅ migrateCleanupOrphans done — ` +
    `attendance nulled: ${attendanceNulled}, payroll nulled: ${payrollNulled}, ` +
    `future shifts deleted: ${shiftsDeleted}, ops assignments deleted: ${opsDeleted}, ` +
    `recurring deleted: ${recurringDeleted}, skip entries deleted: ${skipDeleted}`
  );
}

module.exports = migrateCleanupOrphans;
