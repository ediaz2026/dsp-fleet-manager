require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

async function updateManager() {
  const passwordHash = await bcrypt.hash('password123', 10);
  const client = await pool.connect();
  try {
    // Strategy 1: update by old email
    let result = await client.query(
      `UPDATE staff
       SET first_name = $1, last_name = $2, email = $3, password_hash = $4, updated_at = NOW()
       WHERE email = 'jmitchell@dspfleet.com'
       RETURNING id, first_name, last_name, email, role`,
      ['Eric', 'Diaz', 'ediaz@lsmddsp.com', passwordHash]
    );

    if (result.rowCount > 0) {
      console.log('✅ Updated by old email:', result.rows[0]);
      return;
    }

    // Strategy 2: update by role = manager (not already updated)
    result = await client.query(
      `UPDATE staff
       SET first_name = $1, last_name = $2, email = $3, password_hash = $4, updated_at = NOW()
       WHERE role = 'manager' AND email != 'ediaz@lsmddsp.com'
       RETURNING id, first_name, last_name, email, role`,
      ['Eric', 'Diaz', 'ediaz@lsmddsp.com', passwordHash]
    );

    if (result.rowCount > 0) {
      console.log('✅ Updated by role:', result.rows[0]);
      return;
    }

    // Strategy 3: already updated email — just refresh password
    result = await client.query(
      `UPDATE staff
       SET first_name = $1, last_name = $2, password_hash = $3, updated_at = NOW()
       WHERE email = 'ediaz@lsmddsp.com'
       RETURNING id, first_name, last_name, email, role`,
      ['Eric', 'Diaz', passwordHash]
    );

    if (result.rowCount > 0) {
      console.log('✅ Account already exists, password refreshed:', result.rows[0]);
      return;
    }

    // Strategy 4: no manager at all — insert fresh
    result = await client.query(
      `INSERT INTO staff (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
       VALUES ('MGR001', 'Eric', 'Diaz', 'ediaz@lsmddsp.com', '555-0101', 'manager', 'active', '2022-01-15', $1)
       ON CONFLICT (email) DO UPDATE
         SET first_name = EXCLUDED.first_name,
             last_name  = EXCLUDED.last_name,
             password_hash = EXCLUDED.password_hash,
             updated_at = NOW()
       RETURNING id, first_name, last_name, email, role`,
      [passwordHash]
    );
    console.log('✅ Manager account INSERTED/UPSERTED:', result.rows[0]);

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

updateManager();
