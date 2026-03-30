const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// Ensure pick_list_data table exists + raw_text column
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
    raw_text TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(date, route_code)
  )
`).catch(err => console.error('[pick-list] Table creation error:', err.message));
pool.query(`ALTER TABLE pick_list_data ADD COLUMN IF NOT EXISTS raw_text TEXT`).catch(() => {});

// Python script for PDF parsing via pdfplumber
const PYTHON_SCRIPT = `
import sys
import json
import re
import pdfplumber

pdf_path = sys.argv[1]
routes = []
current_route = None
current_text = []

with pdfplumber.open(pdf_path) as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if not text:
            continue
        lines = text.strip().split('\\n')
        first_line = lines[0].strip()

        if first_line.startswith('STG.'):
            if current_route and current_text:
                routes.append({'first_line': current_route, 'text': '\\n'.join(current_text)})
            current_route = first_line
            current_text = [text]
        else:
            if current_route:
                current_text.append(text)

    if current_route and current_text:
        routes.append({'first_line': current_route, 'text': '\\n'.join(current_text)})

results = []
for route in routes:
    text = route['text']
    lines = text.split('\\n')
    first_line = route['first_line']

    # Route code: first token of first line
    route_code = first_line.split()[0].strip()

    # Line 2: vehicle_id + dsp_code
    vehicle_id = ''
    dsp_code = ''
    if len(lines) > 1:
        tokens = lines[1].split()
        if len(tokens) >= 1:
            vehicle_id = tokens[0]
        if len(tokens) >= 2:
            dsp_code = tokens[1].upper()

    # Also check all lines for LSMD (sometimes formatting varies)
    if dsp_code != 'LSMD':
        for line in lines[:5]:
            if 'LSMD' in line.upper():
                dsp_code = 'LSMD'
                break

    # Wave time
    wave_time = ''
    date_str = ''
    for line in lines[:5]:
        time_match = re.search(r'(\\d{1,2}:\\d{2}\\s*[AP]M)', line, re.IGNORECASE)
        if time_match:
            wave_time = time_match.group(1).strip()
        date_match = re.search(r'([A-Z]{3}\\s+\\d{1,2},?\\s*\\d{4})', line, re.IGNORECASE)
        if date_match:
            date_str = date_match.group(1).strip()

    # Parse date
    parsed_date = None
    if date_str:
        try:
            from datetime import datetime
            # Handle "MAR 29, 2026" or "MAR 29 2026"
            cleaned = date_str.replace(',', '')
            parsed_date = datetime.strptime(cleaned, '%b %d %Y').strftime('%Y-%m-%d')
        except:
            pass

    # Bags, overflow, packages from full text
    bags = 0
    overflow = 0
    total_packages = 0
    commercial_packages = 0

    bags_match = re.search(r'(\\d+)\\s+bags?', text, re.IGNORECASE)
    if bags_match:
        bags = int(bags_match.group(1))

    overflow_match = re.search(r'(\\d+)\\s+over(?:flow)?', text, re.IGNORECASE)
    if overflow_match:
        overflow = int(overflow_match.group(1))

    total_match = re.search(r'Total\\s+Packages\\s*[:\\s]*(\\d+)', text, re.IGNORECASE)
    if total_match:
        total_packages = int(total_match.group(1))

    commercial_match = re.search(r'Commercial\\s+Packages\\s*[:\\s]*(\\d+)', text, re.IGNORECASE)
    if commercial_match:
        commercial_packages = int(commercial_match.group(1))

    results.append({
        'route_code': route_code,
        'vehicle_id': vehicle_id,
        'dsp_code': dsp_code,
        'wave_time': wave_time,
        'date': parsed_date,
        'bags': bags,
        'overflow': overflow,
        'total_packages': total_packages,
        'commercial_packages': commercial_packages,
        'raw_text': text,
    })

