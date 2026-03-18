const fs = require('fs');
const path = require('path');
// Write immediately so we know the script started
const logFile = path.join(__dirname, '..', '..', '..', 'import-log.txt');
fs.writeFileSync(logFile, 'SCRIPT STARTED\n');

fs.appendFileSync(logFile, 'Loading dotenv...\n');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

fs.appendFileSync(logFile, 'Loading pool...\n');
const pool = require('./pool');

fs.appendFileSync(logFile, 'Loading bcryptjs...\n');
const bcrypt = require('bcryptjs');

fs.appendFileSync(logFile, 'Loading csv-parse...\n');
const csv = require('csv-parse/sync');

fs.appendFileSync(logFile, 'All modules loaded OK\n');

// Write all output to a log file AND console
const lines = [];
function log(msg) {
  console.log(msg);
  lines.push(msg);
}

async function importAssociates() {
  log('=== Associate Import Started: ' + new Date().toISOString() + ' ===');

  const filePath = path.join(process.cwd(), '..', 'AssociateData (2).csv');
  log('Looking for CSV at: ' + filePath);

  if (!fs.existsSync(filePath)) {
    log('ERROR: CSV file not found at ' + filePath);
    fs.writeFileSync(logFile, lines.join('\n'));
    process.exit(1);
  }

  // Strip BOM if present (Excel CSV files often start with \uFEFF)
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  const records = csv.parse(content, { columns: true, skip_empty_lines: true, trim: true });
  log('Found ' + records.length + ' associates to import...');

  // Log actual column names from first row for debugging
  if (records.length > 0) {
    log('Columns detected: ' + Object.keys(records[0]).join(' | '));
  }

  const passwordHash = await bcrypt.hash('password123', 10);

  let client;
  try {
    client = await pool.connect();
    log('Database connected successfully.');
  } catch (err) {
    log('ERROR: Cannot connect to database: ' + err.message);
    log('Make sure PostgreSQL is running and run: npm run db:setup');
    fs.writeFileSync(logFile, lines.join('\n'));
    process.exit(1);
  }

  let inserted = 0, skipped = 0, errors = 0;

  try {
    await client.query('BEGIN');

    for (const row of records) {
      try {
        // Handle BOM or whitespace variation in the first column name
        const nameKey = Object.keys(row).find(k => k.replace(/^\uFEFF/, '').trim() === 'Name and ID') || Object.keys(row)[0];
        const fullName = (row[nameKey] || '').trim().replace(/\s+/g, ' ');
        if (!fullName) { skipped++; continue; }

        const nameParts = fullName.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || 'Unknown';

        const transponderId = (row['TransporterID'] || '').trim();
        const email = (row['Email'] || '').trim().toLowerCase();
        const personalPhone = (row['Personal Phone Number'] || '').toString().trim();
        const status = (row['Status'] || 'ACTIVE').trim().toLowerCase() === 'active' ? 'active' : 'inactive';
        const qualifications = (row['Qualifications'] || '').trim();
        const position = (row['Position'] || '').trim();

        let licenseExpiration = null;
        const expRaw = (row['ID expiration'] || '').trim();
        if (expRaw) {
          const parts = expRaw.split('/');
          if (parts.length === 3) {
            licenseExpiration = parts[2] + '-' + parts[0].padStart(2,'0') + '-' + parts[1].padStart(2,'0');
          }
        }

        const employeeId = transponderId.substring(0, 20);
        if (!email || !employeeId) {
          log('  SKIP: ' + fullName + ' — missing email or ID');
          skipped++;
          continue;
        }

        const staffResult = await client.query(
          `INSERT INTO staff (employee_id, first_name, last_name, email, phone, role, status, hire_date, password_hash)
           VALUES ($1,$2,$3,$4,$5,'driver',$6,CURRENT_DATE,$7)
           ON CONFLICT (email) DO UPDATE
             SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
                 phone=EXCLUDED.phone, status=EXCLUDED.status, updated_at=NOW()
           RETURNING id`,
          [employeeId, firstName, lastName, email, personalPhone, status, passwordHash]
        );

        const staffId = staffResult.rows[0].id;
        const notes = [
          position ? 'Position: ' + position : '',
          qualifications ? 'Qualifications: ' + qualifications : '',
        ].filter(Boolean).join(' | ');

        await client.query(
          `INSERT INTO drivers (staff_id, transponder_id, license_expiration, notes)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (staff_id) DO UPDATE
             SET transponder_id=EXCLUDED.transponder_id,
                 license_expiration=EXCLUDED.license_expiration,
                 notes=EXCLUDED.notes, updated_at=NOW()`,
          [staffId, transponderId, licenseExpiration, notes]
        );

        log('  OK: ' + firstName + ' ' + lastName + ' (' + transponderId + ')');
        inserted++;
      } catch (err) {
        log('  ERR: ' + (row['Name and ID'] || '?') + ' — ' + err.message);
        errors++;
      }
    }

    await client.query('COMMIT');
    log('\n=== Import Complete ===');
    log('Inserted/Updated: ' + inserted);
    log('Skipped:          ' + skipped);
    log('Errors:           ' + errors);
  } catch (err) {
    await client.query('ROLLBACK');
    log('FATAL: Import rolled back — ' + err.message);
  } finally {
    client.release();
    pool.end();
    fs.writeFileSync(logFile, lines.join('\n'));
  }
}

importAssociates().catch(err => {
  log('UNHANDLED ERROR: ' + err.message);
  fs.writeFileSync(logFile, lines.join('\n'));
  process.exit(1);
});
