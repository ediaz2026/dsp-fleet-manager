require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('./pool');

async function migrateSchedule() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Shift types table
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        default_start_time TIME DEFAULT '07:00',
        default_end_time TIME DEFAULT '17:00',
        color VARCHAR(30) DEFAULT 'blue',
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Recurring schedule templates
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_schedules (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Recurring schedule entries
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_schedule_entries (
        id SERIAL PRIMARY KEY,
        schedule_id INTEGER REFERENCES recurring_schedules(id) ON DELETE CASCADE,
        staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
        shift_type VARCHAR(50) DEFAULT 'EDV',
        start_time TIME DEFAULT '07:00',
        end_time TIME DEFAULT '17:00',
        UNIQUE(schedule_id, staff_id, day_of_week)
      )
    `);

    // Route commitments per week
    await client.query(`
      CREATE TABLE IF NOT EXISTS route_commitments (
        id SERIAL PRIMARY KEY,
        week_start DATE UNIQUE NOT NULL,
        amazon_week INTEGER,
        edv_count INTEGER DEFAULT 0,
        step_van_count INTEGER DEFAULT 0,
        total_routes INTEGER DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Driver hours tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_hours (
        id SERIAL PRIMARY KEY,
        staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
        transponder_id VARCHAR(50),
        week_start DATE NOT NULL,
        hours_worked DECIMAL(5,2) DEFAULT 0,
        source VARCHAR(30) DEFAULT 'manual',
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(staff_id, week_start)
      )
    `);

    // Add scheduler_settings to settings table if missing
    await client.query(`
      INSERT INTO settings (setting_key, setting_value, setting_type, description)
      VALUES
        ('schedule_weeks_ahead', '4', 'number', 'How many weeks ahead the schedule is visible'),
        ('schedule_week_start', '0', 'number', '0=Sunday, 1=Monday')
      ON CONFLICT (setting_key) DO NOTHING
    `);

    // Seed default shift types
    const shiftTypes = [
      { name: 'EDV',        start: '07:00', end: '17:00', color: 'blue',   order: 1 },
      { name: 'STEP VAN',   start: '07:00', end: '17:00', color: 'purple', order: 2 },
      { name: 'ON CALL',    start: '06:00', end: '18:00', color: 'yellow', order: 3 },
      { name: 'EXTRA',      start: '07:00', end: '17:00', color: 'green',  order: 4 },
      { name: 'SUSPENSION', start: '00:00', end: '00:00', color: 'red',    order: 5 },
      { name: 'UTO',        start: '00:00', end: '00:00', color: 'orange', order: 6 },
      { name: 'PTO',        start: '00:00', end: '00:00', color: 'teal',   order: 7 },
      { name: 'TRAINING',   start: '08:00', end: '16:00', color: 'indigo', order: 8 },
    ];
    for (const t of shiftTypes) {
      await client.query(
        `INSERT INTO shift_types (name, default_start_time, default_end_time, color, sort_order)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (name) DO NOTHING`,
        [t.name, t.start, t.end, t.color, t.order]
      );
    }

    await client.query('COMMIT');
    console.log('✅ Schedule migration complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

migrateSchedule();
