/**
 * wipeAndReimport.js
 * Wipes all driver + vehicle data and reimports from AssociateData CSV.
 * Safe: preserves manager/admin/dispatcher staff accounts.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const _resultFile = require('path').join(process.cwd(), 'wipe-reimport-result.json');
const _fs0 = require('fs');
_fs0.writeFileSync(_resultFile, JSON.stringify({ status: 'started', ts: new Date() }));
const pool  = require('./pool');
const fs    = require('fs');
const path  = require('path');
const csv   = require('csv-parse/sync');
const bcrypt = require('bcryptjs');

const CSV_PATH = path.join(process.cwd(), 'AssociateData (2).csv');

async function run() {
  const client = await pool.connect();
  try {
    console.log('═══════════════════════════════════════════════');
    console.log('  DSP Fleet Manager — Wipe & Reimport');
    console.log('═══════════════════════════════════════════════\n');

    /* ── Step 1: Wipe vehicle-related data ─────────────────────────────── */
    console.log('▶ Wiping vehicle data...');
    await client.query('BEGIN');

    // Delete in FK order
    await client.query('DELETE FROM inspection_photos');
    await client.query('DELETE FROM inspections');
    await client.query('DELETE FROM fleet_alerts');
    // repairs table (may or may not exist) — use savepoint so a failure doesn't abort the transaction
    await client.query('SAVEPOINT sp_repairs');
    try { await client.query('DELETE FROM repairs'); }
    catch { await client.query('ROLLBACK TO SAVEPOINT sp_repairs'); }
    await client.query('RELEASE SAVEPOINT sp_repairs');
    await client.query('DELETE FROM vehicles');

    console.log('  ✓ Vehicles, inspections, fleet alerts cleared');

    /* ── Step 2: Wipe driver-related data ──────────────────────────────── */
    console.log('▶ Wiping driver data...');

    // Get IDs of driver-role staff
    const { rows: driverStaff } = await client.query(
      "SELECT id FROM staff WHERE role = 'driver'"
    );
    const driverIds = driverStaff.map(r => r.id);

    if (driverIds.length > 0) {
      const idList = driverIds.join(',');
      await client.query('DELETE FROM driver_recurring_shifts WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM day_schedule_drivers WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM staff_violations WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM payroll_records WHERE staff_id = ANY($1::int[])', [driverIds]);
      // attendance cascade handles itself via FK, but be explicit
      await client.query('DELETE FROM attendance WHERE staff_id = ANY($1::int[])', [driverIds]);
      // shifts
      await client.query('DELETE FROM shifts WHERE staff_id = ANY($1::int[])', [driverIds]);
      // amazon routes
      await client.query('DELETE FROM amazon_routes WHERE internal_staff_id = ANY($1::int[])', [driverIds]);
      // driver reports (if table exists) — use savepoint so a failure doesn't abort the transaction
      await client.query('SAVEPOINT sp_driver_reports');
      try { await client.query('DELETE FROM driver_reports WHERE staff_id = ANY($1::int[])', [driverIds]); }
      catch { await client.query('ROLLBACK TO SAVEPOINT sp_driver_reports'); }
      await client.query('RELEASE SAVEPOINT sp_driver_reports');
    }

    await client.query('DELETE FROM drivers');
    await client.query("DELETE FROM staff WHERE role = 'driver'");

    await client.query('COMMIT');
    console.log(`  ✓ ${driverIds.length} driver records + all related data cleared\n`);

    /* ── Step 3: Reimport drivers from CSV ─────────────────────────────── */
    console.log('▶ Importing drivers from AssociateData CSV...');

    if (!fs.existsSync(CSV_PATH)) {
      console.error(`  ✗ CSV not found at: ${CSV_PATH}`);
      process.exit(1);
    }

    let content = fs.readFileSync(CSV_PATH, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    const records = csv.parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`  Found ${records.length} rows in CSV`);

    const passwordHash = await bcrypt.hash('password123', 10);
    let driverCount = 0, driverErrors = 0;

    await client.query('BEGIN');

    for (const row of records) {
      try {
        const nameKey = Object.keys(row).find(k => k.replace(/^\uFEFF/, '').trim() === 'Name and ID') || Object.keys(row)[0];
        const fullName = (row[nameKey] || '').trim().replace(/\s+/g, ' ');
        if (!fullName) continue;

        const nameParts = fullName.split(' ');
        const firstName = nameParts[0];
        const lastName  = nameParts.slice(1).join(' ') || 'Unknown';

        const transponderId  = (row['TransporterID'] || '').trim();
        const email          = (row['Email'] || '').trim().toLowerCase();
        const personalPhone  = (row['Personal Phone Number'] || '').toString().trim();
        const status         = (row['Status'] || 'ACTIVE').trim().toUpperCase() === 'ACTIVE' ? 'active' : 'inactive';
        const qualifications = (row['Qualifications'] || '').trim();
        const position       = (row['Position'] || '').trim();

        let licenseExpiration = null;
        const expRaw = (row['ID expiration'] || '').trim();
        if (expRaw) {
          const parts = expRaw.split('/');
          if (parts.length === 3) {
            licenseExpiration = `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
          }
        }

        const employeeId = transponderId.substring(0, 20);
        if (!email || !employeeId) continue;

        const staffResult = await client.query(
          `INSERT INTO staff (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
           VALUES ($1,$2,$3,$4,$5,'driver',$6,CURRENT_DATE,$7)
           ON CONFLICT (email) DO UPDATE
             SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
                 phone=EXCLUDED.phone, status=EXCLUDED.status, updated_at=NOW()
           RETURNING id`,
          [employeeId, firstName, lastName, email, personalPhone, status, passwordHash]
        );

        const staffId = staffResult.rows[0].id;
        const notes = [
          position       ? `Position: ${position}` : '',
          qualifications ? `Qualifications: ${qualifications}` : '',
        ].filter(Boolean).join(' | ');

        await client.query(
          `INSERT INTO drivers (staff_id, transponder_id, license_expiration, notes)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (staff_id) DO UPDATE
             SET transponder_id=EXCLUDED.transponder_id,
                 license_expiration=EXCLUDED.license_expiration,
                 notes=EXCLUDED.notes, updated_at=NOW()`,
          [staffId, transponderId, licenseExpiration, notes]
        );

        driverCount++;
      } catch (err) {
        console.error(`  ✗ ${row['Name and ID'] || '?'}: ${err.message}`);
        driverErrors++;
      }
    }

    await client.query('COMMIT');

    /* ── Done ───────────────────────────────────────────────────────────── */
    const result = {
      status: 'success',
      drivers_imported: driverCount,
      vehicles_imported: 0,
      driver_errors: driverErrors,
      message: `System is clean and ready. ${driverCount} drivers imported, 0 vehicles.`,
      ts: new Date(),
    };
    _fs0.writeFileSync(_resultFile, JSON.stringify(result, null, 2));
    console.log('\n==============================================');
    console.log('  System is clean and ready.');
    console.log('==============================================');
    console.log(`  ${driverCount} drivers imported`);
    console.log('  0 vehicles imported');
    if (driverErrors) console.log(`  ${driverErrors} driver rows had errors`);
    console.log('==============================================\n');

  } catch (err) {
    _fs0.writeFileSync(_resultFile, JSON.stringify({ status: 'error', error: err.message, ts: new Date() }, null, 2));
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFATAL:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

run();
