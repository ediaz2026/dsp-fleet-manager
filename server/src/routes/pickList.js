const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, managerOnly } = require('../middleware/auth');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

router.use(authMiddleware);

// Get current date in Eastern timezone (America/New_York) — avoids UTC drift after 8 PM ET
function getEasternDate() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return nowET.toISOString().split('T')[0];
}

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

// Python script for PDF parsing via pdfplumber — page-by-page grouping
const PYTHON_SCRIPT = `
import sys
import json
import re
import pdfplumber
from datetime import datetime

pdf_path = sys.argv[1]
import sys as _sys
STG_PATTERN = re.compile(r'(?:^|\\s)(STG\\.[A-Z0-9]+\\.\\d+)', re.IGNORECASE)

# Step 1: Extract text page-by-page, split on STG. markers (even mid-page)
# Collect text segments — each starting with an STG. line
segments = []  # list of strings, each starting with "STG.xxx..."
current_seg = None

with pdfplumber.open(pdf_path) as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if not text:
            continue
        page_lines = text.split('\\n')

        for line in page_lines:
            stg_match = STG_PATTERN.search(line)
            if stg_match:
                # Found an STG. marker — save previous segment, start new one
                if current_seg is not None:
                    segments.append(current_seg)
                # The line might have text before STG. (belongs to previous route)
                # and text from STG. onward (new route)
                marker_pos = stg_match.start(1)
                before = line[:marker_pos].strip()
                if before and current_seg is not None:
                    # Append pre-STG text to the PREVIOUS segment we just saved
                    segments[-1] += '\\n' + before if segments else before
                elif before and segments:
                    segments[-1] += '\\n' + before
                current_seg = line[marker_pos:].strip()
            else:
                # Regular line — append to current segment
                if current_seg is not None:
                    current_seg += '\\n' + line
                # else: text before any STG. marker — skip

    if current_seg is not None:
        segments.append(current_seg)

# Build route groups from segments
route_groups = []
for seg in segments:
    lines = seg.split('\\n')
    first_line = lines[0].strip()
    route_groups.append({ 'first_line': first_line, 'pages': [seg] })

print(f"Grouped {len(route_groups)} routes from PDF", file=_sys.stderr)

results = []
for group in route_groups:
    # Concatenate ALL pages for this route
    chunk = '\\n'.join(group['pages'])
    lines = chunk.split('\\n')
    first_line = group['first_line']

    # Route code: first token of first line
    route_code = first_line.split()[0].strip()

    # Find vehicle_id: first CX\\d+ or HZA\\d+ pattern
    vehicle_id = ''
    vid_match = re.search(r'\\b((?:CX|HZA)\\d+)\\b', chunk, re.IGNORECASE)
    if vid_match:
        vehicle_id = vid_match.group(1).upper()

    # Check if LSMD appears near vehicle_id or in first 500 chars
    dsp_code = ''
    if vid_match:
        start = vid_match.start()
        nearby = chunk[max(0, start - 50):start + 300]
        if 'LSMD' in nearby.upper():
            dsp_code = 'LSMD'
    if dsp_code != 'LSMD' and 'LSMD' in chunk[:500].upper():
        dsp_code = 'LSMD'

    # Wave time and date from first few lines
    wave_time = ''
    date_str = ''
    for line in lines[:6]:
        if not wave_time:
            time_match = re.search(r'(\\d{1,2}:\\d{2}\\s*[AP]M)', line, re.IGNORECASE)
            if time_match:
                wave_time = time_match.group(1).strip()
        if not date_str:
            date_match = re.search(r'([A-Z]{3}\\s+\\d{1,2},?\\s*\\d{4})', line, re.IGNORECASE)
            if date_match:
                date_str = date_match.group(1).strip()

    # Parse date
    parsed_date = None
    if date_str:
        try:
            cleaned = date_str.replace(',', '')
            parsed_date = datetime.strptime(cleaned, '%b %d %Y').strftime('%Y-%m-%d')
        except:
            pass

    # Extract counts from full chunk text
    bags = 0
    overflow = 0
    total_packages = 0
    commercial_packages = 0

    bags_match = re.search(r'(\\d+)\\s+bags?', chunk, re.IGNORECASE)
    if bags_match:
        bags = int(bags_match.group(1))

    overflow_match = re.search(r'(\\d+)\\s+over(?:flow)?', chunk, re.IGNORECASE)
    if overflow_match:
        overflow = int(overflow_match.group(1))

    total_match = re.search(r'Total\\s+Packages\\s*[:\\s]*(\\d+)', chunk, re.IGNORECASE)
    if total_match:
        total_packages = int(total_match.group(1))

    commercial_match = re.search(r'Commercial\\s+Packages\\s*[:\\s]*(\\d+)', chunk, re.IGNORECASE)
    if commercial_match:
        commercial_packages = int(commercial_match.group(1))

    print(f"Route {route_code} ({vehicle_id}): {len(group['pages'])} pages, raw_text={len(chunk)} chars, bags={bags}", file=_sys.stderr)

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
        'raw_text': chunk,
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

    // ── Post-upload validation: compare pick list vs ops planner ──
    const pickListDate = lsmdRoutes[0]?.date || null;
    const pickListVehicles = lsmdRoutes.map(r => r.vehicle_id?.toUpperCase()).filter(Boolean);

    let matched = [];
    let missing_from_picklist = [];
    let extra_in_picklist = [];
    let ops_drivers = {}; // vehicle_name → driver name

    if (pickListDate) {
      // Get assigned route codes (CX182) from ops planner for this date
      const { rows: opsRows } = await pool.query(`
        SELECT UPPER(oa.route_code) AS route_code,
               COALESCE(oa.name_override, s.first_name || ' ' || s.last_name) AS driver_name
        FROM ops_assignments oa
        JOIN staff s ON s.id = oa.staff_id
        WHERE oa.plan_date = $1 AND oa.removed_from_ops IS NOT TRUE AND oa.route_code IS NOT NULL
      `, [pickListDate]);

      const opsVehicles = new Set();
      for (const r of opsRows) {
        const rc = r.route_code?.toUpperCase();
        if (rc) {
          opsVehicles.add(rc);
          ops_drivers[rc] = r.driver_name;
        }
      }
      const pickSet = new Set(pickListVehicles);

      matched = pickListVehicles.filter(v => opsVehicles.has(v));
      missing_from_picklist = [...opsVehicles].filter(v => !pickSet.has(v)).map(v => ({ vehicle_id: v, driver: ops_drivers[v] || '—' }));
      extra_in_picklist = pickListVehicles.filter(v => !opsVehicles.has(v)).map(v => ({ vehicle_id: v }));
    }

    res.json({
      success: true,
      routes_found: allRoutes.length,
      lsmd_routes: lsmdRoutes.length,
      date: pickListDate,
      matched: matched.length,
      missing_from_picklist,
      extra_in_picklist,
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
// POST /api/ops/cleanup-ops — remove non-working drivers from ops_assignments for a date
router.post('/cleanup-ops', managerOnly, async (req, res) => {
  const date = req.body.date || getEasternDate();
  try {
    // Debug: show ALL drivers in ops_assignments with their shift types from the shifts table
    const { rows: debugRows } = await pool.query(`
      SELECT oa.staff_id, oa.plan_date,
             s2.first_name, s2.last_name,
             sh.shift_type, sh.shift_date, sh.id AS shift_id
      FROM ops_assignments oa
      JOIN staff s2 ON s2.id = oa.staff_id
      LEFT JOIN shifts sh ON sh.staff_id = oa.staff_id AND sh.shift_date = oa.plan_date
      WHERE oa.plan_date = $1 AND oa.removed_from_ops IS NOT TRUE
      ORDER BY sh.shift_type, s2.last_name
    `, [date]);

    console.log(`[cleanup] ── Debug for date ${date} ──`);
    console.log(`[cleanup] Total ops_assignments: ${debugRows.length}`);
    const byType = {};
    for (const r of debugRows) {
      const t = r.shift_type || '(NO SHIFT)';
      if (!byType[t]) byType[t] = [];
      byType[t].push(`${r.first_name} ${r.last_name}`);
    }
    for (const [type, names] of Object.entries(byType)) {
      console.log(`[cleanup]   ${type}: ${names.length} drivers — ${names.join(', ')}`);
    }

    // Now do the actual cleanup
    const { rows } = await pool.query(`
      DELETE FROM ops_assignments
      WHERE plan_date = $1
        AND EXISTS (
          SELECT 1 FROM shifts s
          WHERE s.staff_id = ops_assignments.staff_id
            AND s.shift_date = ops_assignments.plan_date
            AND UPPER(s.shift_type) IN ('ON CALL','UTO','PTO','SUSPENSION','TRAINING')
        )
      RETURNING staff_id
    `, [date]);

    console.log(`[cleanup] Deleted ${rows.length} non-working assignments`);

    const names = [];
    if (rows.length > 0) {
      const { rows: staff } = await pool.query(
        `SELECT id, first_name, last_name FROM staff WHERE id = ANY($1)`,
        [rows.map(r => r.staff_id)]
      );
      for (const s of staff) names.push(`${s.first_name} ${s.last_name}`);
      console.log(`[cleanup] Removed: ${names.join(', ')}`);
    }
    res.json({ removed: rows.length, names, date, debug: byType });
  } catch (err) {
    console.error('[cleanup] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/picklist', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required' });
  const { rows } = await pool.query('SELECT * FROM pick_list_data WHERE date = $1 ORDER BY route_code', [date]);
  console.log(`[pick-list] GET /picklist date=${date} rows=${rows.length} vehicle_ids=[${rows.slice(0, 5).map(r => r.vehicle_id).join(', ')}]`);
  res.json(rows);
});

// GET /api/ops/picklist-debug?date=YYYY-MM-DD — diagnostic endpoint
router.get('/picklist-debug', async (req, res) => {
  const date = req.query.date || getEasternDate();
  try {
    // Pick list data in DB
    const { rows: plRows } = await pool.query(
      `SELECT vehicle_id, route_code, bags, overflow, total_packages, commercial_packages, wave_time, date::text
       FROM pick_list_data WHERE date = $1 ORDER BY vehicle_id`,
      [date]
    );

    // Ops assignments — use route_code (CX182) for matching
    const { rows: opsRows } = await pool.query(`
      SELECT oa.route_code,
             COALESCE(oa.name_override, s.first_name || ' ' || s.last_name) AS driver_name,
             oa.staff_id
      FROM ops_assignments oa
      JOIN staff s ON s.id = oa.staff_id
      WHERE oa.plan_date = $1 AND oa.removed_from_ops IS NOT TRUE AND oa.route_code IS NOT NULL
      ORDER BY oa.route_code
    `, [date]);

    // Matching: pick_list_data.vehicle_id vs ops_assignments.route_code
    const plVehicles = new Set(plRows.map(r => (r.vehicle_id || '').toUpperCase()).filter(Boolean));
    const opsVehicles = new Set(opsRows.map(r => (r.route_code || '').toUpperCase()).filter(Boolean));

    const matched = [...plVehicles].filter(v => opsVehicles.has(v));
    const unmatched_pick_list = [...plVehicles].filter(v => !opsVehicles.has(v));
    const unmatched_ops = [...opsVehicles].filter(v => !plVehicles.has(v));

    console.log(`[pick-list-debug] date=${date} pl=${plRows.length} ops=${opsRows.length} matched=${matched.length} unmatched_pl=${unmatched_pick_list.length} unmatched_ops=${unmatched_ops.length}`);

    res.json({
      date,
      pick_list_in_db: plRows,
      ops_routes_today: opsRows,
      matched,
      unmatched_pick_list,
      unmatched_ops,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ops/picklist-lock-status — check if pick list is currently locked
router.get('/picklist-lock-status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('picklist_visibility_time', 'picklist_visibility_days')`
    );
    const m = {};
    for (const r of rows) m[r.setting_key] = r.setting_value;
    const visTime = m.picklist_visibility_time || '06:00';
    const visDays = (m.picklist_visibility_days || '0,1,2,3,4,5,6').split(',').map(Number);
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentDay = nowET.getDay();
    const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
    const [h, min] = visTime.split(':').map(Number);
    const visMinutes = h * 60 + min;
    const locked = !visDays.includes(currentDay) || currentMinutes < visMinutes;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    res.json({ locked, available_at: `${h12}:${String(min).padStart(2, '0')} ${ampm}` });
  } catch { res.json({ locked: false, available_at: '6:00 AM' }); }
});

