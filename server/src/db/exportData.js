/**
 * exportData.js — exports all local PostgreSQL data to export.json
 * Run: node server/src/db/exportData.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
  ssl: false,
});

// Tables in FK-safe insertion order
const TABLES = [
  'staff', 'vehicles', 'drivers', 'fleet_alerts', 'consequence_rules',
  'shifts', 'attendance', 'staff_violations', 'payroll_records',
  'driver_recurring_shifts', 'day_schedules', 'day_schedule_drivers',
  'inspections', 'inspection_photos', 'amazon_route_files', 'amazon_routes',
  'repairs', 'driver_reports', 'shift_types', 'settings',
  'ops_planner_sessions', 'week_schedules', 'shift_change_log',
];

// Tables with no serial id column — order by first column instead
const NO_ID = new Set(['day_schedules']);

async function exportData() {
  const data = {};
  let totalRows = 0;
  console.log('📦 Exporting local database...\n');

  for (const table of TABLES) {
    try {
      const orderBy = NO_ID.has(table) ? '1' : 'id';
      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
      data[table] = rows;
      totalRows += rows.length;
      console.log(`  ✓ ${table}: ${rows.length} rows`);
    } catch (err) {
      console.warn(`  ⚠️  ${table}: skipped (${err.message})`);
      data[table] = [];
    }
  }

  const outPath = path.join(__dirname, '../../../export.json');
  fs.writeFileSync(outPath, JSON.stringify({ exportedAt: new Date(), tables: data }, null, 2), 'utf8');
  console.log(`\n✅ Export complete: ${totalRows} rows → ${outPath}`);
  await pool.end();
}

exportData().catch(err => { console.error('❌ Export failed:', err.message); process.exit(1); });
