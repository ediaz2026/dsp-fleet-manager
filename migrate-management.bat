@echo off
echo Running management migration (employee_code + fleet columns)...
cd /d "%~dp0"
node server/src/db/migrateManagement.js
echo.
echo Done! Now restart the backend server.
pause
