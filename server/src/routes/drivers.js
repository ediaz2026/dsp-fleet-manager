const router = require('express').Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { sendInvitationEmail } = require('../services/emailService');

router.use(authMiddleware);

// GET /api/drivers
router.get('/', async (req, res) => {
  // Drivers can only see their own profile
  const whereClause = req.user.role === 'driver' ? 'WHERE d.staff_id = $1' : '';
  const params = req.user.role === 'driver' ? [req.user.id] : [];
  const { rows } = await pool.query(
    `SELECT d.*, s.first_name, s.last_name, s.employee_id,
       s.email, s.personal_email, s.phone, s.role,
       s.status as employment_status, s.hire_date, s.is_rotating, s.employee_code,
       s.last_login, s.must_change_password, s.invitation_sent_at,
       (s.password_hash IS NOT NULL) as has_password,
       CASE WHEN d.license_expiration <= CURRENT_DATE + 60 THEN true ELSE false END as license_expiring
     FROM drivers d
     JOIN staff s ON s.id = d.staff_id
     ${whereClause}
     ORDER BY s.last_name, s.first_name`,
    params
  );
  res.json(rows);
});

// POST /api/drivers/create  — create a brand-new driver (staff + drivers row)
router.post('/create', managerOnly, async (req, res) => {
  const { first_name, last_name, email, personal_email, phone,
    role = 'driver', hire_date, employee_code, transponder_id,
    license_number, license_expiration, license_state, dob, notes } = req.body;
  if (!first_name || !last_name) return res.status(400).json({ error: 'first_name and last_name required' });
  if (!email) return res.status(400).json({ error: 'Work email is required for login' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const emp_id = transponder_id
      ? transponder_id.slice(0, 20)
      : `DRV${Date.now()}`.slice(0, 20);
    const workEmail = email.toLowerCase().trim();

    const { rows: sr } = await client.query(
      `INSERT INTO staff (employee_id, first_name, last_name, email, personal_email, phone,
         role, status, hire_date, employee_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)
       ON CONFLICT (email) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
         personal_email=EXCLUDED.personal_email, phone=EXCLUDED.phone, updated_at=NOW()
       RETURNING id`,
      [emp_id, first_name, last_name, workEmail,
       personal_email || null, phone || null, role, hire_date || null, employee_code || null]
    );
    const staffId = sr[0].id;
    const { rows: dr } = await client.query(
      `INSERT INTO drivers (staff_id, transponder_id, license_number, license_expiration, license_state, dob, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (staff_id) DO UPDATE SET transponder_id=EXCLUDED.transponder_id, updated_at=NOW()
       RETURNING *`,
      [staffId, transponder_id || null, license_number || null, license_expiration || null,
       license_state || null, dob || null, notes || null]
    );
    // Generate invitation token
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await client.query(
      'UPDATE staff SET invitation_token=$1, invitation_token_expiry=$2 WHERE id=$3',
      [invitationToken, invitationExpiry, staffId]
    );

    await client.query('COMMIT');
    logAudit(req, { action_type: 'CREATE_DRIVER', entity_type: 'staff', entity_id: staffId, entity_description: `Created driver ${first_name} ${last_name} (${workEmail})` });

    res.status(201).json({
      ...dr[0], first_name, last_name, email: workEmail,
      personal_email, phone, role, hire_date, employee_code, employment_status: 'active',
      has_password: false, must_change_password: false, invitation_sent_at: null,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// GET /api/drivers/recurring-overview  — all drivers + their recurring rows (for Settings view)
router.get('/recurring-overview', async (req, res) => {
  const { rows: driverRows } = await pool.query(
    `SELECT d.id, d.staff_id, s.first_name, s.last_name, s.employee_id, s.is_rotating
     FROM drivers d
     JOIN staff s ON s.id = d.staff_id
     ORDER BY s.last_name, s.first_name`
  );
  const { rows: recurringRows } = await pool.query(
    'SELECT * FROM driver_recurring_shifts ORDER BY staff_id, sort_order, id'
  );
  const result = driverRows.map(d => ({
    ...d,
    recurring_rows: recurringRows.filter(r => r.staff_id === d.staff_id),
  }));
  res.json(result);
});

// GET /api/drivers/:id
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, s.first_name, s.last_name, s.employee_id, s.email, s.phone,
       s.status as employment_status, s.hire_date, s.role, s.is_rotating
     FROM drivers d
     JOIN staff s ON s.id = d.staff_id
     WHERE d.id = $1 OR d.staff_id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Driver not found' });
  res.json(rows[0]);
});

// POST /api/drivers
router.post('/', managerOnly, async (req, res) => {
  const { staff_id, license_number, license_expiration, license_state, license_class,
    dob, transponder_id, emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
    address, city, state, zip, notes } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO drivers (staff_id, license_number, license_expiration, license_state, license_class,
      dob, transponder_id, emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
      address, city, state, zip, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [staff_id, license_number, license_expiration, license_state, license_class,
     dob, transponder_id, emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
     address, city, state, zip, notes]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/drivers/:id
router.put('/:id', managerOnly, async (req, res) => {
  const { license_number, license_expiration, license_state, license_class,
    dob, transponder_id, emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
    address, city, state, zip, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE drivers SET license_number=$1, license_expiration=$2, license_state=$3, license_class=$4,
     dob=$5, transponder_id=$6, emergency_contact_name=$7, emergency_contact_phone=$8,
     emergency_contact_relation=$9, address=$10, city=$11, state=$12, zip=$13, notes=$14, updated_at=NOW()
     WHERE id=$15 OR staff_id=$15 RETURNING *`,
    [license_number, license_expiration, license_state, license_class, dob, transponder_id,
     emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
     address, city, state, zip, notes, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

/* ─────────────────────────────────────────
   PER-DRIVER RECURRING SCHEDULE
───────────────────────────────────────── */

// GET /api/drivers/:staffId/recurring
router.get('/:staffId/recurring', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM driver_recurring_shifts WHERE staff_id=$1 ORDER BY sort_order, id',
    [req.params.staffId]
  );
  res.json(rows);
});

// POST /api/drivers/:staffId/recurring  — add a shift row
router.post('/:staffId/recurring', managerOnly, async (req, res) => {
  const {
    shift_type = 'EDV', start_time = '07:00', end_time = '17:00',
    sun = false, mon = false, tue = false, wed = false, thu = false, fri = false, sat = false,
  } = req.body;

  const { rows: orderRows } = await pool.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM driver_recurring_shifts WHERE staff_id=$1',
    [req.params.staffId]
  );

  const { rows } = await pool.query(
    `INSERT INTO driver_recurring_shifts
       (staff_id, shift_type, start_time, end_time, sun, mon, tue, wed, thu, fri, sat, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.params.staffId, shift_type, start_time, end_time,
     sun, mon, tue, wed, thu, fri, sat, orderRows[0].next]
  );
  res.status(201).json(rows[0]);
});

// PUT /api/drivers/:staffId/recurring/:rowId  — update a shift row
router.put('/:staffId/recurring/:rowId', managerOnly, async (req, res) => {
  const { shift_type, start_time, end_time, sun, mon, tue, wed, thu, fri, sat } = req.body;
  const { rows } = await pool.query(
    `UPDATE driver_recurring_shifts
     SET shift_type=$1, start_time=$2, end_time=$3,
         sun=$4, mon=$5, tue=$6, wed=$7, thu=$8, fri=$9, sat=$10
     WHERE id=$11 AND staff_id=$12 RETURNING *`,
    [shift_type, start_time, end_time, sun, mon, tue, wed, thu, fri, sat,
     req.params.rowId, req.params.staffId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Row not found' });
  res.json(rows[0]);
});

// DELETE /api/drivers/:staffId/recurring/:rowId  — remove a shift row
router.delete('/:staffId/recurring/:rowId', managerOnly, async (req, res) => {
  await pool.query(
    'DELETE FROM driver_recurring_shifts WHERE id=$1 AND staff_id=$2',
    [req.params.rowId, req.params.staffId]
  );
  res.json({ ok: true });
});

// POST /api/drivers/:staffId/recurring/apply-weekly — project recurring shifts into schedule
router.post('/:staffId/recurring/apply-weekly', managerOnly, async (req, res) => {
  const { applyCurrentWeek = false } = req.body;
  const staffId = req.params.staffId;

  const { rows: recurringShifts } = await pool.query(
    'SELECT * FROM driver_recurring_shifts WHERE staff_id=$1',
    [staffId]
  );
  if (recurringShifts.length === 0) return res.json({ created: 0, message: 'No recurring shifts configured' });

  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday
  const currentSunday = new Date(today);
  currentSunday.setDate(today.getDate() - dayOfWeek);
  currentSunday.setHours(0, 0, 0, 0);

  const startWeek = new Date(currentSunday);
  if (!applyCurrentWeek) startWeek.setDate(startWeek.getDate() + 7);

  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const WEEKS_FORWARD = 8;
  let created = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let w = 0; w < WEEKS_FORWARD; w++) {
      const weekStart = new Date(startWeek);
      weekStart.setDate(startWeek.getDate() + w * 7);
      for (const shift of recurringShifts) {
        for (let d = 0; d < 7; d++) {
          if (!shift[DAYS[d]]) continue;
          const shiftDate = new Date(weekStart);
          shiftDate.setDate(weekStart.getDate() + d);
          const dateStr = shiftDate.toISOString().split('T')[0];
          const result = await client.query(
            `INSERT INTO shifts (staff_id, shift_date, start_time, end_time, shift_type, status, publish_status)
             VALUES ($1,$2,$3,$4,$5,'scheduled','draft')
             ON CONFLICT (staff_id, shift_date) DO UPDATE SET
               shift_type = EXCLUDED.shift_type,
               start_time = EXCLUDED.start_time,
               end_time   = EXCLUDED.end_time
             WHERE shifts.publish_status != 'published'`,
            [staffId, dateStr, shift.start_time, shift.end_time, shift.shift_type]
          );
          created += result.rowCount;
        }
      }
    }
    await client.query('COMMIT');
    res.json({ created, message: `Applied ${created} shifts across ${WEEKS_FORWARD} weeks` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/drivers/:staffId/rotating  — toggle rotating flag
router.put('/:staffId/rotating', managerOnly, async (req, res) => {
  const { is_rotating } = req.body;
  await pool.query('UPDATE staff SET is_rotating=$1 WHERE id=$2', [is_rotating, req.params.staffId]);
  res.json({ ok: true, is_rotating });
});

// PUT /api/drivers/:staffId/status  — change employment status
router.put('/:staffId/status', managerOnly, async (req, res) => {
  const { status } = req.body;
  const allowed = ['active', 'inactive', 'suspended', 'terminated'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE staff SET status=$1, updated_at=NOW() WHERE id=$2', [status, req.params.staffId]);
    // Terminated: permanently delete recurring schedule + all future shifts/ops data
    if (status === 'terminated') {
      await client.query('DELETE FROM driver_recurring_shifts WHERE staff_id=$1', [req.params.staffId]);
      await client.query('DELETE FROM day_schedule_drivers    WHERE staff_id=$1', [req.params.staffId]);
      await client.query('DELETE FROM recurring_skip          WHERE staff_id=$1', [req.params.staffId]);
      // Remove future shifts (keep historical for records)
      await client.query(
        'DELETE FROM shifts WHERE staff_id=$1 AND shift_date >= CURRENT_DATE',
        [req.params.staffId]
      );
      // Remove future ops assignments (keep historical for records)
      await client.query(
        'DELETE FROM ops_assignments WHERE staff_id=$1 AND plan_date >= CURRENT_DATE',
        [req.params.staffId]
      );
    }
    await client.query('COMMIT');
    logAudit(req, { action_type: 'STATUS_CHANGE', entity_type: 'staff', entity_id: parseInt(req.params.staffId), entity_description: `Driver status changed to ${status}`, new_value: { status } });
    res.json({ ok: true, status });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/drivers/:staffId/reset-password  — generate temporary password
router.post('/:staffId/reset-password', managerOnly, async (req, res) => {
  // Generate a readable temp password
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const tempPassword = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const hash = await bcrypt.hash(tempPassword, 10);
  await pool.query(
    `UPDATE staff SET password_hash=$1, must_change_password=TRUE,
       failed_login_attempts=0, locked_until=NULL, updated_at=NOW()
     WHERE id=$2`,
    [hash, req.params.staffId]
  );
  logAudit(req, { action_type: 'RESET_PASSWORD', entity_type: 'staff', entity_id: parseInt(req.params.staffId), entity_description: `Password reset by ${req.user?.name}` });
  res.json({ ok: true, temp_password: tempPassword });
});

// PUT /api/drivers/:staffId/profile  — update both staff + drivers in one call
router.put('/:staffId/profile', managerOnly, async (req, res) => {
  const { first_name, last_name, email, personal_email, phone, role,
    hire_date, employee_code, transponder_id, license_number, license_expiration,
    license_state, dob, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE staff SET first_name=$1, last_name=$2, email=$3,
         personal_email=$4, phone=$5, role=$6, hire_date=$7, employee_code=$8, updated_at=NOW()
       WHERE id=$9`,
      [first_name, last_name, email,
       personal_email || null, phone || null, role || 'driver',
       hire_date || null, employee_code || null, req.params.staffId]
    );
    const { rows } = await client.query(
      `UPDATE drivers SET transponder_id=$1, license_number=$2, license_expiration=$3,
         license_state=$4, dob=$5, notes=$6, updated_at=NOW()
       WHERE staff_id=$7 RETURNING *`,
      [transponder_id || null, license_number || null, license_expiration || null,
       license_state || null, dob || null, notes || null, req.params.staffId]
    );
    await client.query('COMMIT');
    logAudit(req, { action_type: 'EDIT_DRIVER', entity_type: 'staff', entity_id: parseInt(req.params.staffId), entity_description: `Profile updated for ${first_name} ${last_name}` });
    res.json({ ok: true, driver: rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// GET /api/drivers/:staffId/attendance  — attendance history for a driver
router.get('/:staffId/attendance', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, s.first_name, s.last_name
     FROM attendance a
     JOIN staff s ON s.id = a.staff_id
     WHERE a.staff_id = $1
     ORDER BY a.attendance_date DESC
     LIMIT 50`,
    [req.params.staffId]
  );
  res.json(rows);
});

// DELETE /api/drivers/:staffId  — permanently delete driver
router.delete('/:staffId', managerOnly, async (req, res) => {
  const staffId = req.params.staffId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Capture name for audit log before deletion
    const { rows: who } = await client.query(
      'SELECT first_name, last_name FROM staff WHERE id=$1', [staffId]
    );
    const name = who[0] ? `${who[0].first_name} ${who[0].last_name}` : `#${staffId}`;

    // 1. Delete future shifts (keep historical for payroll records)
    await client.query(
      'DELETE FROM shifts WHERE staff_id=$1 AND shift_date >= CURRENT_DATE',
      [staffId]
    );
    // 2. Delete future ops assignments
    await client.query(
      'DELETE FROM ops_assignments WHERE staff_id=$1 AND plan_date >= CURRENT_DATE',
      [staffId]
    );
    // 3. Delete all recurring config
    await client.query('DELETE FROM driver_recurring_shifts WHERE staff_id=$1', [staffId]);
    await client.query('DELETE FROM recurring_skip          WHERE staff_id=$1', [staffId]);
    await client.query('DELETE FROM day_schedule_drivers    WHERE staff_id=$1', [staffId]);
    // 4. Nullify historical attendance + payroll (preserve records, remove FK reference)
    await client.query('UPDATE attendance       SET staff_id=NULL WHERE staff_id=$1', [staffId]);
    await client.query('UPDATE payroll_records  SET staff_id=NULL WHERE staff_id=$1', [staffId]);
    // 5. Hard delete the staff row (DB CASCADE handles drivers, past shifts, audit_log, etc.)
    await client.query("DELETE FROM staff WHERE id=$1 AND role='driver'", [staffId]);

    await client.query('COMMIT');
    logAudit(req, {
      action_type:        'DELETE_DRIVER',
      entity_type:        'staff',
      entity_id:          parseInt(staffId),
      entity_description: `Driver ${name} permanently deleted`,
    });
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/drivers/import  — bulk upsert from Paycom export (or our template)
// Auto-generates work email and creates user account for new drivers.
router.post('/import', managerOnly, async (req, res) => {
  const { rows: importRows = [] } = req.body;
  let created = 0, updated = 0, skipped = 0, accounts_created = 0, emails_updated = 0, emails_generated = 0;
  const errors = [];

  const defaultPassword = process.env.DRIVER_DEFAULT_PASSWORD || 'TempPass2026!';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  // Generate a unique work email for a driver: firstname.lastname@lastmiledsp.com
  const generateWorkEmail = async (firstName, lastName) => {
    const clean = (s) => s.toLowerCase().trim()
      .replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
    const base = `${clean(firstName)}.${clean(lastName)}@lastmiledsp.com`;
    const { rows: ex } = await pool.query('SELECT id FROM staff WHERE email=$1', [base]);
    if (!ex.length) return base;
    for (let i = 2; i <= 99; i++) {
      const candidate = `${clean(firstName)}.${clean(lastName)}${i}@lastmiledsp.com`;
      const { rows: ex2 } = await pool.query('SELECT id FROM staff WHERE email=$1', [candidate]);
      if (!ex2.length) return candidate;
    }
    return base;
  };

  // Parse M/D/YYYY, MM/DD/YYYY, or ISO dates → YYYY-MM-DD
  const parseDate = (d) => {
    if (!d) return null;
    try {
      const s = String(d).trim();
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
        const [m, day, yr] = s.split('/');
        return `${yr}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`;
      }
      const dt = new Date(s);
      if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
    } catch {}
    return null;
  };

  for (const row of importRows) {
    try {
      const transponder_id = String(row['DAProviderID'] || row['Transporter ID'] || row['transponder_id'] || '').trim();
      const first_name     = String(row['Legal_Firstname'] || row['First Name'] || row['first_name'] || '').trim();
      const last_name      = String(row['Legal_Lastname']  || row['Last Name']  || row['last_name']  || '').trim();
      if (!first_name || !last_name) { skipped++; continue; }

      const work_email     = String(row['Work Email'] || row['Email'] || '').trim().toLowerCase() || null;
      const personal_email = String(row['Personal Email'] || '').trim() || null;
      const phone          = String(row['Phone'] || row['Personal Phone Number'] || '').trim() || null;
      const raw_status     = String(row['Status'] || 'active').trim().toUpperCase();
      const emp_status     = raw_status === 'ACTIVE' ? 'active' : raw_status === 'SUSPENDED' ? 'suspended' : 'inactive';
      const license_number = row['DriversLicense'] || row['License Number'] || null;
      const raw_dob        = row['Birth_Date_(MM/DD/YYYY)'] || row['DOB'] || row['dob'] || null;
      const raw_lic_exp    = row['DLExpirationDate'] || row['License Expiration'] || null;
      const raw_hire       = row['Hire_Date'] || row['Hire Date'] || null;
      const employee_code  = String(row['Employee_Code'] || row['Employee Code'] || '').trim() || null;

      const dob              = parseDate(raw_dob);
      const license_expiration = parseDate(raw_lic_exp);
      const hire_date        = parseDate(raw_hire) || new Date().toISOString().slice(0, 10);

      // Find existing driver by transponder_id OR work email
      let existing = null;
      if (transponder_id) {
        const { rows: byId } = await pool.query(
          'SELECT d.id AS driver_id, d.staff_id FROM drivers d WHERE d.transponder_id=$1',
          [transponder_id]
        );
        existing = byId[0] || null;
      }
      if (!existing && work_email) {
        const { rows: byEmail } = await pool.query(
          'SELECT d.id AS driver_id, d.staff_id FROM drivers d JOIN staff s ON s.id=d.staff_id WHERE s.email=$1',
          [work_email]
        );
        existing = byEmail[0] || null;
      }

      if (existing) {
        // Update existing driver — update email only when file provides one
        if (work_email) {
          await pool.query(
            `UPDATE staff SET first_name=$1, last_name=$2, email=$3, personal_email=$4, phone=$5,
               status=$6, hire_date=$7, employee_code=$8, updated_at=NOW() WHERE id=$9`,
            [first_name, last_name, work_email, personal_email, phone, emp_status, hire_date, employee_code, existing.staff_id]
          );
          emails_updated++;
        } else {
          await pool.query(
            `UPDATE staff SET first_name=$1, last_name=$2, personal_email=$3, phone=$4,
               status=$5, hire_date=$6, employee_code=$7, updated_at=NOW() WHERE id=$8`,
            [first_name, last_name, personal_email, phone, emp_status, hire_date, employee_code, existing.staff_id]
          );
        }
        await pool.query(
          `UPDATE drivers SET transponder_id=COALESCE($1,transponder_id), license_number=$2,
             license_expiration=$3, dob=$4, updated_at=NOW() WHERE id=$5`,
          [transponder_id || null, license_number, license_expiration, dob, existing.driver_id]
        );
        updated++;
      } else {
        // New driver — auto-generate work email and create user account
        const emp_id      = transponder_id ? transponder_id.slice(0, 20) : `DRV${Date.now()}`.slice(0, 20);
        const generatedEmail = work_email ? null : await generateWorkEmail(first_name, last_name);
        const emailToUse  = work_email || generatedEmail;
        if (generatedEmail) emails_generated++;

        const { rows: newStaff } = await pool.query(
          `INSERT INTO staff (employee_id, first_name, last_name, email, personal_email, phone,
             role, status, hire_date, employee_code, password_hash, must_change_password, invitation_sent)
           VALUES ($1,$2,$3,$4,$5,$6,'driver',$7,$8,$9,$10,TRUE,FALSE)
           ON CONFLICT (email) DO UPDATE
             SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
                 status=EXCLUDED.status, updated_at=NOW()
           RETURNING id`,
          [emp_id, first_name, last_name, emailToUse, personal_email, phone,
           emp_status, hire_date, employee_code, passwordHash]
        );
        const staffId = newStaff[0].id;

        await pool.query(
          `INSERT INTO drivers (staff_id, transponder_id, license_number, license_expiration, dob)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (staff_id) DO UPDATE SET transponder_id=EXCLUDED.transponder_id, updated_at=NOW()`,
          [staffId, transponder_id || null, license_number, license_expiration, dob]
        );
        created++;
        accounts_created++;
        // Invitation email is sent separately via Management → Send Invitations.
        console.log(`[driver-import] Account created: ${emailToUse} (temp password set, must_change_password=true)`);
      }
    } catch (e) {
      errors.push(`Row ${row['Legal_Firstname'] || row['First Name'] || '?'} ${row['Legal_Lastname'] || row['Last Name'] || '?'}: ${e.message}`);
    }
  }

  res.json({ created, updated, skipped, accounts_created, emails_updated, emails_generated, errors });
});

module.exports = router;
