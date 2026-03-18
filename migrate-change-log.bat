@echo off
cd /d "%~dp0"
echo Running change log migration...
node server/src/db/migrateChangeLog.js
pause
