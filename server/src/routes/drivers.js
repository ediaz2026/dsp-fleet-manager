const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');

router.use(authMiddleware);

// GET /api/drivers
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, s.first_name, s.last_name, s.employee_id, s.email, s.phone, s.status as employment_status, s.hire_date,
       CASE WHEN d.license_expiration <= CURRENT_DATE + 60 THEN true ELSE false END as license_expiring
     FROM drivers d
     JOIN staff s ON s.id = d.staff_id
     ORDER BY s.last_name, s.first_name`
  );
  res.json(rows);
});

// GET /api/drivers/:id
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, s.first_name, s.last_name, s.employee_id, s.email, s.phone,
       s.status as employment_status, s.hire_date, s.role
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

module.exports = router;
