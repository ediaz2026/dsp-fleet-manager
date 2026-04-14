const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const multer = require('multer');
const XLSX = require('xlsx');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = false;

async function extractTextFromPDF(buffer) {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

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
pool.query(`ALTER TABLE amazon_scorecards ADD COLUMN IF NOT EXISTS scorecard_type VARCHAR NOT NULL DEFAULT 'final'`).catch(() => {});
pool.query(`ALTER TABLE amazon_scorecards ALTER COLUMN packages TYPE INTEGER USING packages::INTEGER`).catch(() => {});
pool.query(`ALTER TABLE amazon_scorecards ALTER COLUMN rank_position TYPE INTEGER USING rank_position::INTEGER`).catch(() => {});
// Fix column types if table was created with wrong types
const fixCols = [
  'final_ranking DECIMAL(6,2)', 'speeding_score DECIMAL(6,2)', 'seatbelt_score DECIMAL(6,2)',
  'distraction_score DECIMAL(6,2)', 'sign_signal_score DECIMAL(6,2)', 'following_dist_score DECIMAL(6,2)',
  'dcr_score DECIMAL(6,2)', 'pod_rate DECIMAL(5,4)', 'perfect_incentive DECIMAL(10,2)',
  'incentive_per_package DECIMAL(10,2)', 'cdf_revised DECIMAL(6,2)', 'dsb_revised DECIMAL(6,2)',
];
for (const c of fixCols) {
  const [name, ...type] = c.split(' ');
  pool.query(`ALTER TABLE amazon_scorecards ALTER COLUMN ${name} TYPE ${type.join(' ')} USING ${name}::${type.join(' ')}`).catch(() => {});
}
pool.query(`DROP INDEX IF EXISTS idx_amazon_sc_week_name`).catch(() => {});

// Migrate unique constraint to include scorecard_type
pool.query(`ALTER TABLE amazon_scorecards DROP CONSTRAINT IF EXISTS amazon_scorecards_week_label_staff_id_key`).catch(() => {});
pool.query(`
  DO $$ BEGIN
    ALTER TABLE amazon_scorecards ADD CONSTRAINT amazon_scorecards_week_label_staff_id_type_key
      UNIQUE (week_label, staff_id, scorecard_type);
  EXCEPTION WHEN duplicate_table THEN NULL; WHEN others THEN NULL;
  END $$;
`).catch(() => {});

// Drop legacy PDF table
pool.query(`DROP TABLE IF EXISTS scorecard_pdfs`).catch(() => {});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function matchDriver(driverName, tid, tidToStaff, nameToStaff) {
  let staffId = null;
  if (tid) staffId = tidToStaff[tid.trim().toUpperCase()] || null;
  if (!staffId) staffId = nameToStaff[driverName.toUpperCase()] || null;
  if (!staffId) {
    const parts = driverName.split(/\s+/);
    const first = parts[0]?.toUpperCase();
    const last = parts[parts.length - 1]?.toUpperCase();
    if (first && last) staffId = nameToStaff[`${first} ${last}`] || null;
  }
  return staffId;
}

async function getDriverMaps() {
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
    nameToStaff[`${d.first_name}`.toUpperCase()] = d.staff_id;
  }
  return { tidToStaff, nameToStaff };
}

