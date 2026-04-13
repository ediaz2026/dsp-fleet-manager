require('dotenv').config();
require('express-async-errors');
// updated: force nodemon reload

// ─── Fail fast if required secrets are missing ─────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Set it in .env before starting.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Railway injects DATABASE_URL automatically — use that to detect production and enable SSL.
// Local dev never sets DATABASE_URL, so SSL is always off locally.
const isRailway = !!process.env.DATABASE_URL;

// ─── Auto-migrate on startup ───────────────────────────────────────────────
async function runMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isRailway ? { rejectUnauthorized: false } : false,
  });
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Database schema applied');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
  } finally {
    await pool.end();
  }
}

// ─── Seed/update admin account on startup ──────────────────────────────────
async function ensureAdminAccount() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isRailway ? { rejectUnauthorized: false } : false,
  });
  try {
    const passwordHash = await bcrypt.hash('LastMile2026!', 12);
    await pool.query(
      `INSERT INTO staff (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
       VALUES ('ADM001','James','Mitchell','admin@lastmiledsp.com','555-0100','admin','active','2022-01-01',$1)
       ON CONFLICT (email) DO UPDATE
         SET first_name    = EXCLUDED.first_name,
             last_name     = EXCLUDED.last_name,
             password_hash = EXCLUDED.password_hash,
             updated_at    = NOW()`,
      [passwordHash]
    );
    console.log('✅ Admin account ready: admin@lastmiledsp.com');
  } catch (err) {
    console.error('⚠️  Admin account seed error:', err.message);
  } finally {
    await pool.end();
  }
}

// ─── Seed additional admin accounts ────────────────────────────────────────
async function ensureAdditionalAdmins() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isRailway ? { rejectUnauthorized: false } : false,
  });
  try {
    const admins = [
      { emp: 'ADM002', first: 'Jose',  last: 'Restrepo', email: 'jrestrepo@lsmddsp.com', pw: process.env.ADMIN_DEFAULT_PASSWORD || 'LastMile2026!' },
      { emp: 'ADM003', first: 'Eric',  last: 'Diaz',     email: 'ediaz@lsmddsp.com',     pw: process.env.ADMIN_DEFAULT_PASSWORD || 'LastMile2026!' },
    ];
    for (const a of admins) {
      const hash = await bcrypt.hash(a.pw, 12);
      await pool.query(
        `INSERT INTO staff (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
         VALUES ($1,$2,$3,$4,'','admin','active','2022-01-01',$5)
         ON CONFLICT (email) DO UPDATE
           SET role          = 'admin',
               password_hash = CASE WHEN staff.password_hash IS NULL THEN EXCLUDED.password_hash ELSE staff.password_hash END,
               updated_at    = NOW()`,
        [a.emp, a.first, a.last, a.email, hash]
      );
    }
    console.log('✅ Additional admin accounts ready (jrestrepo, ediaz)');
  } catch (err) {
    console.error('⚠️  ensureAdditionalAdmins error:', err.message);
  } finally {
    await pool.end();
  }
}