print(json.dumps(results))
`;

// Write the Python script once at startup
const scriptPath = path.join(os.tmpdir(), 'parse_picklist.py');
fs.writeFileSync(scriptPath, PYTHON_SCRIPT);

/**
 * Run the Python PDF parser and return parsed routes.
 */
function parsePdfWithPython(pdfPath) {
  return new Promise((resolve, reject) => {
    execFile('python3', [scriptPath, pdfPath], { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[pick-list] Python stderr:', stderr);
        return reject(new Error(stderr || error.message));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('Failed to parse Python output: ' + stdout.slice(0, 200)));
      }
    });
  });
}

// POST /api/ops/upload-picklist — parse and store pick list PDF
router.post('/upload-picklist', managerOnly, upload.single('picklist'), async (req, res) => {
  let tmpPdfPath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

    // Write uploaded PDF to temp file for Python to read
    tmpPdfPath = path.join(os.tmpdir(), `picklist_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPdfPath, req.file.buffer);

    const allRoutes = await parsePdfWithPython(tmpPdfPath);
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
        INSERT INTO pick_list_data (date, route_code, vehicle_id, wave_time, bags, overflow, total_packages, commercial_packages, raw_text)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (date, route_code) DO UPDATE SET
          vehicle_id = EXCLUDED.vehicle_id,
          wave_time = EXCLUDED.wave_time,
          bags = EXCLUDED.bags,
          overflow = EXCLUDED.overflow,
          total_packages = EXCLUDED.total_packages,
          commercial_packages = EXCLUDED.commercial_packages,
          raw_text = EXCLUDED.raw_text
      `, [r.date, r.route_code, r.vehicle_id, r.wave_time, r.bags, r.overflow, r.total_packages, r.commercial_packages, r.raw_text]);
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
  } finally {
    // Clean up temp PDF
    if (tmpPdfPath) try { fs.unlinkSync(tmpPdfPath); } catch {}
  }
});

// GET /api/ops/picklist?date=YYYY-MM-DD — retrieve pick list data for a date
router.get('/picklist', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required' });
  const { rows } = await pool.query('SELECT * FROM pick_list_data WHERE date = $1 ORDER BY route_code', [date]);
  res.json(rows);
});

// POST /api/ops/send-whatsapp-briefing — send morning briefing to all drivers
router.post('/send-whatsapp-briefing', managerOnly, async (req, res) => {
  const { sendWhatsApp } = require('../services/whatsappService');
  const date = req.body.date || new Date().toISOString().split('T')[0];

  try {
    // Get all ops assignments for this date with driver info, vehicle, and pick list
    const { rows: drivers } = await pool.query(`
      SELECT
        s.id AS staff_id, s.first_name, s.last_name, s.phone,
        oa.route_code, oa.shift_type,
        v.year AS v_year, v.make AS v_make, v.model AS v_model, v.plate AS v_plate,
        v.unit_number AS v_unit,
        pl.bags, pl.overflow, pl.total_packages, pl.commercial_packages, pl.wave_time AS pl_wave_time
      FROM ops_assignments oa
      JOIN staff s ON s.id = oa.staff_id
      LEFT JOIN vehicles v ON v.id = oa.vehicle_id
      LEFT JOIN pick_list_data pl ON pl.route_code = oa.route_code AND pl.date = oa.plan_date
      WHERE oa.plan_date = $1
        AND oa.removed_from_ops IS NOT TRUE
        AND oa.route_code IS NOT NULL
    `, [date]);

    // Get loadout data for staging/canopy/wave/launchpad
    const { rows: loadoutRows } = await pool.query(
      `SELECT loadout FROM ops_loadout WHERE plan_date = $1`, [date]
    );
    const loadoutMap = {};
    if (loadoutRows[0]?.loadout) {
      for (const item of loadoutRows[0].loadout) {
        loadoutMap[item.routeCode] = item;
      }
    }

    const results = { sent: 0, failed: 0, errors: [], total: drivers.length };

    for (const d of drivers) {
      if (!d.phone) {
        results.failed++;
        results.errors.push(`${d.first_name} ${d.last_name}: No phone number`);
        continue;
      }

      const loadout = loadoutMap[d.route_code] || {};
      const vehicleLabel = d.v_unit || [d.v_year, d.v_make, d.v_model].filter(Boolean).join(' ') || '—';

      const message = [
        `🚚 Last Mile DSP — Daily Briefing`,
        ``,
        `Good morning ${d.first_name}! Here's your info for today:`,
        ``,
        `📍 Route: ${d.route_code}`,
        `🚗 Vehicle: ${vehicleLabel}${d.shift_type ? ` — ${d.shift_type}` : ''}`,
        `🏗️ Staging: ${loadout.staging || '—'} | Canopy: ${loadout.canopy || '—'}`,
        `🌊 Wave: ${loadout.wave || '—'} | Time: ${loadout.waveTime || d.pl_wave_time || '—'}`,
        `🚀 Launchpad: ${loadout.launchpad || '—'}`,
        ``,
        ...(d.total_packages ? [
          `📦 Pick List Summary:`,
          `🛍️ Bags: ${d.bags || 0}${d.overflow ? ` + ${d.overflow} overflow` : ''}`,
          `📬 Total packages: ${d.total_packages}`,
          ...(d.commercial_packages ? [`🏢 Commercial: ${d.commercial_packages}`] : []),
          ``,
        ] : []),
        `Check your app for full details:`,
        `https://dsp-fleet-manager-production.up.railway.app`,
        ``,
        `Have a great route! 🐕`,
        `— Last Mile DSP`,
      ].join('\n');

      try {
        await sendWhatsApp(d.phone, message);
        results.sent++;
      } catch (err) {
        results.failed++;
        results.errors.push(`${d.first_name} ${d.last_name}: ${err.message}`);
      }
    }

    res.json(results);
  } catch (err) {
    console.error('[whatsapp-briefing] Error:', err);
    res.status(500).json({ error: 'Failed to send briefings: ' + err.message });
  }
});

