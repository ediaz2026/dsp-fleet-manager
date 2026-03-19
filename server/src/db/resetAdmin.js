require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function resetAdmin() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting admin reset...');

    const passwordHash = await bcrypt.hash('LastMile2026!', 12);

    // Remove ALL existing admin/manager accounts
    const deleted = await client.query(
      `DELETE FROM staff WHERE role IN ('admin', 'manager') RETURNING email`
    );
    if (deleted.rowCount > 0) {
      console.log(`🗑️  Removed ${deleted.rowCount} existing admin/manager account(s):`);
      deleted.rows.forEach(r => console.log(`   - ${r.email}`));
    } else {
      console.log('ℹ️  No existing admin/manager accounts found.');
    }

    // Create fresh admin account
    const result = await client.query(
      `INSERT INTO staff
         (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
       VALUES
         ('ADM001', 'James', 'Mitchell', 'admin@lastmiledsp.com', '555-0100', 'admin', 'active', '2022-01-01', $1)
       RETURNING id, first_name, last_name, email, role`,
      [passwordHash]
    );

    const admin = result.rows[0];
    console.log('');
    console.log('✅ Admin reset complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   ID:       ${admin.id}`);
    console.log(`   Name:     ${admin.first_name} ${admin.last_name}`);
    console.log(`   Email:    ${admin.email}`);
    console.log(`   Password: LastMile2026!`);
    console.log(`   Role:     ${admin.role}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

  } catch (err) {
    console.error('❌ Reset failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

resetAdmin();
