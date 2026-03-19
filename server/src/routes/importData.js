/**
 * POST /api/import-data
 * Wipes Railway DB and imports a full local data export.
 * Protected by IMPORT_SECRET env var (default: 'import-secret-2026').
 * Body: { secret, tables: { staff: [...], vehicles: [...], ... } }
 */
const router  = require('express').Router();
const pool    = require('../db/pool');
const bcrypt  = require('bcryptjs');

// Tables in FK-safe insertion order
const TABLE_ORDER = [
  'staff', 'vehicles', 'drivers', 'fleet_alerts', 'consequence_rules',
  'shifts', 'attendance', 'staff_violations', 'payroll_records',
  'driver_recurring_shifts', 'day_schedules', 'day_schedule_drivers',
  'inspections', 'inspection_photos', 'amazon_route_files', 'amazon_routes',
  'repairs', 'driver_reports', 'shift_types', 'settings',
  'ops_planner_sessions', 'week_schedules', 'shift_change_log',
];

// Tables whose PK is NOT a serial id — use ON CONFLICT DO NOTHING instead
const NO_SERIAL_ID = new Set(['day_schedules']);

// Tables that use ON CONFLICT (name/key) DO NOTHING
const UPSERT_ON_CONFLICT = new Set(['shift_types', 'settings']);

router.post('/', async (req, res) => {
  const secret = process.env.IMPORT_SECRET || 'import-secret-2026';
  if (req.body.secret !== secret) {
    return res.status(403).json({ error: 'Invalid import secret' });
  }

  const { tables } = req.body;
  if (!tables) return res.status(400).json({ error: 'No tables payload' });

  const client = await pool.connect();
  const report = {};
  let totalInserted = 0;

  try {
    // Skip FK/trigger checks so we can insert in any order with explicit IDs
    await client.query(`SET session_replication_role = 'replica'`);
    await client.query('BEGIN');

    // ── 1. Wipe ALL tables in reverse FK order ──────────────────────────────
    const reversed = [...TABLE_ORDER].reverse();
    for (const table of reversed) {
      try {
        await client.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
      } catch (e) {
        // Table may not exist yet; schema migration creates it on next boot
        console.log(`[import] truncate skip: ${table} (${e.message})`);
      }
    }

    // ── 2. Insert each table's rows ─────────────────────────────────────────
    for (const table of TABLE_ORDER) {
      const rows = tables[table];
      if (!rows || rows.length === 0) { report[table] = 0; continue; }

      let inserted = 0;
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = Object.values(row);
        const colList     = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

        try {
          if (NO_SERIAL_ID.has(table) || UPSERT_ON_CONFLICT.has(table)) {
            // No serial PK — just insert, skip on conflict
            await client.query(
              `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              vals
            );
          } else {
            // Preserve original IDs with OVERRIDING SYSTEM VALUE
            await client.query(
              `INSERT INTO "${table}" (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
              vals
            );
          }
          inserted++;
        } catch (err) {
          console.error(`[import] ${table} row insert error: ${err.message}`);
          console.error(`[import] row: ${JSON.stringify(row).slice(0, 200)}`);
        }
      }

      report[table] = inserted;
      totalInserted += inserted;
      console.log(`[import] ${table}: ${inserted}/${rows.length}`);
    }

    // ── 3. Reset all sequences to max(id) so future inserts don't conflict ──
    for (const table of TABLE_ORDER) {
      if (NO_SERIAL_ID.has(table)) continue;
      try {
        await client.query(
          `SELECT setval(
             pg_get_serial_sequence('"${table}"', 'id'),
             COALESCE((SELECT MAX(id) FROM "${table}"), 1),
             true
           )`
        );
      } catch (e) { /* no serial id on this table */ }
    }

    await client.query('COMMIT');
    await client.query(`SET session_replication_role = 'origin'`);

    // ── 4. Re-seed admin account (was wiped with staff table) ───────────────
    try {
      const hash = await bcrypt.hash('LastMile2026!', 12);
      await pool.query(
        `INSERT INTO staff (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
         VALUES ('ADM001','James','Mitchell','admin@lastmiledsp.com','555-0100','admin','active','2022-01-01',$1)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash, updated_at = NOW()`,
        [hash]
      );
      console.log('[import] ✅ Admin account re-seeded');
    } catch (e) {
      console.error('[import] Admin re-seed error:', e.message);
    }

    console.log(`[import] ✅ Done: ${totalInserted} rows inserted`);
    res.json({ success: true, totalInserted, report });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query(`SET session_replication_role = 'origin'`).catch(() => {});
    console.error('[import] ❌ Fatal error:', err.message);
    res.status(500).json({ error: err.message, report });
  } finally {
    client.release();
  }
});

module.exports = router;
