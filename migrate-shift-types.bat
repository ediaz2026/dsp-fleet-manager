@echo off
echo Running shift_types migration...
node server/src/db/migrateShiftTypes.js
pause
