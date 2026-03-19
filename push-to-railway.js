/**
 * push-to-railway.js
 * Step 1: Exports all local PostgreSQL data
 * Step 2: POSTs it to Railway's /api/import-data endpoint
 *
 * Run: node push-to-railway.js
 */
const { Pool }  = require('pg');
const fs        = require('fs');
const path      = require('path');
const https     = require('https');
const http      = require('http');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const RAILWAY_URL   = 'https://dsp-fleet-manager-production.up.railway.app';
const IMPORT_SECRET = 'import-secret-2026';
const LOCAL_DB      = 'postgresql://postgres:postgres@localhost:5432/dsp_manager';
const LOG_FILE      = path.join(__dirname, 'push-to-railway-output.txt');
// ───────────────────────────────────────────────────────────────────────────

const lines = [];
function log(msg) {
  console.log(msg);
  lines.push(msg);
}

const TABLES = [
  'staff', 'vehicles', 'drivers', 'fleet_alerts', 'consequence_rules',
  'shifts', 'attendance', 'staff_violations', 'payroll_records',
  'driver_recurring_shifts', 'day_schedules', 'day_schedule_drivers',
  'inspections', 'inspection_photos', 'amazon_route_files', 'amazon_routes',
  'repairs', 'driver_reports', 'shift_types', 'settings',
  'ops_planner_sessions', 'week_schedules', 'shift_change_log',
];

async function exportLocal() {
  const pool = new Pool({ connectionString: LOCAL_DB, ssl: false });
  const data = {};
  let total = 0;
  log('\n📦 STEP 1: Exporting local database...');

  for (const table of TABLES) {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
      data[table] = rows;
      total += rows.length;
      log(`  ✓ ${table}: ${rows.length} rows`);
    } catch (err) {
      log(`  ⚠️  ${table}: skipped (${err.message})`);
      data[table] = [];
    }
  }

  await pool.end();
  log(`\n  Total: ${total} rows exported`);
  return data;
}

function postToRailway(tables) {
  return new Promise((resolve, reject) => {
    log('\n🚀 STEP 2: Posting to Railway...');
    log(`  URL: ${RAILWAY_URL}/api/import-data`);

    const body = JSON.stringify({ secret: IMPORT_SECRET, tables });
    const url  = new URL(`${RAILWAY_URL}/api/import-data`);
    const lib  = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    };

    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        log(`  HTTP ${res.statusCode}`);
        try {
          const json = JSON.parse(raw);
          resolve(json);
        } catch {
          resolve({ raw });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

async function main() {
  log('=== Push Local Data to Railway ===');
  log(new Date().toISOString());

  try {
    const tables = await exportLocal();
    const result = await postToRailway(tables);

    if (result.success) {
      log('\n✅ IMPORT COMPLETE');
      log(`   Total rows inserted: ${result.totalInserted}`);
      log('\n   Table breakdown:');
      Object.entries(result.report || {}).forEach(([t, n]) => {
        if (n > 0) log(`     ${t}: ${n}`);
      });
    } else {
      log('\n❌ IMPORT FAILED');
      log('   Error: ' + (result.error || JSON.stringify(result)));
    }
  } catch (err) {
    log('\n❌ ERROR: ' + err.message);
  }

  fs.writeFileSync(LOG_FILE, lines.join('\n'), 'utf8');
  log('\n📄 Log saved to push-to-railway-output.txt');
}

main();
