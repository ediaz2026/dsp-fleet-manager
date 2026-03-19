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

// ─── Auto-migrate on startup ───────────────────────────────────────────────
async function runMigrations() {
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isProduction ? { rejectUnauthorized: false } : false,
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
    // Allow requests with no origin (server-to-server, mobile apps, curl)
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
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// In production, serve the built React client from client/dist
// This must come AFTER all /api routes
if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // Catch-all: send index.html for all non-API routes (client-side routing)
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Seed/update admin account on startup ──────────────────────────────────
async function ensureAdminAccount() {
  const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  });
  try {
    const passwordHash = await bcrypt.hash('LastMile2026!', 12);
    // Upsert admin account — safe to run every boot
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

// Run migrations then start server
runMigrations().then(() => ensureAdminAccount()).then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 DSP Fleet Manager API running on port ${PORT}`);
    console.log(`📦 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });
});