// Ensure upload directories exist
const dirs = ['uploads', 'uploads/inspections', 'uploads/routes', 'uploads/qrcodes'];
dirs.forEach(dir => {
  const p = path.join(__dirname, '..', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// CORS — allow localhost in dev + Railway production URL
const allowedOrigins = [
  'http://localhost:5173',
  'https://dsp-fleet-manager-production.up.railway.app',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Rate limiting ──────────────────────────────────────────────────────────
const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // max 10 attempts per IP per window
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/inspections', require('./routes/inspections'));
app.use('/api/amazon-routes', require('./routes/amazonRoutes'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/admin',   require('./routes/admin'));
app.use('/api/repairs', require('./routes/repairs'));
app.use('/api/driver-reports', require('./routes/driverReports'));
app.use('/api/ops-planner', require('./routes/opsPlanner'));
app.use('/api/ops', require('./routes/pickList'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/analytics',   require('./routes/analytics'));
app.use('/api/scorecard',   require('./routes/scorecard'));
app.use('/api/amazon-scorecard', require('./routes/amazonScorecard'));
app.use('/api/cortex-sync', require('./routes/cortexSync'));
app.use('/api/import-data', require('./routes/importData'));
app.use('/api/vendors',    require('./routes/vendors'));
app.use('/api/audit-log',     require('./routes/auditLog'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/van-affinity', require('./routes/vanAffinity'));

// Temporary diagnostic (remove after use)
app.get('/api/diag-sean-callout', async (req, res) => {
  const pool = require('./db/pool');
  const { rows: att } = await pool.query(`
    SELECT a.staff_id, s.first_name, s.last_name, a.status, a.attendance_date
    FROM attendance a JOIN staff s ON s.id = a.staff_id
    WHERE a.attendance_date = '2026-04-12' AND s.first_name ILIKE '%sean%'
  `);
  const { rows: ops } = await pool.query(`
    SELECT oa.staff_id, s.first_name, s.last_name, oa.route_code, oa.removed_from_ops
    FROM ops_assignments oa JOIN staff s ON s.id = oa.staff_id
    WHERE oa.plan_date = '2026-04-12' AND s.first_name ILIKE '%sean%'
  `);
  res.json({ attendance: att, ops_assignment: ops });
});

// Health check
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date(),
  railway: isRailway,
  env: process.env.NODE_ENV || 'development',
}));

// ─── Debug endpoint (no auth) — shows DB tables + row counts ───────────────
app.get('/api/debug', async (req, res) => {
  const pool = require('./db/pool');
  const results = { isRailway, env: process.env.NODE_ENV || 'development', tables: {}, errors: [] };

  // Mask connection string for safety
  const connStr = process.env.DATABASE_URL || 'local';
  results.dbHost = connStr.replace(/\/\/[^@]+@/, '//***:***@');

  const tables = [
    'staff', 'drivers', 'vehicles', 'shifts', 'attendance',
    'payroll_records', 'inspections', 'amazon_routes',
    'driver_recurring_shifts', 'shift_types', 'settings',
    'repairs', 'fleet_alerts', 'consequence_rules',
  ];

  for (const table of tables) {
    try {
      const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM ${table}`);
      results.tables[table] = parseInt(rows[0].count, 10);
    } catch (err) {
      results.tables[table] = `ERROR: ${err.message}`;
      results.errors.push(`${table}: ${err.message}`);
    }
  }

  // Sample a staff row to confirm data shape
  try {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, role, status FROM staff LIMIT 3`
    );
    results.staffSample = rows;
  } catch (err) {
    results.staffSample = `ERROR: ${err.message}`;
  }

  console.log('[DEBUG] Table counts:', JSON.stringify(results.tables));
  res.json(results);
});

// Serve the built React client — check if client/dist exists
const clientDist = path.join(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler — logs full details to Railway logs
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}`);
  console.error(`[ERROR] Message: ${err.message}`);
  if (err.stack) console.error(`[ERROR] Stack: ${err.stack}`);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Ensure Ops Planner v2 tables exist ────────────────────────────────────
async function ensureOpsV2Tables() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isRailway ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ops_roster (
        id              SERIAL PRIMARY KEY,
        plan_date       DATE NOT NULL UNIQUE,
        file_name       VARCHAR(255),
        drivers_by_date JSONB NOT NULL DEFAULT '{}',
        available_dates JSONB NOT NULL DEFAULT '[]',
        created_by      INT REFERENCES staff(id),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ops_daily_routes (
        id          SERIAL PRIMARY KEY,
        plan_date   DATE NOT NULL UNIQUE,
        file_name   VARCHAR(255),
        routes      JSONB NOT NULL DEFAULT '[]',
        created_by  INT REFERENCES staff(id),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ops_loadout (
        id          SERIAL PRIMARY KEY,
        plan_date   DATE NOT NULL UNIQUE,
        file_name   VARCHAR(255),
        loadout     JSONB NOT NULL DEFAULT '[]',
        created_by  INT REFERENCES staff(id),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ops_assignments (
        id          SERIAL PRIMARY KEY,
        plan_date   DATE NOT NULL,
        staff_id    INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        vehicle_id  INT REFERENCES vehicles(id) ON DELETE SET NULL,
        device_id   VARCHAR(100),
        notes       TEXT,
        UNIQUE(plan_date, staff_id),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ops_assignments_date ON ops_assignments(plan_date)`);
    // Extend ops_assignments with additional fields (idempotent)
    await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS shift_type       VARCHAR(50)`);
    await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS route_code       VARCHAR(50)`);
    await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS name_override    VARCHAR(255)`);
    // Loadout override columns (inline editing in Ops Planner)
    await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS wave_override     VARCHAR(20)`);
    await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS staging_override  VARCHAR(100)`);
    await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS canopy_override   VARCHAR(20)`);
    await pool.query(`ALTER TABLE ops_assignments ADD COLUMN IF NOT EXISTS launchpad_override VARCHAR(100)`);
    console.log('✅ Ops Planner v2 tables ready (ops_roster, ops_daily_routes, ops_loadout, ops_assignments)');
  } catch (err) {
    console.error('⚠️  Ops v2 table error:', err.message);
  } finally {
    await pool.end();
  }
}

// ─── Ensure recurring_skip table exists (needed for copy-last-week) ──────────
async function ensureRecurringSkip() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isRailway ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recurring_skip (
        staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        skip_date DATE    NOT NULL,
        PRIMARY KEY (staff_id, skip_date)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_recurring_skip_date ON recurring_skip(skip_date)`);
    console.log('✅ recurring_skip table ready');
  } catch (err) {
    console.error('⚠️  recurring_skip table error:', err.message);
  } finally {
    await pool.end();
  }
}

// Ensure Master Driver columns exist (personal_email on staff)
async function ensureMasterDriverColumns() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isRailway ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS personal_email VARCHAR(255)`);
    console.log('✅ Master driver columns ready');
  } catch (err) {
    console.error('⚠️  ensureMasterDriverColumns error:', err.message);
  } finally {
    await pool.end();
  }
}

