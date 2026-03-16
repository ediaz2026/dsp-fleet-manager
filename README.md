# DSP Fleet & Workforce Management System

Full-stack web application for managing DSP fleets, staff scheduling, vehicle inspections, and more.

## Tech Stack
- **Frontend**: React 18, Vite, Tailwind CSS, React Query, Recharts
- **Backend**: Node.js, Express, PostgreSQL
- **AI**: Anthropic Claude Vision API (damage detection)
- **Auth**: JWT

## Quick Start

### 1. Prerequisites
- Node.js 18+
- PostgreSQL running locally (default: `postgres:postgres@localhost:5432`)

### 2. Install dependencies
```bash
npm run install:all
```

### 3. Set up the database
```bash
# Create the database
createdb dsp_manager

# Run migrations + seed demo data
npm run db:setup
```

### 4. Configure environment (optional)
Edit `server/.env`:
- Set `DATABASE_URL` if your Postgres credentials differ
- Add `ANTHROPIC_API_KEY` to enable AI damage detection

### 5. Start the application
```bash
npm run dev
```

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001

## Demo Credentials
| Email | Password | Role |
|-------|----------|------|
| jmitchell@dspfleet.com | password123 | Manager |
| mjohnson@dspfleet.com | password123 | Driver |

## Features

### Scheduling
- Weekly grid schedule view (Mon–Sat)
- Add/delete shifts per driver
- Color-coded attendance status overlay

### Attendance & Consequence Engine
- Quick-mark buttons: Present / Late / Called Out / NCNS
- Automatic rule evaluation on every attendance save
- Configurable consequence rules (e.g., 3 NCNS → Termination Review)
- Export attendance reports as CSV

### Payroll Integration
- Hours summary vs. scheduled (by pay period)
- Sync buttons for Paycom and ADP (configure API keys in Settings)
- Bar chart comparison per driver

### Amazon Route Matching
- Upload CSV/Excel route files from Amazon
- Auto-match drivers by name to internal schedule
- Flag mismatches; manual match UI for corrections

### Vehicle Management
- Fleet database with full vehicle info
- Expiration tracking: insurance, registration, inspection
- Color-coded expiry indicators
- One-click alert generation

### Driver Profiles
- Full driver info: license, DOB, transponder, emergency contact
- 90-day attendance summary per driver
- License expiry warnings

### QR Code Inspection System
1. Each vehicle has a unique QR code (download from Vehicles page)
2. Driver scans → opens mobile-optimized inspection wizard
3. 5-photo guided sequence: Front, Left Side, Right Side, Rear, Interior
4. Photos upload directly with angle tagging

### AI Damage Detection
- After each inspection completes, Claude Vision compares photos to previous inspection
- Flags vehicles with potential new damage
- Dashboard shows before/after comparison for manager review
- Requires `ANTHROPIC_API_KEY` in `server/.env`

### Dashboard
- Configurable widget layout
- Today's schedule, fleet alerts, attendance issues, hours summary
- AI damage flags, upcoming expirations, recent violations

## Project Structure
```
DSP Scheduler/
├── client/          # React frontend (Vite)
│   └── src/
│       ├── pages/   # One file per module
│       ├── components/
│       └── api/
├── server/          # Node.js/Express backend
│   └── src/
│       ├── routes/  # REST API endpoints
│       ├── services/ # Business logic (AI, consequences)
│       └── db/      # Schema, migrations, seed
└── package.json     # Root workspace scripts
```
