/**
 * Migration: Create shift_types table and seed defaults
 * Run with: node server/src/db/migrateShiftTypes.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_types (
        id                 SERIAL PRIMARY KEY,
        name               VARCHAR(50) UNIQUE NOT NULL,
        default_start_time TIME NOT NULL DEFAULT '07:00',
        default_end_time   TIME NOT NULL DEFAULT '17:00',
        color              VARCHAR(30) DEFAULT 'blue',
        is_active          BOOLEAN DEFAULT TRUE,
        sort_order         INTEGER DEFAULT 99,
        created_at         TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✅  shift_types table ready');

    const { rowCount } = await client.query(`
      INSERT INTO shift_types (name, default_start_time, default_end_time, color, sort_order) VALUES
        ('EDV',         '07:00', '17:00', 'blue',   1),
        ('STEP VAN',    '07:00', '17:00', 'indigo', 2),
        ('HELPER',      '07:00', '15:00', 'amber',  3),
        ('ON CALL',     '07:00', '17:00', 'yellow', 4),
        ('EXTRA',       '07:00', '17:00', 'green',  5),
        ('DISPATCH AM', '05:00', '13:00', 'cyan',   6),
        ('DISPATCH PM', '13:00', '21:00', 'sky',    7),
        ('SUSPENSION',  '07:00', '17:00', 'red',    8),
        ('UTO',         '07:00', '17:00', 'purple', 9),
        ('PTO',         '07:00', '17:00', 'teal',   10),
        ('TRAINING',    '07:00', '15:00', 'orange', 11)
      ON CONFLICT (name) DO NOTHING
    `);
    console.log(`✅  Seeded ${rowCount} default shift type(s)`);

    const { rows } = await client.query(
      'SELECT id, name, default_start_time, default_end_time FROM shift_types ORDER BY sort_order'
    );
    console.log('\nCurrent shift types:');
    rows.forEach(r =>
      console.log(`  [${r.id}] ${r.name.padEnd(12)} ${r.default_start_time} – ${r.default_end_time}`)
    );
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => { console.log('\nMigration complete.'); process.exit(0); })
  .catch(e  => { console.error('Migration failed:', e.message); process.exit(1); });
