@echo off
echo Running driver recurring schedule migration...
cd /d "%~dp0"
node server/src/db/migrateDriverRecurring.js
echo.
echo Done! Now restart the backend server.
pause
