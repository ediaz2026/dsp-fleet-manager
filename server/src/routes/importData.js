/**
 * POST /api/import-data
 * Wipes Railway DB and imports a full local data export.
 * Protected by IMPORT_SECRET env var (default: 'import-secret-2026').
 * Body: { secret, tables: { staff: [...], vehicles: [...], ... } }
 */
const router = require('express').Router();
const pool   = require('../db/pool');
const bcrypt = require('bcryptjs');

// FK-safe insertion order
const TABLE_ORDER = [
  'staff', 'vehicles', 'drivers', 'fleet_alerts', 'consequence_rules',
  'shifts', 'attendance', 'staff_violations', 'payroll_records',
  'driver_recurring_shifts', 'day_schedules', 'day_schedule_drivers',
  'inspections', 'inspection_photos', 'amazon_route_files', 'amazon_routes',
  'repairs', 'driver_reports', 'shift_types', 'settings',
  'ops_planner_sessions', 'week_schedules', 'shift_change_log',
];

// Tables with no serial id — use ON CONFLICT DO NOTHING
const NO_SERIAL_ID = new Set(['day_schedules']);

router.post('/', async (req, res) => {
  const secret = process.env.IMPORT_SECRET || 'import-secret-2026';
  if (req.body.secret !== secret) {
    return res.status(403).json({ error: 'Invalid import secret' });
  }

  const { tables } = req.body;
  if (!tables) return res.status(400).json({ error: 'No tables payload' });

  const client = await pool.connect();
  const report  = {};
  let totalInserted = 0;

  try {
    await client.query('BEGIN');

    // ── 1. Wipe all tables in reverse FK order ──────────────────────────────
    for (const table of [...TABLE_ORDER].reverse()) {
      try {
        await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
      } catch (e) {
        console.log(`[import] truncate skip: ${table} — ${e.message}`);
      }
    }

    // ── 2. Insert each table using plain INSERT (works with SERIAL PKs) ─────
    for (const table of TABLE_ORDER) {
      const rows = tables[table];
      if (!rows || rows.length === 0) { report[table] = 0; continue; }

      let inserted = 0;
      let errors   = 0;

      for (const row of rows) {
        const cols         = Object.keys(row);
        const vals         = Object.values(row);
        const colList      = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

        try {
          if (NO_SERIAL_ID.has(table)) {
            await client.query(
              `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              vals
            );
          } else {
            // Plain INSERT — SERIAL columns accept explicit id values directly
            await client.query(
              `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`,
              vals
            );
          }
          inserted++;
        } catch (err) {
          errors++;
          if (errors <= 3) {
            // Log first 3 errors per table so we can diagnose without flooding logs
            console.error(`[import] ${table} row error: ${err.message}`);
            console.error(`[import] row sample: ${JSON.stringify(row).slice(0, 150)}`);
          }
        }
      }

      report[table] = inserted;
      totalInserted += inserted;
      const status = errors > 0 ? ` (${errors} errors)` : '';
      console.log(`[import] ${table}: ${inserted}/${rows.length}${status}`);
    }

    // ── 3. Reset all SERIAL sequences so new inserts don't conflict ─────────
    for (const table of TABLE_ORDER) {
      if (NO_SERIAL_ID.has(table)) continue;
      try {
        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('"${table}"', 'id'),
            COALESCE((SELECT MAX(id) FROM "${table}"), 1),
            true
          )
        `);
      } catch (e) { /* table has no serial id */ }
    }

    await client.query('COMMIT');

    // ── 4. Re-seed admin account ────────────────────────────────────────────
    try {
      const hash = await bcrypt.hash('LastMile2026!', 12);
      await pool.query(
        `INSERT INTO staff
           (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
         VALUES ('ADM001','James','Mitchell','admin@lastmiledsp.com','555-0100','admin','active','2022-01-01',$1)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               role = 'admin',
               updated_at = NOW()`,
        [hash]
      );
      console.log('[import] ✅ Admin account ready');
    } catch (e) {
      console.error('[import] Admin seed error:', e.message);
    }

    console.log(`[import] ✅ Complete — ${totalInserted} rows inserted`);
    res.json({ success: true, totalInserted, report });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[import] ❌ Fatal:', err.message);
    res.status(500).json({ error: err.message, report });
  } finally {
    client.release();
  }
});

module.exports = router;