// ── POST /api/amazon-scorecard/upload — parse Excel (Final Scorecard) ───────
router.post('/upload', adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (raw.length < 3) return res.status(400).json({ error: 'File has fewer than 3 rows' });

    const weekLabel = String(raw[0]?.[1] || '').trim() || 'Unknown';
    const weekMatch = weekLabel.match(/(\d+)/);
    const amazonWeek = weekMatch ? parseInt(weekMatch[1]) : null;
    const year = new Date().getFullYear();

    const headers = (raw[1] || []).map(h => String(h).trim().toUpperCase());
    const col = (patterns) => {
      for (const p of patterns) {
        const idx = headers.findIndex(h => h.includes(p));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const tidCol = col(['TRANSPORTER ID', 'DA TRANSPORTER', 'TID', 'TRANSPORTER']);
    const COL = {
      rank: 0,
      name: col(['DRIVER', 'DELIVERY ASSOCIATE', 'DA NAME', 'NAME']) >= 0 ? col(['DRIVER', 'DELIVERY ASSOCIATE', 'DA NAME', 'NAME']) : 1,
      tid: tidCol >= 0 ? tidCol : 2,
      standing: col(['OVERALL STANDING', 'STANDING']) >= 0 ? col(['OVERALL STANDING', 'STANDING']) : 3,
      ranking: col(['FINAL RANKING', 'RANKING']) >= 0 ? col(['FINAL RANKING', 'RANKING']) : 4,
      bonus: col(['BONUS HOURS', 'BONUS']) >= 0 ? col(['BONUS HOURS', 'BONUS']) : 5,
      safety: col(['SAFETY', 'SAFETY PASS', 'SAFETY METRIC']) >= 0 ? col(['SAFETY', 'SAFETY PASS', 'SAFETY METRIC']) : 6,
      dsb: col(['DSB PASS', 'DSB METRIC', 'DSB']) >= 0 ? col(['DSB PASS', 'DSB METRIC', 'DSB']) : 7,
      packages: col(['PACKAGES', 'PKG', 'TOTAL PACKAGES']) >= 0 ? col(['PACKAGES', 'PKG', 'TOTAL PACKAGES']) : 8,
      perfect: col(['PERFECT INCENTIVE', 'PERFECT']) >= 0 ? col(['PERFECT INCENTIVE', 'PERFECT']) : 9,
      perPkg: col(['INCENTIVE PER PACKAGE', 'PER PACKAGE', 'PER PKG']) >= 0 ? col(['INCENTIVE PER PACKAGE', 'PER PACKAGE', 'PER PKG']) : 10,
      speeding: col(['SPEEDING']) >= 0 ? col(['SPEEDING']) : 11,
      seatbelt: col(['SEATBELT', 'SEAT BELT']) >= 0 ? col(['SEATBELT', 'SEAT BELT']) : 12,
      distraction: col(['DISTRACTION']) >= 0 ? col(['DISTRACTION']) : 13,
      signSignal: col(['SIGN', 'SIGNAL', 'SIGN/SIGNAL']) >= 0 ? col(['SIGN', 'SIGNAL', 'SIGN/SIGNAL']) : 14,
      followDist: col(['FOLLOWING', 'FOLLOW']) >= 0 ? col(['FOLLOWING', 'FOLLOW']) : 15,
      cdf: col(['CDF']) >= 0 ? col(['CDF']) : 16,
      dcr: col(['DCR']) >= 0 ? col(['DCR']) : 17,
      dsbRevised: col(['DSB REVISED', 'DSB REV']) >= 0 ? col(['DSB REVISED', 'DSB REV']) : 18,
      pod: col(['POD']) >= 0 ? col(['POD']) : 19,
    };

    const { tidToStaff, nameToStaff } = await getDriverMaps();

    await pool.query(`DELETE FROM amazon_scorecards WHERE week_label = $1 AND scorecard_type = 'final'`, [weekLabel]);

    let uploaded = 0, matched = 0;
    const unmatched = [];
    const parseNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    const parseBool = (v) => /yes|pass|true|1/i.test(String(v));
    const getVal = (r, c) => c >= 0 ? r[c] : null;

    for (let i = 2; i < raw.length; i++) {
      const r = raw[i];
      const driverName = String(r[COL.name] || '').trim();
      if (!driverName || /^(rank|#|driver|delivery)/i.test(driverName)) continue;

      const tid = COL.tid >= 0 ? String(r[COL.tid] || '').trim().toUpperCase() : '';
      const staffId = await matchDriver(driverName, tid, tidToStaff, nameToStaff);

      const rankVal = parseInt(r[0]);
      const rankToStore = !isNaN(rankVal) ? rankVal : (uploaded + 1);
      if (!staffId) unmatched.push(`${driverName}${tid ? ` (${tid})` : ''}`);
      else matched++;

      await pool.query(`
        INSERT INTO amazon_scorecards (week_label, amazon_week, year, staff_id, driver_name, transporter_id,
          rank_position, overall_standing, final_ranking, bonus_hours, safety_pass, dsb_pass,
          packages, perfect_incentive, incentive_per_package,
          speeding_score, seatbelt_score, distraction_score, sign_signal_score, following_dist_score,
          cdf_revised, dcr_score, dsb_revised, pod_rate, scorecard_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'final')
      `, [
        weekLabel, amazonWeek, year, staffId, driverName, tid || null,
        rankToStore,
        COL.standing >= 0 ? String(r[COL.standing] || '').trim() || null : null,
        parseNum(getVal(r, COL.ranking)),
        parseBool(getVal(r, COL.bonus)),
        parseBool(getVal(r, COL.safety)),
        parseBool(getVal(r, COL.dsb)),
        parseInt(getVal(r, COL.packages)) || null,
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

    res.json({ uploaded, matched, unmatched, weekLabel, scorecard_type: 'final', columns: COL });
  } catch (err) {
    console.error('[amazon-scorecard/upload]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/amazon-scorecard/upload-pdf — parse Pre Dispute PDF ───────────
router.post('/upload-pdf', adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const text = await extractTextFromPDF(req.file.buffer);

    // Extract week and year
    const weekMatch = text.match(/Week\s+(\d+)/i);
    const yearMatch = text.match(/\b(202\d)\b/);
    if (!weekMatch) return res.status(400).json({ error: 'Could not find week number in PDF' });

    const amazonWeek = parseInt(weekMatch[1]);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
    const weekLabel = `Week ${amazonWeek}`;

    console.log(`[scorecard-pdf] Parsing ${weekLabel} ${year}`);

    // Parse driver rows from text
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const tidPattern = /^[A-Z0-9]{10,20}$/;
    const drivers = [];
    const parseNum = (v) => {
      if (!v || v === '-' || /no\s*data/i.test(v)) return null;
      const cleaned = String(v).replace(/[%,]/g, '').trim();
      const n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    };

    // Strategy: find lines that start with a number (rank) and try to extract a row
    // The PDF text typically flows: rank, name, tid, then numeric values
    // We'll collect all tokens and walk through them
    const allTokens = [];
    for (const line of lines) {
      // Split on whitespace but keep "No Data" as single token
      const tokens = line.replace(/No\s+Data/gi, 'NoData').split(/\s+/);
      allTokens.push(...tokens);
    }

    let idx = 0;
    while (idx < allTokens.length) {
      const rankStr = allTokens[idx];
      const rank = parseInt(rankStr);
      if (isNaN(rank) || rank < 1 || rank > 200) { idx++; continue; }

      // Collect name tokens until we hit a TID-like pattern
      let nameTokens = [];
      let tid = '';
      let j = idx + 1;

      while (j < allTokens.length) {
        if (tidPattern.test(allTokens[j])) {
          tid = allTokens[j];
          j++;
          break;
        }
        // If we hit a number and already have name tokens, this might be data not a name
        if (nameTokens.length >= 2 && /^\d+\.?\d*$/.test(allTokens[j])) break;
        nameTokens.push(allTokens[j]);
        j++;
        if (nameTokens.length > 8) break; // safety limit
      }

      const driverName = nameTokens.join(' ');
      if (!driverName || nameTokens.length === 0 || !tid) { idx++; continue; }

      // Read numeric values: Delivered, FICO, Seatbelt, Speeding, Distraction, FollowDist, SignSignal, CDF, CED, DCR, DSB, POD, PSB, DSBCount, PODOpps
      const vals = [];
      while (j < allTokens.length && vals.length < 17) {
        const v = allTokens[j];
        if (/^[A-Z][a-z]/.test(v) && !v.startsWith('No') && vals.length > 3) break; // hit next name
        if (/^\d{1,3}$/.test(v) && vals.length > 5 && parseInt(v) >= 1 && parseInt(v) <= 200) {
          // Might be next rank — check if followed by name-like tokens
          const nextFew = allTokens.slice(j + 1, j + 4).join(' ');
          if (/[a-z]/i.test(nextFew) && tidPattern.test(allTokens[j + 2] || allTokens[j + 3] || '')) break;
        }
        vals.push(v === 'NoData' ? null : v);
        j++;
      }

      if (vals.length >= 8) {
        drivers.push({
          rank, driverName, tid,
          packages: parseInt(vals[0]) || null,
          // vals[1] = FICO (skip)
          seatbelt: parseNum(vals[2]),
          speeding: parseNum(vals[3]),
          distraction: parseNum(vals[4]),
          followDist: parseNum(vals[5]),
          signSignal: parseNum(vals[6]),
          cdf: parseNum(vals[7]),
          // vals[8] = CED
          dcr: parseNum(vals[9]),
          dsb: parseNum(vals[10]),
          pod: vals[11] ? parseNum(vals[11]) : null,
        });
      }

      idx = j;
    }

    console.log(`[scorecard-pdf] Parsed ${drivers.length} driver rows`);

    if (drivers.length === 0) {
      return res.status(400).json({ error: 'Could not parse any driver rows from PDF. The PDF format may not be supported.' });
    }

    const { tidToStaff, nameToStaff } = await getDriverMaps();

    // Delete existing pre_dispute data for this week
    await pool.query(`DELETE FROM amazon_scorecards WHERE week_label = $1 AND scorecard_type = 'pre_dispute'`, [weekLabel]);

    let uploaded = 0, matched = 0;
    const unmatchedNames = [];

    for (const d of drivers) {
      const staffId = await matchDriver(d.driverName, d.tid, tidToStaff, nameToStaff);
      if (staffId) matched++;
      else unmatchedNames.push(`${d.driverName} (${d.tid})`);

      // Normalize POD: if > 1, it's a percentage (e.g. 99.5 → 0.995)
      let podVal = d.pod;
      if (podVal != null && podVal > 1) podVal = podVal / 100;

      // Normalize DCR: stored as percentage number (e.g. 99.72)
      const dcrVal = d.dcr;

      await pool.query(`
        INSERT INTO amazon_scorecards (week_label, amazon_week, year, staff_id, driver_name, transporter_id,
          rank_position, packages, seatbelt_score, speeding_score, distraction_score,
          following_dist_score, sign_signal_score, cdf_revised, dcr_score, dsb_revised, pod_rate,
          scorecard_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pre_dispute')
      `, [
        weekLabel, amazonWeek, year, staffId, d.driverName, d.tid,
        d.rank, d.packages, d.seatbelt, d.speeding, d.distraction,
        d.followDist, d.signSignal, d.cdf || 0, dcrVal, d.dsb || 0, podVal,
      ]);
      uploaded++;
    }

    console.log(`[scorecard-pdf] Inserted ${uploaded} rows, ${matched} matched, ${unmatchedNames.length} unmatched`);
    res.json({ uploaded, matched, unmatched: unmatchedNames, weekLabel, scorecard_type: 'pre_dispute' });
  } catch (err) {
    console.error('[amazon-scorecard/upload-pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET endpoints ───────────────────────────────────────────────────────────

// GET /api/amazon-scorecard/weeks — available weeks (either type)
router.get('/weeks', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT week_label, amazon_week, year, MIN(created_at) AS uploaded_at
    FROM amazon_scorecards GROUP BY week_label, amazon_week, year
    ORDER BY year DESC, amazon_week DESC
  `);
  res.json(rows);
});

// GET /api/amazon-scorecard/mine — driver's own scorecard
router.get('/mine', async (req, res) => {
  const { week, type = 'final' } = req.query;
  let row;
  if (week) {
    const { rows } = await pool.query(
      `SELECT * FROM amazon_scorecards WHERE staff_id=$1 AND week_label=$2 AND scorecard_type=$3`,
      [req.user.id, week, type]
    );
    row = rows[0];
  } else {
    const { rows } = await pool.query(
      `SELECT * FROM amazon_scorecards WHERE staff_id=$1 AND scorecard_type=$2 ORDER BY year DESC, amazon_week DESC LIMIT 1`,
      [req.user.id, type]
    );
    row = rows[0];
  }
  res.json(row || null);
});

// GET /api/amazon-scorecard?week=Week+11&type=final — all drivers for a week
router.get('/', async (req, res) => {
  const { week, type = 'final' } = req.query;
  if (!week) return res.status(400).json({ error: 'week param required' });
  const { rows } = await pool.query(
    `SELECT * FROM amazon_scorecards WHERE week_label=$1 AND scorecard_type=$2 ORDER BY rank_position`,
    [week, type]
  );
  res.json(rows);
});

module.exports = router;
