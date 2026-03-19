require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

// Use SSL whenever DATABASE_URL is set (Railway always provides it).
// Local dev uses fallback URL and no SSL.
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

// Routes
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
app.use('/api/cortex-sync', require('./routes/cortexSync'));

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

// Run migrations → seed admin → start server
runMigrations()
  .then(() => ensureAdminAccount())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 DSP Fleet Manager API running on port ${PORT}`);
      console.log(`🗄️  Database: ${isRailway ? 'Railway PostgreSQL (SSL)' : 'Local PostgreSQL'}`);
      console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
  });
