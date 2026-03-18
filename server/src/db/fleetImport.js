/**
 * fleetImport.js
 * Wipes all vehicle records and inserts exactly 49 vehicles.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('./pool');
const fs   = require('fs');
const path = require('path');

const RESULT_FILE = path.join(process.cwd(), 'fleet-import-result.json');
fs.writeFileSync(RESULT_FILE, JSON.stringify({ status: 'started', ts: new Date() }));

// Fields: [vin, service_type_raw, vehicle_name, license_plate, make, model,
//          status_note, operational_status, vehicle_provider, year,
//          ownership_type_label, ownership_type_code, ownership_start,
//          ownership_end, registration_expiry, registered_state, category]
const VEHICLES = [
  ['1F65F5KN3M0A01839','Standard Parcel Step Van - US','SV43','60AUXH','Ford','Stripped Chassis','','OPERATIONAL','LP',2021,'Amazon-owned','AMAZON_OWNED','2021-10-26','2041-10-26','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB76PN010917','Standard Parcel Electric - Rivian MEDIUM','EV 08','04DZIH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-17','2043-09-17','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB26SN034812','Standard Parcel Electric - Rivian MEDIUM','EV 34','Y148091','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2025,'Amazon Branded Last Mile Rental (781621)','AMAZON_RENTAL','2026-01-20','2026-03-28','2027-12-30','OR - Oregon','EDV'],
  ['7FCEHEB76PN010304','Standard Parcel Electric - Rivian MEDIUM','EV 04','11DZKH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-11','2043-09-11','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB77PN010912','Standard Parcel Electric - Rivian MEDIUM','EV 13','94DZII','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-15','2043-09-15','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB78PN016069','Standard Parcel Electric - Rivian MEDIUM','EV 28','RMJQ56','Rivian','EDV 700','','OPERATIONAL','LP',2023,'Amazon-owned','AMAZON_OWNED','2024-09-12','2044-09-12','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB25SN034817','Standard Parcel Electric - Rivian MEDIUM','EV 33','Y148094','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2025,'Amazon Branded Last Mile Rental (780481)','AMAZON_RENTAL','2026-01-20','2026-03-28','2027-12-30','OR - Oregon','EDV'],
  ['1F65F5KN8M0A01402','Standard Parcel Step Van - US','SV41','31ASKR','Ford','Stripped Chassis','','OPERATIONAL','LP',2021,'Amazon-owned','AMAZON_OWNED','2021-10-24','2041-10-24','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB75PN010486','Standard Parcel Electric - Rivian MEDIUM','EV 01','15DZKH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-13','2043-09-13','2026-12-30','FL - Florida','EDV'],
  ['1F65F5KN9M0A01683','Standard Parcel Step Van - US','SV46','37ASKR','Ford','Stripped Chassis','','OPERATIONAL','LP',2021,'Amazon-owned','AMAZON_OWNED','2021-10-28','2041-10-28','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB28RN023711','Standard Parcel Electric - Rivian MEDIUM','EV 29','DH68SF','Rivian','EDV 700','','OPERATIONAL','LP',2024,'Amazon-owned','AMAZON_OWNED','2024-11-07','2044-11-07','2026-12-30','FL - Florida','EDV'],
  ['1F65F5KN6L0A01915','Standard Parcel Step Van - US','SV39','PVSK34','Ford','Stripped Chassis','Until 2040-10-30.','OPERATIONAL','ELEMENT',2020,'Amazon-leased','AMAZON_LEASED','2020-10-30','2040-10-30','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB74PN010298','Standard Parcel Electric - Rivian MEDIUM','EV 05','13DZKH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-11','2043-09-11','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB71PN014003','Standard Parcel Electric - Rivian MEDIUM','EV 22','86DZIH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-11-08','2043-11-08','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB77PN010926','Standard Parcel Electric - Rivian MEDIUM','EV 11','89DZII','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-17','2043-09-17','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB28SN034813','Standard Parcel Electric - Rivian MEDIUM','EV 36','Y148092','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2025,'Amazon Branded Last Mile Rental (780645)','AMAZON_RENTAL','2026-01-20','2026-03-28','2027-12-30','OR - Oregon','EDV'],
  ['7FCEHEB27SN034835','Standard Parcel Electric - Rivian MEDIUM','EV 35','Y148103','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2025,'Amazon Branded Last Mile Rental (778663)','AMAZON_RENTAL','2026-01-20','2026-03-28','2027-12-30','OR - Oregon','EDV'],
  ['7FCEHEB78PN011289','Standard Parcel Electric - Rivian MEDIUM','EV 25','99DZIZ','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2024-04-15','2044-04-15','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB75PN010973','Standard Parcel Electric - Rivian MEDIUM','EV 10','26DZJM','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-19','2043-09-19','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB76PN010769','Standard Parcel Electric - Rivian MEDIUM','EV 18','14DZIY','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-20','2043-09-20','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB78PN010384','Standard Parcel Electric - Rivian MEDIUM','EV 03','10DZKH','Rivian','EDV 700','','GROUNDED','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-11','2043-09-11','2026-12-30','FL - Florida','EDV'],
  ['1F65F5KN2L0A03354','Standard Parcel Step Van - US','SV38','PVSK39','Ford','Stripped Chassis','Until 2040-10-30.','OPERATIONAL','ELEMENT',2020,'Amazon-leased','AMAZON_LEASED','2020-10-30','2040-10-30','2026-12-30','FL - Florida','STEP VAN'],
  ['1F65F5KN4M0A01722','Standard Parcel Step Van - US','SV42','49ASKR','Ford','Stripped Chassis','','OPERATIONAL','LP',2021,'Amazon-owned','AMAZON_OWNED','2021-10-24','2041-10-24','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB78PN010904','Standard Parcel Electric - Rivian MEDIUM','EV 17','98DZII','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-17','2043-09-17','2026-12-30','FL - Florida','EDV'],
  ['1F65F5KN7L0A03348','Standard Parcel Step Van - US','SV36','PVSK46','Ford','Stripped Chassis','Until 2040-11-04.','OPERATIONAL','ELEMENT',2020,'Amazon-leased','AMAZON_LEASED','2020-11-04','2040-11-04','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB77PN010764','Standard Parcel Electric - Rivian MEDIUM','EV 16','86DZIW','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-20','2043-09-20','2026-12-30','FL - Florida','EDV'],
  ['1F65F5KN0M0A01734','Standard Parcel Step Van - US','SV44','51ASKR','Ford','Stripped Chassis','','OPERATIONAL','LP',2021,'Amazon-owned','AMAZON_OWNED','2021-10-23','2041-10-23','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB73PN014004','Standard Parcel Electric - Rivian MEDIUM','EV 21','67DZIZ','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-11-10','2043-11-10','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB70PN014011','Standard Parcel Electric - Rivian MEDIUM','EV 20','85DZIH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-11-06','2043-11-06','2026-12-30','FL - Florida','EDV'],
  ['1FTBR1Y86SKA53758','Rental','RENT 1','AM98308','Ford','Transit','Until 2026-03-18.','OPERATIONAL','U Haul',2025,'Rental','RENTAL','2026-03-16','2026-03-18',null,'AZ - Arizona','OTHER'],
  ['7FCEHEB75PN010925','Standard Parcel Electric - Rivian MEDIUM','EV 09','87DZII','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-17','2043-09-17','2026-12-30','FL - Florida','EDV'],
  ['1F65F5KN0L0A01909','Standard Parcel Step Van - US','SV40','PVSK38','Ford','Stripped Chassis','Until 2040-10-30.','OPERATIONAL','ELEMENT',2020,'Amazon-leased','AMAZON_LEASED','2020-10-30','2040-10-30','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB76PN010786','Standard Parcel Electric - Rivian MEDIUM','EV 27','59DZIZ','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2024-04-15','2044-04-15','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB75PN011511','Standard Parcel Electric - Rivian MEDIUM','EV 37','06DZIZ','Rivian','EDV 700','Until 2026-12-31.','OPERATIONAL','ELEMENT',2023,'Amazon Branded Last Mile Rental (783985)','AMAZON_RENTAL','2026-02-19','2026-12-31','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB70PN012386','Standard Parcel Electric - Rivian MEDIUM','EV 38','Y143842','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2023,'Amazon Branded Last Mile Rental (779408)','AMAZON_RENTAL','2026-02-19','2026-03-28','2027-12-30','OR - Oregon','EDV'],
  ['7FCEHEB71PN010940','Standard Parcel Electric - Rivian MEDIUM','EV 07','85DZII','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-14','2043-09-14','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB74PN010964','Standard Parcel Electric - Rivian MEDIUM','EV 19','95DZII','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-19','2043-09-19','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB71PN010520','Standard Parcel Electric - Rivian MEDIUM','EV 23','26DZKH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2024-05-05','2044-05-05','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB2XRN020535','Standard Parcel Electric - Rivian MEDIUM','EV 31','Y143879','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2024,'Amazon Branded Last Mile Rental (778089)','AMAZON_RENTAL','2026-01-20','2026-03-28','2027-12-30','OR - Oregon','EDV'],
  ['7FCEHEB76PN010903','Standard Parcel Electric - Rivian MEDIUM','EV 12','02DZIH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-17','2043-09-17','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB7XPN008278','Standard Parcel Electric - Rivian MEDIUM','EV 30','65DZKH','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2023,'Amazon Branded Last Mile Rental (785414)','AMAZON_RENTAL','2026-01-26','2026-03-28','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB77PN010523','Standard Parcel Electric - Rivian MEDIUM','EV 26','23DZHZ','Rivian','EDV 700','','GROUNDED','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2024-04-15','2044-04-15','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB21SN034815','Standard Parcel Electric - Rivian MEDIUM','EV 32','Y148093','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2025,'Amazon Branded Last Mile Rental (778428)','AMAZON_RENTAL','2026-01-20','2026-03-28','2027-12-30','OR - Oregon','EDV'],
  ['7FCEHEB71PN011280','Standard Parcel Electric - Rivian MEDIUM','EV 24','93DZIZ','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2024-04-15','2044-04-15','2026-12-30','FL - Florida','EDV'],
  ['1F65F5KN8M0A01738','Standard Parcel Step Van - US','SV45','52ASKR','Ford','Stripped Chassis','','OPERATIONAL','LP',2021,'Amazon-owned','AMAZON_OWNED','2021-10-28','2041-10-28','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB74PN010494','Standard Parcel Electric - Rivian MEDIUM','EV 15','14DZKH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-14','2043-09-14','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB76PN010366','Standard Parcel Electric - Rivian MEDIUM','EV 02','12DZKH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-11','2043-09-11','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB77PN010974','Standard Parcel Electric - Rivian MEDIUM','EV 14','60DZGX','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-21','2043-09-21','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB77PN010490','Standard Parcel Electric - Rivian MEDIUM','EV 06','16DZKH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-13','2043-09-13','2026-12-30','FL - Florida','EDV'],
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('==============================================');
    console.log('  Fleet Import — Wipe + 49 Vehicles');
    console.log('==============================================\n');

    // Ensure columns exist
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS service_type VARCHAR(50)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status_note TEXT`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_provider VARCHAR(100)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_label VARCHAR(100)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_code VARCHAR(50)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_start_date DATE`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_end_date DATE`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registered_state VARCHAR(50)`);

    // Step 1: wipe all vehicle data
    await client.query('BEGIN');
    await client.query('DELETE FROM inspection_photos');
    await client.query('DELETE FROM inspections');
    await client.query('DELETE FROM fleet_alerts');
    await client.query('SAVEPOINT sp_repairs');
    try { await client.query('DELETE FROM repairs'); }
    catch { await client.query('ROLLBACK TO SAVEPOINT sp_repairs'); }
    await client.query('RELEASE SAVEPOINT sp_repairs');
    await client.query('DELETE FROM vehicles');
    await client.query('COMMIT');
    console.log('  All vehicles wiped.\n');

    // Step 2: insert 49 vehicles
    let inserted = 0, errors = 0;
    const grounded = [];
    const categoryCounts = { 'EDV': 0, 'STEP VAN': 0, 'OTHER': 0 };

    await client.query('BEGIN');
    for (const [vin, _raw, vname, plate, make, model, statusNote, opStatus,
                 provider, year, ownerLabel, ownerCode, ownStart, ownEnd,
                 regExp, regState, category] of VEHICLES) {
      try {
        const status = opStatus === 'OPERATIONAL' ? 'active' : 'inactive';
        if (status === 'inactive') grounded.push(vname);
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;

        await client.query(
          `INSERT INTO vehicles
             (vin, vehicle_name, license_plate, make, model, year, status,
              service_type, status_note, vehicle_provider,
              ownership_type_label, ownership_type_code,
              ownership_start_date, ownership_end_date,
              registration_expiration, registered_state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [vin, vname, plate || null, make || null, model || null, year || null, status,
           category || null, statusNote || null, provider || null,
           ownerLabel || null, ownerCode || null,
           ownStart || null, ownEnd || null,
           regExp || null, regState || null]
        );
        inserted++;
      } catch (e) {
        console.error(`  ERR ${vname}: ${e.message}`);
        errors++;
      }
    }
    await client.query('COMMIT');

    const result = {
      status: 'success',
      total_inserted: inserted,
      edv_count: categoryCounts['EDV'] || 0,
      step_van_count: categoryCounts['STEP VAN'] || 0,
      other_count: categoryCounts['OTHER'] || 0,
      grounded: grounded,
      errors,
      ts: new Date(),
    };
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));

    console.log('==============================================');
    console.log(`  ${inserted} vehicles inserted`);
    console.log(`  EDV:      ${categoryCounts['EDV'] || 0}`);
    console.log(`  STEP VAN: ${categoryCounts['STEP VAN'] || 0}`);
    console.log(`  OTHER:    ${categoryCounts['OTHER'] || 0}`);
    console.log(`  Grounded: ${grounded.join(', ')}`);
    if (errors) console.log(`  Errors:   ${errors}`);
    console.log('==============================================\n');

  } catch (err) {
    fs.writeFileSync(RESULT_FILE, JSON.stringify({ status: 'error', error: err.message, ts: new Date() }, null, 2));
    await client.query('ROLLBACK').catch(() => {});
    console.error('FATAL:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

run();
