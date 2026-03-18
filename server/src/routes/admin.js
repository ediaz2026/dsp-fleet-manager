const router = require('express').Router();
const pool   = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const fs   = require('fs');
const path = require('path');
const csv  = require('csv-parse/sync');
const bcrypt = require('bcryptjs');

// Admin-only guard
router.use(authMiddleware);
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
});

// GET /api/admin/ping
router.get('/ping', (req, res) => res.json({ ok: true }));

// POST /api/admin/wipe-reimport
router.post('/wipe-reimport', async (req, res) => {
  const client = await pool.connect();
  const log = [];
  const push = (msg) => { log.push(msg); console.log(msg); };

  try {
    await client.query('BEGIN');

    /* ── Wipe vehicle-related tables ─────────────────────────────────── */
    await client.query('DELETE FROM inspection_photos');
    await client.query('DELETE FROM inspections');
    await client.query('DELETE FROM fleet_alerts');
    try { await client.query('DELETE FROM repairs'); } catch {}
    const { rowCount: vehicleCount } = await client.query('DELETE FROM vehicles');
    push(`Wiped ${vehicleCount} vehicles`);

    /* ── Wipe driver-related tables ──────────────────────────────────── */
    const { rows: driverStaff } = await client.query("SELECT id FROM staff WHERE role = 'driver'");
    const driverIds = driverStaff.map(r => r.id);

    if (driverIds.length > 0) {
      await client.query('DELETE FROM driver_recurring_shifts WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM day_schedule_drivers WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM staff_violations WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM payroll_records WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM attendance WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM shifts WHERE staff_id = ANY($1::int[])', [driverIds]);
      await client.query('DELETE FROM amazon_routes WHERE internal_staff_id = ANY($1::int[])', [driverIds]);
      try { await client.query('DELETE FROM driver_reports WHERE staff_id = ANY($1::int[])', [driverIds]); } catch {}
    }
    await client.query('DELETE FROM drivers');
    await client.query("DELETE FROM staff WHERE role = 'driver'");
    push(`Wiped ${driverIds.length} driver staff records`);

    /* ── Reimport drivers from CSV ───────────────────────────────────── */
    // Try multiple locations for the CSV
    const candidatePaths = [
      path.join(process.cwd(), 'AssociateData (2).csv'),
      path.join(__dirname, '..', '..', '..', 'AssociateData (2).csv'),
      path.join(__dirname, '..', '..', '..', '..', 'AssociateData (2).csv'),
    ];

    let csvPath = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) { csvPath = p; break; }
    }

    if (!csvPath) {
      await client.query('ROLLBACK');
      return res.status(500).json({
        error: 'AssociateData (2).csv not found on server',
        tried: candidatePaths,
        log,
      });
    }

    let content = fs.readFileSync(csvPath, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    const records = csv.parse(content, { columns: true, skip_empty_lines: true, trim: true });
    push(`Parsing ${records.length} rows from CSV`);

    const passwordHash = await bcrypt.hash('password123', 10);
    let driverCount = 0, driverErrors = [];

    for (const row of records) {
      try {
        const nameKey = Object.keys(row).find(k => k.replace(/^\uFEFF/, '').trim() === 'Name and ID') || Object.keys(row)[0];
        const fullName = (row[nameKey] || '').trim().replace(/\s+/g, ' ');
        if (!fullName) continue;

        const nameParts  = fullName.split(' ');
        const firstName  = nameParts[0];
        const lastName   = nameParts.slice(1).join(' ') || 'Unknown';
        const transponderId = (row['TransporterID'] || '').trim();
        const email         = (row['Email'] || '').trim().toLowerCase();
        const personalPhone = (row['Personal Phone Number'] || '').toString().trim();
        const status        = (row['Status'] || 'ACTIVE').trim().toUpperCase() === 'ACTIVE' ? 'active' : 'inactive';
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
        driverErrors.push(`${row['Name and ID'] || '?'}: ${err.message}`);
      }
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      drivers_imported: driverCount,
      vehicles_imported: 0,
      driver_errors: driverErrors,
      message: `✅ System clean and ready. ${driverCount} drivers imported, 0 vehicles (upload fleet file via Management → API Connections).`,
      log,
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: err.message, log });
  } finally {
    client.release();
  }
});

module.exports = router;
