@echo off
cd /d "%~dp0"
set "NODE_BIN=C:\Program Files\nodejs"
set "PATH=%NODE_BIN%;%PATH%"
echo Running full import (wipe + reimport 75 drivers + 3 vehicles)...
"%NODE_BIN%\node.exe" server/src/db/fullImport.js > full-import-log.txt 2>&1
echo Import finished. Check full-import-result.json for details.
pause
