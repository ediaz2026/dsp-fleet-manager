/**
 * POST /api/import-data
 * Imports a full data export into this database.
 * Protected by IMPORT_SECRET env var (set this in Railway Variables).
 * Body: { secret, tables: { staff: [...], vehicles: [...], ... } }
 */
const router = require('express').Router();
const pool   = require('../db/pool');

// Tables in FK-safe insertion order
const TABLE_ORDER = [
  'staff',
  'vehicles',
  'drivers',
  'fleet_alerts',
  'consequence_rules',
  'shifts',
  'attendance',
  'staff_violations',
  'payroll_records',
  'driver_recurring_shifts',
  'day_schedules',
  'day_schedule_drivers',
  'inspections',
  'inspection_photos',
  'amazon_route_files',
  'amazon_routes',
  'repairs',
  'driver_reports',
  'shift_types',
  'settings',
  'ops_planner_sessions',
  'week_schedules',
  'shift_change_log',
];

// Tables that use ON CONFLICT DO NOTHING (have natural unique keys)
const UPSERT_TABLES = new Set(['day_schedules', 'shift_types', 'settings']);

// Tables where we skip the admin account row to preserve it
const PRESERVE_ADMIN_EMAIL = 'admin@lastmiledsp.com';

router.post('/', async (req, res) => {
  const secret = process.env.IMPORT_SECRET || 'import-secret-2026';
  if (req.body.secret !== secret) {
    return res.status(403).json({ error: 'Invalid import secret' });
  }

  const { tables } = req.body;
  if (!tables) return res.status(400).json({ error: 'No tables provided' });

  const client = await pool.connect();
  const report = {};
  let totalInserted = 0;

  try {
    // Disable FK checks via session_replication_role
    await client.query(`SET session_replication_role = 'replica'`);
    await client.query('BEGIN');

    // Truncate all tables in reverse order (except staff — preserve admin)
    const toTruncate = [...TABLE_ORDER].reverse().filter(t => t !== 'staff');
    for (const table of toTruncate) {
      try {
        await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
      } catch (e) {
        // Table may not exist yet — schema migration will create it
      }
    }
    // Clear non-admin staff rows
    await client.query(`DELETE FROM staff WHERE email != '${PRESERVE_ADMIN_EMAIL}'`);

    // Insert each table's data
    for (const table of TABLE_ORDER) {
      const rows = tables[table];
      if (!rows || rows.length === 0) { report[table] = 0; continue; }

      let inserted = 0;
      for (const row of rows) {
        // Skip admin account in staff — it's already there
        if (table === 'staff' && row.email === PRESERVE_ADMIN_EMAIL) continue;

        const cols = Object.keys(row);
        const vals = Object.values(row);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const colList = cols.map(c => `"${c}"`).join(', ');

        try {
          if (UPSERT_TABLES.has(table)) {
            await client.query(
              `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              vals
            );
          } else {
            await client.query(
              `INSERT INTO ${table} (${colList}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
              vals
            );
          }
          inserted++;
        } catch (err) {
          console.error(`[import] ${table} row error:`, err.message, JSON.stringify(row).slice(0, 100));
        }
      }

      report[table] = inserted;
      totalInserted += inserted;
      console.log(`[import] ${table}: ${inserted}/${rows.length} rows inserted`);
    }

    // Reset sequences for all tables with SERIAL id
    for (const table of TABLE_ORDER) {
      try {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
            COALESCE((SELECT MAX(id) FROM ${table}), 1))`
        );
      } catch (e) { /* table has no serial id */ }
    }

    await client.query('COMMIT');
    await client.query(`SET session_replication_role = 'origin'`);

    console.log(`[import] ✅ Complete: ${totalInserted} rows inserted`);
    res.json({ success: true, totalInserted, report });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    await client.query(`SET session_replication_role = 'origin'`).catch(() => {});
    console.error('[import] ❌ Failed:', err.message);
    res.status(500).json({ error: err.message, report });
  } finally {
    client.release();
  }
});

module.exports = router;
