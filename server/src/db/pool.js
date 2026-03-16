const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsp_manager',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle DB client:', err.message);
});

// Test connection on startup
pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL connected');
    client.release();
  })
  .catch(err => {
    console.error('❌ PostgreSQL connection failed:', err.message);
    console.error('   Run: createdb dsp_manager && npm run db:migrate && npm run db:seed');
  });

module.exports = pool;
