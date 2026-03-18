/**
 * fullImport.js
 * Complete wipe and reimport of all driver/vehicle/shift data.
 * Preserves: non-driver staff accounts, settings, consequence_rules, day_schedules.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('./pool');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const RESULT_FILE = path.join(process.cwd(), 'full-import-result.json');
fs.writeFileSync(RESULT_FILE, JSON.stringify({ status: 'started', ts: new Date() }));

// ─── Driver data ─────────────────────────────────────────────────────────────
// Fields: [transporter_id, first_name, last_name, license_number, dob, license_expiration, hire_date, employee_code]
const DRIVERS = [
  ['A3APVAFB4U6920','Orlando','Beltran','B227-841-31-800-0','1987-04-10','2028-04-10','2025-09-16','A0KM'],
  ['A2UVQLHHJE7SH8','Beatriz','Mantilla Medina','M624230111000','1995-06-03','2034-06-03','2025-10-15','A0L5'],
  ['A11PSXNK6UNE9S','Ray Alejandro','Hernandez Perdomo','H614869963000','2002-12-06','2026-09-25','2025-10-14','A0L4'],
  ['A2S7U32M9G1QS8','Gabriela Alexandra','Zayas Millan','Z605418603000','2003-07-22','2030-07-22','2025-10-09','A0KY'],
  ['A5RU2SIIP4L6C','Gabriela De La Caridad','Gonzalez Soto','G240-322-47-000-0','1996-08-17','2028-08-17','2025-10-03','A0KX'],
  ['A18TBZ3KK020CA','Iyana Daquan','Jackson','J239866118000','2001-06-02','2033-06-02','2025-10-04','A0KW'],
  ['A36QOQK20T8GF','Javier','Morice Magana','M620070535000','1986-05-16','2026-05-06','2025-09-26','A0KU'],
  ['A1LMJR7V6FW8LI','Jeins','Baez Fernandez','B603945955000','1995-08-16','2028-08-28','2025-09-25','A0KS'],
  ['A9ZYO2HNH2HEN','Frank Ernesto','Pons Lorenzo','P524265013800','2001-10-23','2026-10-20','2025-09-23','A0KP'],
  ['A315ATME06HMU0','Ylena','Aroche','A622960026830','2002-05-23','2031-05-23','2025-09-16','A0KN'],
  ['A2GG0KKBFAQV7E','Kiondae Ja\'quan','Wilson','W425510000460','2000-02-06','2033-02-06','2025-10-24','A0L9'],
  ['ABS5LT1T7PN4K','Hector Eduardo','Delgado Veloz','D423325950840','1995-03-04','2033-03-04','2025-09-15','A0KK'],
  ['A3NQG3MT0XQTQL','Lazaro Duniel','Almeida Machin','A607476635000','1992-11-19','2026-09-08','2025-09-09','A0KJ'],
  ['AO46ZDLF93575','Melysse','Fundora Agrelo','F242881104000','1998-04-16','2027-04-16','2025-09-03','A0KI'],
  ['A31BP7FXL56NFQ','Dayron','Morales Gonzalez','M642160852140','1985-06-14','2028-06-14','2025-08-31','A0KH'],
  ['A3JIIKWM0J75R5','Dayron Gilberto','Martin Garcia','M635167914170','1991-11-17','2031-11-17','2025-08-31','A0KF'],
  ['A1HHLXYT7PPDBI','Nelson','Aroche','A622639953880','1995-10-28','2031-10-28','2025-06-16','A0K0'],
  ['A34X8A2GXV6L7P','Carlos','Gonzalez Ruiz','G524116931100','1993-03-30','2033-03-30','2025-06-16','A0JY'],
  ['A2QISNYM51AQWU','Miladys','Cazorla','C264-540-98-903-0','1998-11-03','2032-11-03','2025-06-08','A0JX'],
  ['A1PZQ8VJ21TRPI','Ricardo','Bonilla','B617420631000','1998-01-25','2026-07-16','2025-06-10','A0JV'],
  ['A2PMHCOWGAU9YS','Lucas','Borges De Lima','B630-536-17-500-0','2002-02-22','2034-02-22','2026-02-07','A0M8'],
  ['A34AAMOW73CF8R','Angel Santiago','Pazos Gonzalez','P636-660-52-700-0','1999-07-14','2034-07-14','2026-03-18','A0MJ'],
  ['A22379KRHL7YE8','Roger Alexander','Fonnegra','F232950920000','1975-06-28','2030-06-28','2026-03-10','A0MH'],
  ['A2XKEV21O95P4B','Karen-Beta Elizabeth','Langebeck','L388658220000','1983-01-18','2028-01-18','2026-03-03','A0MG'],
  ['A3AQNRB4ZCCCQ8','Marlon Bladimir','Zapata Alvarez','Z637-273-06-500-0','1996-10-10','2026-12-04','2026-03-01','A0MF'],
  ['A3R2J4TE8GM7W','Jacky Josue','Soto Tenorio','S636129953000','2002-12-27','2026-10-02','2026-02-27','A0ME'],
  ['AK6H2CCQMPGFT','Maike Alexander','Montero','M634248065000','2003-06-29','2034-06-29','2026-02-17','A0MC'],
  ['A24VDJ5GQPRV9S','David Alejandro','Rodriguez Gil','R616207443000','1998-07-19','2026-04-02','2026-02-15','A0MB'],
  ['A3EAJBDQP0Y920','Lawrence Jamahl','Kelly','K400530863060','1986-08-26','2028-08-26','2026-02-14','A0MA'],
  ['A24TVC93K7D0XO','Monica','Leyva Leal','L624095385000','2003-03-30','2026-10-07','2026-02-11','A0M9'],
  ['A28AVI140RSXDI','Daniel','Gonzalez','G605167687000','1996-12-25','2026-06-09','2025-06-05','A0JS'],
  ['A2WI5XG9ODY9EQ','Reynier','Barrios Barrios','B631981453000','1983-05-12','2026-12-28','2026-02-06','A0M7'],
  ['A26I0859UVGS1J','Dayron','Prats Jorrin','P-245-855-90-800-0','1994-04-05','2028-08-22','2026-02-06','A0M4'],
  ['A19ZHGJ3B08TBL','Vernante','Jacqueslouis','J224-860-03-750-0','2003-07-10','2029-07-10','2025-12-12','A0LV'],
  ['A3JRYXJ9RXC9KY','Leosbey','Contreras Diaz','C235-546-33-200-0','1980-12-23','2033-12-23','2025-11-09','A0LN'],
  ['A15HK33EWLJVQE','Yeinier','Jimenez Gonzalez','J552-960-89-023-0','1989-01-23','2032-01-23','2025-11-06','A0LH'],
  ['A2LT1XGPTZWNBH','Fernando Josue','Lemus Rivera','L245-125-03-000-0','2000-10-18','2033-10-18','2025-10-29','A0LG'],
  ['A1JAOH96I67FU1','Eduardo','Travieso','T612-200-99-258-0','1999-07-18','2031-07-18','2025-10-30','A0LE'],
  ['A3J8TPD3WX5E0F','Eduardo Lazaro','Horta Herrera','H622-838-57-9000','1997-02-21','2034-02-21','2025-10-28','A0LD'],
  ['A3QIALKJ6UF4FR','Eduardo','Zamora','Z560200944240','1994-11-24','2031-11-24','2024-04-08','A0GX'],
  ['AYXY146RKYXBE','Sean','Curtis','C632781902860','1990-08-06','2028-08-06','2021-05-02','A06Y'],
  ['A15J66FJLIJ8OW','Lazaro','Hernandez','H655533912450','1991-07-05','2032-07-05','2021-06-27','A080'],
  ['A1V2543ZO8MSIL','Jacson','Dey','D235688862000','1985-05-06','2033-05-06','2021-09-13','A08X'],
  ['A24LWOLZJK84YP','Fulvio','Parra','P616240832160','1983-06-16','2028-06-21','2020-08-10','A04Y'],
  ['A2B8HUV3KIIG6H','Alejandro','Rossler','R246000002700','2000-07-30','2033-07-30','2021-10-26','A09K'],
  ['A1LVJSLESWJUSS','Maria Clara','Leon','L516543997420','1999-07-02','2033-07-02','2022-05-16','A0AD'],
  ['A49DVGPXA2AN6','Tequila','Pierce','P620819936880','1993-05-28','2027-05-28','2020-03-15','A03S'],
  ['AWQFUWGS9YEAA','Odalys','Fernandez','F655640789590','1978-12-19','2032-12-19','2022-11-04','A0CA'],
  ['A38O2C9VR4PFXQ','Isaiah','Johnson','J525401943910','1994-10-31','2027-10-31','2023-05-01','A0D9'],
  ['A2FX0AEQ68MRI8','Marlon','Lawrence','L652-559-01-189-0','2001-05-29','2029-05-29','2023-06-22','A0DP'],
  ['A3CTPTMOYR8A1D','Juan','Quintana','Q535423953670','1995-10-07','2033-10-07','2023-09-21','A0FF'],
  ['A1HNR3M55V3HDT','Glenda','Torres','T624280947140','1994-06-14','2032-06-14','2023-09-25','A0FH'],
  ['A13VPH72Z053GG','Jose','Darias Cruz','D614485779000','1990-07-26','2029-04-03','2023-10-18','A0FQ'],
  ['A1E15FQ9YMG0S2','Ernesto De La Paz','Calderin','D412212903010','1990-08-21','2032-08-21','2024-03-18','A0GL'],
  ['A22DW3XS0YGP7L','Carlos','Tano','T613097563000','2000-11-28','2026-05-27','2024-03-18','A0GP'],
  ['AN0XBCLO6WNTP','Javier','Moreno Hernandez','M656425922190','1992-06-19','2033-06-19','2024-10-09','A0I2'],
  ['A1ICVAHM8L61K5','Roberto','Garcia','G238-361-92-800-0','1998-02-21','2034-02-21','2025-05-15','A0JQ'],
  ['A1YMB1L4P66BCB','Rodolfo','Garcia','G620734690060','1969-01-06','2028-01-06','2019-10-15','A038'],
  ['A12RISWJX5AHIR','Dayvel','Gonzalez','G524160030180','2003-01-18','2026-03-26','2024-11-20','A0J5'],
  ['A3VNUAL4SX2G0Z','Christian','Gavidia','G131117983870','1998-10-27','2028-03-08','2024-11-10','A0J0'],
  ['A2TRU3NKMBUJ3N','Jose L','Gonzalez','G524432810090','1981-01-09','2034-01-09','2024-10-31','A0IN'],
  ['AE4Y1PTOLD1SC','Mario','Torres','T620556922850','1992-08-05','2028-08-05','2024-10-27','A0IJ'],
  ['ABISPT6QAXLFZ','Rene Antonio','Taylor Horta','T604382053000','1988-03-10','2028-08-27','2024-10-13','A0I3'],
  ['A3ATM13S5V0WED','Dominic','Diaz','D200165021610','2002-05-01','2026-05-01','2024-04-10','A0H0'],
  ['A2MVJMPEYJ3UUO','Samuel','Del Rio Perez','D618602535000','1997-12-03','2033-12-03','2024-09-15','A0HZ'],
  ['A2V78JV15VV9S9','Devin Cristian','Espinosa Fernandez','E619340547000','1995-08-05','2033-08-05','2024-08-22','A0HW'],
  ['A1R0DWYX23QCX8','Bryan Martin','Caballero','M236-417-53-000-0','1991-10-16','2033-10-16','2024-07-19','A0HT'],
  ['A12CXZWG58DAKS','Aldail Aday','Montoto','A355000030540','2003-02-14','2031-02-14','2024-07-09','A0HQ'],
  ['A19I7GQGR77DJ9','Jonathan','Estrada','E230358502000','1993-12-23','2033-12-23','2024-05-27','A0HJ'],
  ['A14J3CWQP011CL','Daniel','Bejerano','B265160930080','1993-01-08','2027-01-08','2024-05-03','A0H7'],
  ['A2H1ILOKS0GAUO','Jesus','Rey','R000420942530','1994-07-13','2028-07-13','2024-04-12','A0H2'],
  ['A36W819AN2A3JH','Manel','Fernandez Vizcaya','F613-550-59-100-0','2006-07-19','2033-07-19','2025-11-23','A0LS'],
  ['A3GJHP4R3CPBT3','Jorge','Borrego','B621420893790','1989-10-19','2026-10-19','2021-06-27','A081'],
  ['A2Z4CATULT5ZPS','Francisco','Cruz','C623250880070','1988-01-07','2027-01-07','2021-10-25','A09J'],
  ['A24BRQ6TOHN4YQ','Eric','Diaz','D200-201-94-107-0','1994-03-27','2027-03-27','2024-11-27','A0J7'],
];

// ─── Vehicle data ─────────────────────────────────────────────────────────────
// Fields: [vin, service_type_raw, vehicle_name, license_plate, make, model, status_note,
//          operational_status, vehicle_provider, year, ownership_type_label, ownership_type_code,
//          ownership_start_date, ownership_end_date, registration_expiration, registered_state, category]
const VEHICLES = [
  ['1F65F5KN3M0A01839','Standard Parcel Step Van - US','SV43','60AUXH','Ford','Stripped Chassis','','OPERATIONAL','LP',2021,'Amazon-owned','AMAZON_OWNED','2021-10-26','2041-10-26','2026-12-30','FL - Florida','STEP VAN'],
  ['7FCEHEB76PN010917','Standard Parcel Electric - Rivian MEDIUM','EV 08','04DZIH','Rivian','EDV 700','','OPERATIONAL','ELEMENT',2023,'Amazon-owned','AMAZON_OWNED','2023-09-17','2043-09-17','2026-12-30','FL - Florida','EDV'],
  ['7FCEHEB26SN034812','Standard Parcel Electric - Rivian MEDIUM','EV 34','Y148091','Rivian','EDV 700','Until 2026-03-28.','OPERATIONAL','ELEMENT',2025,'Amazon Branded Last Mile Rental (781621)','AMAZON_RENTAL','2026-01-20','2026-03-28','2027-12-30','OR - Oregon','EDV'],
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('==============================================');
    console.log('  DSP Fleet Manager -- Full Import');
    console.log('==============================================\n');

    // ── Step 0: Ensure migration columns exist ──────────────────────────────
    await client.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS service_type VARCHAR(50)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS status_note TEXT`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_provider VARCHAR(100)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_label VARCHAR(100)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_type_code VARCHAR(50)`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_start_date DATE`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ownership_end_date DATE`);
    await client.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS registered_state VARCHAR(50)`);
    console.log('  Schema columns verified.');

    // ── Step 1: Wipe all transactional data ─────────────────────────────────
    console.log('\n  Wiping existing data...');
    await client.query('BEGIN');

    await client.query('DELETE FROM inspection_photos');
    await client.query('DELETE FROM inspections');
    await client.query('DELETE FROM fleet_alerts');

    await client.query('SAVEPOINT sp_repairs');
    try { await client.query('DELETE FROM repairs'); }
    catch { await client.query('ROLLBACK TO SAVEPOINT sp_repairs'); }
    await client.query('RELEASE SAVEPOINT sp_repairs');

    await client.query('DELETE FROM vehicles');

    await client.query('SAVEPOINT sp_amazon');
    try { await client.query('DELETE FROM amazon_routes'); }
    catch { await client.query('ROLLBACK TO SAVEPOINT sp_amazon'); }
    await client.query('RELEASE SAVEPOINT sp_amazon');

    await client.query('SAVEPOINT sp_routefiles');
    try { await client.query('DELETE FROM amazon_route_files'); }
    catch { await client.query('ROLLBACK TO SAVEPOINT sp_routefiles'); }
    await client.query('RELEASE SAVEPOINT sp_routefiles');

    await client.query('DELETE FROM shift_change_log');
    await client.query('DELETE FROM day_schedule_drivers');
    await client.query('DELETE FROM driver_recurring_shifts');
    await client.query('DELETE FROM staff_violations');
    await client.query('DELETE FROM payroll_records');
    await client.query('DELETE FROM attendance');
    await client.query('DELETE FROM shifts');
    await client.query('DELETE FROM drivers');
    await client.query("DELETE FROM staff WHERE role = 'driver'");

    await client.query('COMMIT');
    console.log('  Wipe complete.\n');

    // ── Step 2: Import drivers ───────────────────────────────────────────────
    console.log('  Importing 75 drivers...');
    const passwordHash = await bcrypt.hash('password123', 10);
    let driverCount = 0, driverErrors = 0;

    await client.query('BEGIN');
    for (const [tid, fn, ln, lic, dob, licExp, hire, empCode] of DRIVERS) {
      try {
        const email   = `${tid.toLowerCase()}@import.local`;
        const emp_id  = tid.slice(0, 20);
        const { rows: sr } = await client.query(
          `INSERT INTO staff (employee_id, first_name, last_name, email, role, status, hire_date, employee_code, password_hash)
           VALUES ($1,$2,$3,$4,'driver','active',$5,$6,$7)
           ON CONFLICT (email) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
             hire_date=EXCLUDED.hire_date, employee_code=EXCLUDED.employee_code, updated_at=NOW()
           RETURNING id`,
          [emp_id, fn, ln, email, hire || null, empCode || null, passwordHash]
        );
        await client.query(
          `INSERT INTO drivers (staff_id, transponder_id, license_number, license_expiration, dob)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (staff_id) DO UPDATE SET transponder_id=EXCLUDED.transponder_id,
             license_number=EXCLUDED.license_number, license_expiration=EXCLUDED.license_expiration,
             dob=EXCLUDED.dob, updated_at=NOW()`,
          [sr[0].id, tid, lic || null, licExp || null, dob || null]
        );
        driverCount++;
      } catch (e) {
        console.error(`    ERR driver ${fn} ${ln}: ${e.message}`);
        driverErrors++;
      }
    }
    await client.query('COMMIT');
    console.log(`  ${driverCount} drivers imported (${driverErrors} errors).`);

    // ── Step 3: Import vehicles ──────────────────────────────────────────────
    console.log('\n  Importing vehicles...');
    let vehicleCount = 0, vehicleErrors = 0;

    await client.query('BEGIN');
    for (const [vin, _svcRaw, vname, plate, make, model, statusNote, opStatus, provider, year,
                 ownerLabel, ownerCode, ownStart, ownEnd, regExp, regState, category] of VEHICLES) {
      try {
        const status = opStatus === 'OPERATIONAL' ? 'active' : 'inactive';
        // Check if VIN already exists, then insert or skip
        const { rows: existV } = await client.query('SELECT id FROM vehicles WHERE vin=$1', [vin]);
        if (existV.length === 0) {
          await client.query(
            `INSERT INTO vehicles
               (vin, vehicle_name, license_plate, make, model, year, status,
                service_type, status_note, vehicle_provider,
                ownership_type_label, ownership_type_code, ownership_start_date, ownership_end_date,
                registration_expiration, registered_state)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [vin, vname, plate || null, make || null, model || null, year || null, status,
             category || null, statusNote || null, provider || null,
             ownerLabel || null, ownerCode || null,
             ownStart || null, ownEnd || null,
             regExp || null, regState || null]
          );
        }
        vehicleCount++;
      } catch (e) {
        console.error(`    ERR vehicle ${vname}: ${e.message}`);
        vehicleErrors++;
      }
    }
    await client.query('COMMIT');
    console.log(`  ${vehicleCount} vehicles imported (${vehicleErrors} errors).`);

    // ── Done ─────────────────────────────────────────────────────────────────
    const result = {
      status: 'success',
      drivers_imported: driverCount,
      vehicles_imported: vehicleCount,
      driver_errors: driverErrors,
      vehicle_errors: vehicleErrors,
      ts: new Date(),
    };
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));

    console.log('\n==============================================');
    console.log('  System is clean and ready.');
    console.log('==============================================');
    console.log(`  ${driverCount} drivers imported`);
    console.log(`  ${vehicleCount} vehicles imported`);
    console.log('  James Mitchell preserved as admin (no shifts)');
    console.log('  All old demo data wiped');
    console.log('==============================================\n');

  } catch (err) {
    fs.writeFileSync(RESULT_FILE, JSON.stringify({ status: 'error', error: err.message, ts: new Date() }, null, 2));
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFATAL:', err.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

run();