// ─── Ensure shift publish-tracking columns exist ────────────────────────────
async function ensureShiftPublishColumns() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isRailway ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS was_published BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS prev_shift_type VARCHAR(50)`);
    console.log('✅ Shift publish-tracking columns ready');
  } catch (err) {
    console.error('⚠️  ensureShiftPublishColumns error:', err.message);
  } finally {
    await pool.end();
  }
}

// ─── Ensure route_commitments daily_targets column exists ──────────────────
async function ensureRcDailyTargets() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isRailway ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query(`ALTER TABLE route_commitments ADD COLUMN IF NOT EXISTS daily_targets JSONB DEFAULT '{}'`);
    console.log('✅ route_commitments daily_targets column ready');
  } catch (err) {
    console.error('⚠️  ensureRcDailyTargets error:', err.message);
  } finally {
    await pool.end();
  }
}

// Run migrations → seed admin → ensure aux tables → start server
runMigrations()
  .then(() => ensureAdminAccount())
  // Fix VIN column length early before any vehicle inserts
  .then(() => require('./db/pool').query(`ALTER TABLE vehicles ALTER COLUMN vin TYPE VARCHAR(50)`).catch(e => console.log('VIN migration:', e.message)))
  .then(() => require('./db/pool').query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS license_expiration DATE`).catch(e => console.log('license_expiration migration:', e.message)))
  .then(() => ensureOpsV2Tables())
  .then(() => ensureRecurringSkip())
  .then(() => ensureMasterDriverColumns())
  .then(() => ensureShiftPublishColumns())
  // migrateScheduleTables must run before ensureRcDailyTargets so route_commitments exists
  .then(() => require('./db/migrateScheduleTables')().catch(err => console.error('⚠️  migrateScheduleTables error:', err.message)))
  .then(() => ensureRcDailyTargets())
  .then(() => require('./db/migrateAnalytics')().catch(err => console.error('⚠️  migrateAnalytics error:', err.message)))
  .then(() => require('./db/migrateScorecard')().catch(err => console.error('⚠️  migrateScorecard error:', err.message)))
  .then(() => require('./db/migrateOpsPlannerTables')().catch(err => console.error('⚠️  migrateOpsPlannerTables error:', err.message)))
  .then(() => require('./db/migrateRepairsTables')().catch(err => console.error('⚠️  migrateRepairsTables error:', err.message)))
  .then(() => require('./db/migrateImportColumns')().catch(err => console.error('⚠️  migrateImportColumns error:', err.message)))
  .then(() => require('./db/migrateAuditLog')().catch(err => console.error('⚠️  migrateAuditLog error:', err.message)))
  .then(() => require('./db/migrateNotifications')().catch(err => console.error('⚠️  migrateNotifications error:', err.message)))
  .then(() => require('./db/migrateCleanupOrphans')().catch(err => console.error('⚠️  migrateCleanupOrphans error:', err.message)))
  .then(() => require('./db/migrateVehicleStatus')().catch(err => console.error('⚠️  migrateVehicleStatus error:', err.message)))
  .then(() => require('./db/migratePasswordReset')().catch(err => console.error('⚠️  migratePasswordReset error:', err.message)))
  .then(() => ensureAdditionalAdmins())
  // Clean up non-working drivers from future ops_assignments on startup
  .then(() => require('./db/pool').query(`
    DELETE FROM ops_assignments
    WHERE plan_date >= CURRENT_DATE
      AND EXISTS (
        SELECT 1 FROM shifts s
        WHERE s.staff_id = ops_assignments.staff_id
          AND s.shift_date = ops_assignments.plan_date
          AND UPPER(s.shift_type) IN ('ON CALL','UTO','PTO','SUSPENSION','TRAINING','TRAINER')
      )
  `).then(r => { if (r.rowCount > 0) console.log(`[cleanup] Removed ${r.rowCount} non-working driver(s) from Ops Planner`); })
    .catch(e => console.log('Ops cleanup:', e.message)))
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 DSP Fleet Manager API running on port ${PORT}`);
      console.log(`🗄️  Database: ${isRailway ? 'Railway PostgreSQL (SSL)' : 'Local PostgreSQL'}`);
      console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
  });
