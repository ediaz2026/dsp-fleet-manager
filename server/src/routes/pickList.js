const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const multer = require('multer');
const pdfParse = require('pdf-parse');

router.use(authMiddleware);

// Multer: memory storage for PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are accepted'));
  },
});

// Ensure pick_list_data table exists
pool.query(`
  CREATE TABLE IF NOT EXISTS pick_list_data (
    id SERIAL PRIMARY KEY,
    date DATE,
    route_code VARCHAR(50),
    vehicle_id VARCHAR(20),
    wave_time VARCHAR(20),
    bags INTEGER DEFAULT 0,
    overflow INTEGER DEFAULT 0,
    total_packages INTEGER DEFAULT 0,
    commercial_packages INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(date, route_code)
  )
`).catch(err => console.error('[pick-list] Table creation error:', err.message));

/**
 * Parse a pick list PDF.
 * Each route starts on a page beginning with "STG."
 * Continuation pages do NOT start with "STG."
 */
function parsePickListPages(pagesText) {
  // Group pages into routes
  const routeGroups = [];
  let currentGroup = null;

  for (const pageText of pagesText) {
    const trimmed = pageText.trim();
    if (trimmed.match(/^STG\./i)) {
      // New route starts
      if (currentGroup) routeGroups.push(currentGroup);
      currentGroup = [trimmed];
    } else if (currentGroup) {
      // Continuation page
      currentGroup.push(trimmed);
    }
    // If no currentGroup yet and page doesn't start with STG., skip it
  }
  if (currentGroup) routeGroups.push(currentGroup);

  const routes = [];

  for (const pages of routeGroups) {
    const fullText = pages.join('\n');
    const firstPage = pages[0];
    const lines = firstPage.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines.length < 3) continue;

    // Line 1: route_code (e.g. STG.R02.1)
    const route_code = lines[0].split(/\s/)[0].trim();

    // Line 2: vehicle_id + dsp_code (e.g. "CX1 LSMD" or "CX1 AEWW")
    const line2Tokens = lines[1].split(/\s+/);
    const vehicle_id = line2Tokens[0] || '';
    const dsp_code = line2Tokens[1] || '';

    // Line 3: wave_time and date
    const line3 = lines[2];
    const timeMatch = line3.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
    const wave_time = timeMatch ? timeMatch[1].trim() : '';
    const dateMatch = line3.match(/([A-Z]{3}\s+\d{1,2},?\s*\d{4})/i);
    const dateStr = dateMatch ? dateMatch[1].trim() : '';

    // Parse date
    let date = null;
    if (dateStr) {
      try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          date = d.toISOString().split('T')[0];
        }
      } catch {}
    }

    // Extract bags: "X bags" pattern
    const bagsMatch = fullText.match(/(\d+)\s+bags?/i);
    const bags = bagsMatch ? parseInt(bagsMatch[1]) : 0;

    // Extract overflow: "X overflow" pattern
    const overflowMatch = fullText.match(/(\d+)\s+overflow/i);
    const overflow = overflowMatch ? parseInt(overflowMatch[1]) : 0;

    // Extract total packages: "Total Packages X" or "Total Packages\nX"
    const totalPkgMatch = fullText.match(/Total\s+Packages\s*[:\s]*(\d+)/i);
    const total_packages = totalPkgMatch ? parseInt(totalPkgMatch[1]) : 0;

    // Extract commercial packages
    const commercialMatch = fullText.match(/Commercial\s+Packages\s*[:\s]*(\d+)/i);
    const commercial_packages = commercialMatch ? parseInt(commercialMatch[1]) : 0;

    routes.push({
      route_code,
      vehicle_id,
      dsp_code: dsp_code.toUpperCase(),
      wave_time,
      date,
      bags,
      overflow,
      total_packages,
      commercial_packages,
    });
  }

  return routes;
}

// POST /api/ops/upload-picklist — parse and store pick list PDF
router.post('/upload-picklist', managerOnly, upload.single('picklist'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    const pdf = await pdfParse(req.file.buffer);

    // pdf-parse gives us full text, but we need per-page text
    // Use the raw page data if available
    let pagesText = [];
    if (pdf.numpages && pdf.text) {
      // pdf-parse doesn't give per-page text directly, so we split by form-feed or re-parse
      // The text property contains all pages concatenated
      // We need to use the internal structure for per-page access
      // Workaround: split on common page-break patterns
      // Better approach: use the render callback
    }

    // Re-parse with per-page text extraction
    const perPageTexts = [];
    await pdfParse(req.file.buffer, {
      pagerender: async function(pageData) {
        const textContent = await pageData.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ');
        perPageTexts.push(text);
        return text;
      }
    });

    if (perPageTexts.length === 0) {
      // Fallback: try splitting by STG. markers
      const fullText = pdf.text || '';
      const parts = fullText.split(/(?=STG\.)/);
      for (const part of parts) {
        if (part.trim()) perPageTexts.push(part.trim());
      }
    }

    const allRoutes = parsePickListPages(perPageTexts);
    const lsmdRoutes = allRoutes.filter(r => r.dsp_code === 'LSMD');

    if (lsmdRoutes.length === 0) {
      return res.json({
        success: true,
        routes_found: allRoutes.length,
        lsmd_routes: 0,
        date: allRoutes[0]?.date || null,
        message: 'No LSMD routes found in pick list',
      });
    }

    // Upsert into pick_list_data
    for (const r of lsmdRoutes) {
      await pool.query(`
        INSERT INTO pick_list_data (date, route_code, vehicle_id, wave_time, bags, overflow, total_packages, commercial_packages)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (date, route_code) DO UPDATE SET
          vehicle_id = EXCLUDED.vehicle_id,
          wave_time = EXCLUDED.wave_time,
          bags = EXCLUDED.bags,
          overflow = EXCLUDED.overflow,
          total_packages = EXCLUDED.total_packages,
          commercial_packages = EXCLUDED.commercial_packages
      `, [r.date, r.route_code, r.vehicle_id, r.wave_time, r.bags, r.overflow, r.total_packages, r.commercial_packages]);
    }

    res.json({
      success: true,
      routes_found: allRoutes.length,
      lsmd_routes: lsmdRoutes.length,
      date: lsmdRoutes[0]?.date || null,
    });
  } catch (err) {
    console.error('[pick-list] Upload error:', err);
    res.status(500).json({ error: 'Failed to parse pick list: ' + err.message });
  }
});

// GET /api/ops/picklist?date=YYYY-MM-DD — retrieve pick list data for a date
router.get('/picklist', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required' });
  const { rows } = await pool.query('SELECT * FROM pick_list_data WHERE date = $1 ORDER BY route_code', [date]);
  res.json(rows);
});

module.exports = router;