// POST /api/ops/send-whatsapp-briefing — send morning briefing to all drivers
router.post('/send-whatsapp-briefing', managerOnly, async (req, res) => {
  const { sendWhatsApp } = require('../services/whatsappService');
  const date = req.body.date || getEasternDate();

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
      LEFT JOIN pick_list_data pl ON UPPER(pl.vehicle_id) = UPPER(oa.route_code) AND pl.date = oa.plan_date
      WHERE oa.plan_date = $1
        AND oa.removed_from_ops IS NOT TRUE
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
    const today = getEasternDate();

    // ── Time-lock check ────────────────────────────────────────────
    const { rows: settingsRows } = await pool.query(
      `SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('picklist_visibility_time', 'picklist_visibility_days')`
    );
    const settingsMap = {};
    for (const r of settingsRows) settingsMap[r.setting_key] = r.setting_value;

    const visTime = settingsMap.picklist_visibility_time || '06:00';
    const visDays = (settingsMap.picklist_visibility_days || '0,1,2,3,4,5,6').split(',').map(Number);

    // Current time in Eastern timezone
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentDay = nowET.getDay(); // 0=Sun
    const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
    const [visH, visM] = visTime.split(':').map(Number);
    const visMinutes = visH * 60 + visM;

    // Format display time
    const visAmpm = visH >= 12 ? 'PM' : 'AM';
    const vis12 = visH % 12 || 12;
    const availableAt = `${vis12}:${String(visM).padStart(2, '0')} ${visAmpm}`;

    if (!visDays.includes(currentDay) || currentMinutes < visMinutes) {
      return res.json({
        locked: true,
        available_at: availableAt,
        message: 'Pick list not available yet',
      });
    }

    console.log(`[my-picklist] staff_id=${staffId} date=${today}`);

    // ── Step 1: Try ops_assignments.route_code ────────────────────
    let routeCode = null;
    const { rows: asgn } = await pool.query(
      `SELECT route_code FROM ops_assignments
       WHERE staff_id = $1 AND plan_date = $2 AND removed_from_ops IS NOT TRUE AND route_code IS NOT NULL`,
      [staffId, today]
    );
    if (asgn.length) {
      routeCode = asgn[0].route_code;
      console.log(`[my-picklist] Step 1 ops_assignments route_code: ${routeCode}`);
    } else {
      console.log(`[my-picklist] Step 1 ops_assignments: no route found`);
    }

    // ── Step 2: Fallback — find route via transponder_id in ops_daily_routes ──
    if (!routeCode) {
      const { rows: drvRows } = await pool.query(
        `SELECT d.transponder_id, s.employee_id FROM drivers d JOIN staff s ON s.id = d.staff_id WHERE d.staff_id = $1`,
        [staffId]
      );
      const tid = drvRows[0]?.transponder_id || drvRows[0]?.employee_id || null;
      console.log(`[my-picklist] Step 2 driver transponder_id: ${tid || 'none'}`);

      if (tid) {
        const { rows: drRows } = await pool.query(
          `SELECT routes FROM ops_daily_routes WHERE plan_date = $1`, [today]
        );
        if (drRows[0]?.routes) {
          const normTid = tid.trim().toUpperCase().replace(/\s/g, '');
          for (const route of drRows[0].routes) {
            const tids = (route.transponderIds || []).map(t => t.trim().toUpperCase().replace(/\s/g, ''));
            if (tids.includes(normTid)) {
              routeCode = route.routeCode;
              console.log(`[my-picklist] Step 2 matched via TID ${normTid} → route ${routeCode}`);
              break;
            }
          }
        }
        if (!routeCode) console.log(`[my-picklist] Step 2 TID match: no route found`);
      }
    }

    if (!routeCode) {
      console.log(`[my-picklist] No route found for staff_id=${staffId} — returning null`);
      return res.json(null);
    }

    // ── Step 3: Match pick_list_data.vehicle_id = route_code ──────
    const { rows: pl } = await pool.query(
      `SELECT * FROM pick_list_data WHERE date = $1 AND UPPER(vehicle_id) = UPPER($2)`,
      [today, routeCode]
    );
    console.log(`[my-picklist] Step 3 pick_list match for ${routeCode}: ${pl.length > 0 ? 'FOUND' : 'not found'}`);
    if (!pl.length) return res.json(null);

    const pick = pl[0];

    // Parse bag details from raw_text
    const bagDetails = [];
    if (pick.raw_text) {
      const lines = pick.raw_text.split('\n');
      const COLORS = /orange|green|navy|yellow|black|blue|red|purple|white/i;
      for (const line of lines) {
        const trimmed = line.trim();
        // Pattern: bag_number zone color [code] package_count
        // e.g. "1 A-26.1A Orange 4126 11" or "1 A-26.1A Orange 11"
        const match = trimmed.match(/^(\d{1,3})\s+(\S+)\s+(Orange|Green|Navy|Yellow|Black|Blue|Red|Purple|White)\s+(?:(\S+)\s+)?(\d{1,4})$/i);
        if (match) {
          bagDetails.push({
            bag: parseInt(match[1]),
            zone: match[2],
            color: match[3],
            code: match[4] || '',
            pkgs: parseInt(match[5]),
          });
        }
      }
      console.log(`[my-picklist] Parsed ${bagDetails.length} bag details from ${lines.length} lines of raw_text`);
      if (bagDetails.length === 0 && lines.length > 5) {
        // Log first 5 non-empty lines for debugging
        const samples = lines.filter(l => l.trim()).slice(0, 5);
        console.log(`[my-picklist] Sample raw_text lines:`, samples);
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
