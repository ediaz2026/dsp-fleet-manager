const router = require('express').Router();
const pool = require('../db/pool');
const { csvUpload } = require('../middleware/upload');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const csv = require('csv-parse/sync');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

router.use(authMiddleware);

// GET /api/amazon-routes
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT arf.*, s.first_name as uploader_first, s.last_name as uploader_last
     FROM amazon_route_files arf
     LEFT JOIN staff s ON s.id = arf.uploaded_by
     ORDER BY arf.created_at DESC LIMIT 30`
  );
  res.json(rows);
});

// GET /api/amazon-routes/:id/routes
router.get('/:id/routes', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ar.*, s.first_name as internal_first, s.last_name as internal_last, s.employee_id
     FROM amazon_routes ar
     LEFT JOIN staff s ON s.id = ar.internal_staff_id
     WHERE ar.route_file_id = $1
     ORDER BY ar.match_status, ar.route_code`,
    [req.params.id]
  );
  res.json(rows);
});

// POST /api/amazon-routes/upload
router.post('/upload', managerOnly, csvUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { route_date } = req.body;
  if (!route_date) return res.status(400).json({ error: 'route_date required' });

  const filePath = path.join(__dirname, '../../uploads/routes', req.file.filename);
  let records = [];

  try {
    if (req.file.mimetype.includes('csv') || req.file.originalname.endsWith('.csv')) {
      const content = fs.readFileSync(filePath, 'utf8');
      records = csv.parse(content, { columns: true, skip_empty_lines: true, trim: true });
    } else {
      const wb = xlsx.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      records = xlsx.utils.sheet_to_json(ws);
    }
  } catch (err) {
    return res.status(400).json({ error: `Failed to parse file: ${err.message}` });
  }

  // Normalize column names (Amazon files can have different headers)
  const normalize = (r) => {
    const keys = Object.keys(r);
    const find = (...patterns) => {
      for (const p of patterns) {
        const k = keys.find(k => k.toLowerCase().includes(p.toLowerCase()));
        if (k) return r[k]?.toString().trim() || '';
      }
      return '';
    };
    return {
      route_code: find('route', 'route_id', 'route_code'),
      driver_name: find('driver', 'name', 'associate'),
      driver_id: find('badge', 'id', 'employee_id'),
    };
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const fileRow = await client.query(
      `INSERT INTO amazon_route_files (file_name, route_date, uploaded_by)
       VALUES ($1,$2,$3) RETURNING id`,
      [req.file.originalname, route_date, req.user.id]
    );
    const fileId = fileRow.rows[0].id;

    // Get all active staff for matching
    const { rows: staffRows } = await client.query(
      `SELECT id, first_name, last_name, LOWER(first_name || ' ' || last_name) as full_name_lower
       FROM staff WHERE status = 'active' AND role = 'driver'`
    );

    let matched = 0, mismatched = 0, unmatched = 0;

    for (const rec of records) {
      const norm = normalize(rec);
      if (!norm.route_code) continue;

      // Try to match by name
      const nameLower = norm.driver_name.toLowerCase().trim();
      let internalStaff = staffRows.find(s => s.full_name_lower === nameLower);
      let matchStatus = 'unmatched';

      if (internalStaff) {
        matchStatus = 'matched';
        matched++;
      } else if (nameLower) {
        // Partial match attempt
        const partial = staffRows.find(s =>
          s.full_name_lower.includes(nameLower.split(' ')[0]) ||
          nameLower.includes(s.first_name.toLowerCase())
        );
        if (partial) {
          internalStaff = partial;
          matchStatus = 'mismatched';
          mismatched++;
        } else {
          unmatched++;
        }
      } else {
        unmatched++;
      }

      await client.query(
        `INSERT INTO amazon_routes (route_file_id, route_code, amazon_driver_name, amazon_driver_id, internal_staff_id, match_status, route_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [fileId, norm.route_code, norm.driver_name, norm.driver_id, internalStaff?.id || null, matchStatus, route_date]
      );
    }

    await client.query(
      `UPDATE amazon_route_files SET total_routes=$1, matched_routes=$2, mismatched_routes=$3, unmatched_routes=$4 WHERE id=$5`,
      [records.length, matched, mismatched, unmatched, fileId]
    );

    await client.query('COMMIT');
    res.status(201).json({ fileId, total: records.length, matched, mismatched, unmatched });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/amazon-routes/:fileId/match/:routeId - manual match
router.post('/:fileId/match/:routeId', managerOnly, async (req, res) => {
  const { staff_id } = req.body;
  await pool.query(
    `UPDATE amazon_routes SET internal_staff_id=$1, match_status='matched' WHERE id=$2 AND route_file_id=$3`,
    [staff_id, req.params.routeId, req.params.fileId]
  );
  // Recalculate file stats
  const stats = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE match_status='matched') as m,
            COUNT(*) FILTER (WHERE match_status='mismatched') as mm,
            COUNT(*) FILTER (WHERE match_status='unmatched') as u,
            COUNT(*) as total
     FROM amazon_routes WHERE route_file_id = $1`,
    [req.params.fileId]
  );
  const s = stats.rows[0];
  await pool.query(
    `UPDATE amazon_route_files SET matched_routes=$1, mismatched_routes=$2, unmatched_routes=$3 WHERE id=$4`,
    [s.m, s.mm, s.u, req.params.fileId]
  );
  res.json({ message: 'Matched' });
});

module.exports = router;
