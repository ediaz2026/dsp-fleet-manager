const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const multer = require('multer');
const XLSX = require('xlsx');

router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Create table
pool.query(`
  CREATE TABLE IF NOT EXISTS amazon_scorecards (
    id SERIAL PRIMARY KEY,
    week_label VARCHAR(20) NOT NULL,
    amazon_week INT,
    year INT,
    staff_id INT REFERENCES staff(id),
    driver_name VARCHAR(200),
    rank_position INT,
    overall_standing VARCHAR(50),
    final_ranking DECIMAL(6,2),
    bonus_hours BOOLEAN DEFAULT false,
    safety_pass BOOLEAN DEFAULT false,
    dsb_pass BOOLEAN DEFAULT false,
    packages INT,
    perfect_incentive DECIMAL(10,2) DEFAULT 0,
    incentive_per_package DECIMAL(10,2) DEFAULT 0,
    speeding_score DECIMAL(6,2),
    seatbelt_score DECIMAL(6,2),
    distraction_score DECIMAL(6,2),
    sign_signal_score DECIMAL(6,2),
    following_dist_score DECIMAL(6,2),
    cdf_revised INT DEFAULT 0,
    dcr_score DECIMAL(6,2),
    dsb_revised INT DEFAULT 0,
    pod_rate DECIMAL(5,4),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(week_label, staff_id)
  )
`).catch(e => console.error('[amazon-scorecard] Table error:', e.message));
// Also allow week_label + driver_name unique for unmatched drivers
pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_amazon_sc_week_name ON amazon_scorecards (week_label, driver_name) WHERE staff_id IS NULL`).catch(() => {});

// POST /api/amazon-scorecard/upload — parse Excel and upsert
router.post('/upload', adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (raw.length < 3) return res.status(400).json({ error: 'File has fewer than 3 rows' });

    // Row 1 col B = week label
    const weekLabel = String(raw[0]?.[1] || '').trim() || 'Unknown';
    const weekMatch = weekLabel.match(/(\d+)/);
    const amazonWeek = weekMatch ? parseInt(weekMatch[1]) : null;
    const year = new Date().getFullYear();

    // Get all staff for name matching
    const { rows: staffList } = await pool.query(`SELECT id, first_name, last_name FROM staff WHERE role='driver'`);
    const staffByName = {};
    for (const s of staffList) {
      staffByName[`${s.first_name} ${s.last_name}`.toUpperCase()] = s.id;
      staffByName[`${s.last_name}, ${s.first_name}`.toUpperCase()] = s.id;
    }

    let uploaded = 0, matched = 0;
    const unmatched = [];

    // Rows 3+ = data (index 2+)
    for (let i = 2; i < raw.length; i++) {
      const r = raw[i];
      if (!r[1]) continue; // skip empty name rows
      const driverName = String(r[1]).trim();
      if (!driverName || /^(rank|#|driver)/i.test(driverName)) continue;

      const staffId = staffByName[driverName.toUpperCase()] || null;
      if (!staffId) unmatched.push(driverName);
      else matched++;

      const parseNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
      const parseBool = (v) => /yes|pass|true|1/i.test(String(v));

      await pool.query(`
        INSERT INTO amazon_scorecards (week_label, amazon_week, year, staff_id, driver_name,
          rank_position, overall_standing, final_ranking, bonus_hours, safety_pass, dsb_pass,
          packages, perfect_incentive, incentive_per_package,
          speeding_score, seatbelt_score, distraction_score, sign_signal_score, following_dist_score,
          cdf_revised, dcr_score, dsb_revised, pod_rate)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (week_label, staff_id) DO UPDATE SET
          driver_name=EXCLUDED.driver_name, rank_position=EXCLUDED.rank_position,
          overall_standing=EXCLUDED.overall_standing, final_ranking=EXCLUDED.final_ranking,
          bonus_hours=EXCLUDED.bonus_hours, safety_pass=EXCLUDED.safety_pass, dsb_pass=EXCLUDED.dsb_pass,
          packages=EXCLUDED.packages, perfect_incentive=EXCLUDED.perfect_incentive,
          incentive_per_package=EXCLUDED.incentive_per_package,
          speeding_score=EXCLUDED.speeding_score, seatbelt_score=EXCLUDED.seatbelt_score,
          distraction_score=EXCLUDED.distraction_score, sign_signal_score=EXCLUDED.sign_signal_score,
          following_dist_score=EXCLUDED.following_dist_score,
          cdf_revised=EXCLUDED.cdf_revised, dcr_score=EXCLUDED.dcr_score,
          dsb_revised=EXCLUDED.dsb_revised, pod_rate=EXCLUDED.pod_rate
      `, [
        weekLabel, amazonWeek, year, staffId, driverName,
        parseNum(r[0]), String(r[2] || '').trim() || null, parseNum(r[3]),
        parseBool(r[4]), parseBool(r[5]), parseBool(r[6]),
        parseNum(r[7]), parseNum(r[8]) || 0, parseNum(r[9]) || 0,
        parseNum(r[10]), parseNum(r[11]), parseNum(r[12]), parseNum(r[13]), parseNum(r[14]),
        parseInt(r[15]) || 0, parseNum(r[16]), parseInt(r[17]) || 0, parseNum(r[18]),
      ]);
      uploaded++;
    }

    res.json({ uploaded, matched, unmatched, weekLabel });
  } catch (err) {
    console.error('[amazon-scorecard/upload]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/amazon-scorecard/weeks — available weeks
router.get('/weeks', async (req, res) => {
  const { rows } = await pool.query(`SELECT DISTINCT week_label, amazon_week, year, MIN(created_at) AS uploaded_at FROM amazon_scorecards GROUP BY week_label, amazon_week, year ORDER BY year DESC, amazon_week DESC`);
  res.json(rows);
});

// GET /api/amazon-scorecard/mine — driver's own scorecard
router.get('/mine', async (req, res) => {
  const { week } = req.query;
  let row;
  if (week) {
    const { rows } = await pool.query(`SELECT * FROM amazon_scorecards WHERE staff_id=$1 AND week_label=$2`, [req.user.id, week]);
    row = rows[0];
  } else {
    const { rows } = await pool.query(`SELECT * FROM amazon_scorecards WHERE staff_id=$1 ORDER BY year DESC, amazon_week DESC LIMIT 1`, [req.user.id]);
    row = rows[0];
  }
  res.json(row || null);
});

// GET /api/amazon-scorecard?week=Week+11 — all drivers for a week (managers)
router.get('/', async (req, res) => {
  const { week } = req.query;
  if (!week) return res.status(400).json({ error: 'week param required' });
  const { rows } = await pool.query(`SELECT * FROM amazon_scorecards WHERE week_label=$1 ORDER BY rank_position`, [week]);
  res.json(rows);
});

module.exports = router;
