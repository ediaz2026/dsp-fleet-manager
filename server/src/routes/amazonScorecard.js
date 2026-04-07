const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const multer = require('multer');
const XLSX = require('xlsx');

router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Create table + add transporter_id column
pool.query(`
  CREATE TABLE IF NOT EXISTS amazon_scorecards (
    id SERIAL PRIMARY KEY,
    week_label VARCHAR(20) NOT NULL,
    amazon_week INT,
    year INT,
    staff_id INT REFERENCES staff(id),
    driver_name VARCHAR(200),
    transporter_id VARCHAR(50),
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
pool.query(`ALTER TABLE amazon_scorecards ADD COLUMN IF NOT EXISTS transporter_id VARCHAR(50)`).catch(() => {});
// Fix column types if table was created with wrong types
const fixCols = [
  'final_ranking DECIMAL(6,2)', 'speeding_score DECIMAL(6,2)', 'seatbelt_score DECIMAL(6,2)',
  'distraction_score DECIMAL(6,2)', 'sign_signal_score DECIMAL(6,2)', 'following_dist_score DECIMAL(6,2)',
  'dcr_score DECIMAL(6,2)', 'pod_rate DECIMAL(5,4)', 'perfect_incentive DECIMAL(10,2)',
  'incentive_per_package DECIMAL(10,2)', 'cdf_revised DECIMAL(6,2)', 'dsb_revised DECIMAL(6,2)',
  'rank_position DECIMAL(6,2)', 'packages DECIMAL(10,2)',
];
for (const c of fixCols) {
  const [name, ...type] = c.split(' ');
  pool.query(`ALTER TABLE amazon_scorecards ALTER COLUMN ${name} TYPE ${type.join(' ')} USING ${name}::${type.join(' ')}`).catch(() => {});
}
// Drop the problematic partial unique index — we handle dedup via DELETE before INSERT
pool.query(`DROP INDEX IF EXISTS idx_amazon_sc_week_name`).catch(() => {});

// POST /api/amazon-scorecard/upload — parse Excel with dynamic header detection
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

    // Row 2 = headers — find columns dynamically
    const headers = (raw[1] || []).map(h => String(h).trim().toUpperCase());
    const col = (patterns) => {
      for (const p of patterns) {
        const idx = headers.findIndex(h => h.includes(p));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    // Find columns dynamically, with hardcoded fallbacks matching known layout
    const tidCol = col(['TRANSPORTER ID', 'DA TRANSPORTER', 'TID', 'TRANSPORTER']);
    const COL = {
      rank:         col(['RANK', '#'])         >= 0 ? col(['RANK', '#'])         : 0,
      name:         col(['DRIVER', 'DELIVERY ASSOCIATE', 'DA NAME', 'NAME']) >= 0 ? col(['DRIVER', 'DELIVERY ASSOCIATE', 'DA NAME', 'NAME']) : 1,
      tid:          tidCol >= 0 ? tidCol : 2,  // Fallback: column C
      standing:     col(['OVERALL STANDING', 'STANDING'])   >= 0 ? col(['OVERALL STANDING', 'STANDING'])   : 3,
      ranking:      col(['FINAL RANKING', 'RANKING'])       >= 0 ? col(['FINAL RANKING', 'RANKING'])       : 4,
      bonus:        col(['BONUS HOURS', 'BONUS'])           >= 0 ? col(['BONUS HOURS', 'BONUS'])           : 5,
      safety:       col(['SAFETY', 'SAFETY PASS', 'SAFETY METRIC']) >= 0 ? col(['SAFETY', 'SAFETY PASS', 'SAFETY METRIC']) : 6,
      dsb:          col(['DSB PASS', 'DSB METRIC', 'DSB'])  >= 0 ? col(['DSB PASS', 'DSB METRIC', 'DSB'])  : 7,
      packages:     col(['PACKAGES', 'PKG', 'TOTAL PACKAGES']) >= 0 ? col(['PACKAGES', 'PKG', 'TOTAL PACKAGES']) : 8,
      perfect:      col(['PERFECT INCENTIVE', 'PERFECT'])   >= 0 ? col(['PERFECT INCENTIVE', 'PERFECT'])   : 9,
      perPkg:       col(['INCENTIVE PER PACKAGE', 'PER PACKAGE', 'PER PKG']) >= 0 ? col(['INCENTIVE PER PACKAGE', 'PER PACKAGE', 'PER PKG']) : 10,
      speeding:     col(['SPEEDING'])                       >= 0 ? col(['SPEEDING'])      : 11,
      seatbelt:     col(['SEATBELT', 'SEAT BELT'])          >= 0 ? col(['SEATBELT', 'SEAT BELT']) : 12,
      distraction:  col(['DISTRACTION'])                    >= 0 ? col(['DISTRACTION'])   : 13,
      signSignal:   col(['SIGN', 'SIGNAL', 'SIGN/SIGNAL']) >= 0 ? col(['SIGN', 'SIGNAL', 'SIGN/SIGNAL']) : 14,
      followDist:   col(['FOLLOWING', 'FOLLOW'])            >= 0 ? col(['FOLLOWING', 'FOLLOW']) : 15,
      cdf:          col(['CDF'])                            >= 0 ? col(['CDF'])           : 16,
      dcr:          col(['DCR'])                            >= 0 ? col(['DCR'])           : 17,
      dsbRevised:   col(['DSB REVISED', 'DSB REV'])         >= 0 ? col(['DSB REVISED', 'DSB REV']) : 18,
      pod:          col(['POD'])                            >= 0 ? col(['POD'])           : 19,
    };

    console.log('[scorecard] Headers found:', headers.join(' | '));
    console.log('[scorecard] TID column detected at index:', COL.tid, '(dynamic:', tidCol, ', header:', headers[COL.tid] || 'N/A', ')');
    console.log('[scorecard] Column mapping:', JSON.stringify(COL));

    // Get all drivers for TID + name matching
    const { rows: driverList } = await pool.query(`
      SELECT d.staff_id, d.transponder_id, s.first_name, s.last_name, s.employee_id
      FROM drivers d JOIN staff s ON s.id = d.staff_id WHERE s.role='driver'
    `);
    const tidToStaff = {};
    const nameToStaff = {};
    for (const d of driverList) {
      if (d.transponder_id) tidToStaff[d.transponder_id.trim().toUpperCase()] = d.staff_id;
      if (d.employee_id) tidToStaff[d.employee_id.trim().toUpperCase()] = d.staff_id;
      nameToStaff[`${d.first_name} ${d.last_name}`.toUpperCase()] = d.staff_id;
      nameToStaff[`${d.last_name}, ${d.first_name}`.toUpperCase()] = d.staff_id;
      // First name only match as last resort
      nameToStaff[`${d.first_name}`.toUpperCase()] = d.staff_id;
    }

    // Delete existing data for this week (allows clean re-upload)
    await pool.query(`DELETE FROM amazon_scorecards WHERE week_label = $1`, [weekLabel]);

    let uploaded = 0, matched = 0;
    const unmatched = [];
    const parseNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    const parseBool = (v) => /yes|pass|true|1/i.test(String(v));
    const getVal = (r, c) => c >= 0 ? r[c] : null;

    for (let i = 2; i < raw.length; i++) {
      const r = raw[i];
      const nameIdx = COL.name >= 0 ? COL.name : 1;
      const driverName = String(r[nameIdx] || '').trim();
      if (!driverName || /^(rank|#|driver|delivery)/i.test(driverName)) continue;

      const tid = COL.tid >= 0 ? String(r[COL.tid] || '').trim().toUpperCase() : '';

      // Match: TID first, then name
      let staffId = null;
      if (tid) staffId = tidToStaff[tid] || null;
      if (!staffId) staffId = nameToStaff[driverName.toUpperCase()] || null;
      // Try partial: first word of name
      if (!staffId) {
        const firstName = driverName.split(/\s+/)[0].toUpperCase();
        const lastName = driverName.split(/\s+/).slice(-1)[0].toUpperCase();
        staffId = nameToStaff[`${firstName} ${lastName}`.toUpperCase()] || null;
      }

      if (!staffId) {
        unmatched.push(`${driverName}${tid ? ` (${tid})` : ''}`);
        if (uploaded < 5) console.log(`[scorecard] UNMATCHED: "${driverName}" tid="${tid}"`);
      } else {
        matched++;
        if (uploaded < 5) console.log(`[scorecard] MATCHED: "${driverName}" tid="${tid}" → staff_id=${staffId}`);
      }

      await pool.query(`
        INSERT INTO amazon_scorecards (week_label, amazon_week, year, staff_id, driver_name, transporter_id,
          rank_position, overall_standing, final_ranking, bonus_hours, safety_pass, dsb_pass,
          packages, perfect_incentive, incentive_per_package,
          speeding_score, seatbelt_score, distraction_score, sign_signal_score, following_dist_score,
          cdf_revised, dcr_score, dsb_revised, pod_rate)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      `, [
        weekLabel, amazonWeek, year, staffId, driverName, tid || null,
        parseNum(getVal(r, COL.rank)),
        COL.standing >= 0 ? String(r[COL.standing] || '').trim() || null : null,
        parseNum(getVal(r, COL.ranking)),
        parseBool(getVal(r, COL.bonus)),
        parseBool(getVal(r, COL.safety)),
        parseBool(getVal(r, COL.dsb)),
        parseNum(getVal(r, COL.packages)),
        parseNum(getVal(r, COL.perfect)) || 0,
        parseNum(getVal(r, COL.perPkg)) || 0,
        parseNum(getVal(r, COL.speeding)),
        parseNum(getVal(r, COL.seatbelt)),
        parseNum(getVal(r, COL.distraction)),
        parseNum(getVal(r, COL.signSignal)),
        parseNum(getVal(r, COL.followDist)),
        parseNum(getVal(r, COL.cdf)) || 0,
        parseNum(getVal(r, COL.dcr)),
        parseNum(getVal(r, COL.dsbRevised)) || 0,
        parseNum(getVal(r, COL.pod)),
      ]);
      uploaded++;
    }

    res.json({ uploaded, matched, unmatched, weekLabel, columns: COL });
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