// GET /api/ops/my-picklist — driver's own pick list for today
router.get('/my-picklist', async (req, res) => {
  try {
    const staffId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Find the driver's route_code from ops_assignments for today
    const { rows: asgn } = await pool.query(
      `SELECT route_code FROM ops_assignments
       WHERE staff_id = $1 AND plan_date = $2 AND removed_from_ops IS NOT TRUE AND route_code IS NOT NULL`,
      [staffId, today]
    );
    if (!asgn.length) return res.json(null);

    const routeCode = asgn[0].route_code;

    // Get pick list data for this route
    const { rows: pl } = await pool.query(
      `SELECT * FROM pick_list_data WHERE date = $1 AND route_code = $2`,
      [today, routeCode]
    );
    if (!pl.length) return res.json(null);

    const pick = pl[0];

    // Parse bag details from raw_text
    const bagDetails = [];
    if (pick.raw_text) {
      // Look for bag table rows — typically: "1 A-26.1A Orange 4126 11" or similar patterns
      const lines = pick.raw_text.split('\n');
      for (const line of lines) {
        // Pattern: bag_number zone color code package_count
        // Bags are typically numbered rows with zone identifiers
        const match = line.match(/^\s*(\d{1,3})\s+([A-Z0-9][\w\-\.]+\w)\s+(\w+)\s+(\w{3,6})\s+(\d{1,4})\s*$/i);
        if (match) {
          bagDetails.push({
            bag: parseInt(match[1]),
            zone: match[2],
            color: match[3],
            code: match[4],
            pkgs: parseInt(match[5]),
          });
        }
      }
    }

    res.json({
      route_code: pick.route_code,
      vehicle_id: pick.vehicle_id,
      wave_time: pick.wave_time,
      bags: pick.bags,
      overflow: pick.overflow,
      total_packages: pick.total_packages,
      commercial_packages: pick.commercial_packages,
      bag_details: bagDetails,
      raw_text: pick.raw_text,
    });
  } catch (err) {
    console.error('[my-picklist] Error:', err);
    res.status(500).json({ error: 'Failed to load pick list' });
  }
});

module.exports = router;
