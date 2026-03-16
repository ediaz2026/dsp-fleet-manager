-- DSP Fleet & Workforce Management System
-- PostgreSQL Schema

-- Staff / Users
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  employee_id VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(50) NOT NULL DEFAULT 'driver',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  hire_date DATE NOT NULL,
  password_hash VARCHAR(255),
  avatar_url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  shift_type VARCHAR(50) DEFAULT 'regular',
  status VARCHAR(30) DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attendance records
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'present',
  call_out_reason TEXT,
  late_minutes INTEGER DEFAULT 0,
  hours_worked DECIMAL(5,2),
  notes TEXT,
  created_by INTEGER REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Consequence rules engine
CREATE TABLE IF NOT EXISTS consequence_rules (
  id SERIAL PRIMARY KEY,
  rule_name VARCHAR(100) NOT NULL,
  violation_type VARCHAR(30) NOT NULL,
  threshold INTEGER NOT NULL,
  time_period_days INTEGER NOT NULL DEFAULT 90,
  consequence_action VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff violations log
CREATE TABLE IF NOT EXISTS staff_violations (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
  rule_id INTEGER REFERENCES consequence_rules(id),
  violation_type VARCHAR(30) NOT NULL,
  action_taken VARCHAR(50) NOT NULL,
  notes TEXT,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicles / Fleet
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  vehicle_name VARCHAR(100) NOT NULL,
  license_plate VARCHAR(20),
  vin VARCHAR(50),
  make VARCHAR(50),
  model VARCHAR(50),
  year INTEGER,
  color VARCHAR(30),
  transponder_id VARCHAR(50),
  insurance_expiration DATE,
  registration_expiration DATE,
  last_inspection_date DATE,
  next_inspection_date DATE,
  status VARCHAR(30) DEFAULT 'active',
  notes TEXT,
  qr_code_url VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fleet alerts
CREATE TABLE IF NOT EXISTS fleet_alerts (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  alert_type VARCHAR(50) NOT NULL,
  alert_message TEXT NOT NULL,
  severity VARCHAR(20) DEFAULT 'warning',
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Driver profiles (extended info linked to staff)
CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  license_number VARCHAR(50),
  license_expiration DATE,
  license_state VARCHAR(10),
  license_class VARCHAR(10) DEFAULT 'D',
  dob DATE,
  transponder_id VARCHAR(50),
  emergency_contact_name VARCHAR(100),
  emergency_contact_phone VARCHAR(20),
  emergency_contact_relation VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(10),
  zip VARCHAR(20),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Amazon route upload files
CREATE TABLE IF NOT EXISTS amazon_route_files (
  id SERIAL PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  upload_date DATE NOT NULL DEFAULT CURRENT_DATE,
  route_date DATE NOT NULL,
  total_routes INTEGER DEFAULT 0,
  matched_routes INTEGER DEFAULT 0,
  mismatched_routes INTEGER DEFAULT 0,
  unmatched_routes INTEGER DEFAULT 0,
  uploaded_by INTEGER REFERENCES staff(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual Amazon route records
CREATE TABLE IF NOT EXISTS amazon_routes (
  id SERIAL PRIMARY KEY,
  route_file_id INTEGER REFERENCES amazon_route_files(id) ON DELETE CASCADE,
  route_code VARCHAR(50) NOT NULL,
  amazon_driver_name VARCHAR(200),
  amazon_driver_id VARCHAR(100),
  internal_staff_id INTEGER REFERENCES staff(id),
  match_status VARCHAR(30) DEFAULT 'unmatched',
  route_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicle inspections
CREATE TABLE IF NOT EXISTS inspections (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id INTEGER REFERENCES staff(id),
  inspection_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inspection_type VARCHAR(30) DEFAULT 'pre_trip',
  status VARCHAR(30) DEFAULT 'in_progress',
  damage_detected BOOLEAN DEFAULT FALSE,
  ai_analysis_status VARCHAR(30) DEFAULT 'pending',
  ai_analysis_notes TEXT,
  overall_condition VARCHAR(30),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inspection photos
CREATE TABLE IF NOT EXISTS inspection_photos (
  id SERIAL PRIMARY KEY,
  inspection_id INTEGER REFERENCES inspections(id) ON DELETE CASCADE,
  photo_angle VARCHAR(50) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255),
  has_damage BOOLEAN DEFAULT FALSE,
  damage_notes TEXT,
  ai_flagged BOOLEAN DEFAULT FALSE,
  ai_confidence DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payroll records
CREATE TABLE IF NOT EXISTS payroll_records (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  scheduled_hours DECIMAL(6,2),
  actual_hours DECIMAL(6,2),
  overtime_hours DECIMAL(6,2) DEFAULT 0,
  source VARCHAR(30) DEFAULT 'manual',
  sync_date TIMESTAMPTZ,
  status VARCHAR(30) DEFAULT 'pending',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System settings
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  setting_type VARCHAR(30) DEFAULT 'string',
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date ON attendance(staff_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_date ON shifts(staff_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle ON inspections(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_amazon_routes_date ON amazon_routes(route_date);
CREATE INDEX IF NOT EXISTS idx_fleet_alerts_vehicle ON fleet_alerts(vehicle_id, is_resolved);
CREATE INDEX IF NOT EXISTS idx_violations_staff ON staff_violations(staff_id, created_at);
