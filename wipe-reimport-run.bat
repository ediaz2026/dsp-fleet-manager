@echo off
cd /d "%~dp0"
set "NODE_BIN=C:\Program Files\nodejs"
set "PATH=%NODE_BIN%;%APPDATA%\npm;%PATH%"
echo Running wipe and reimport...
"%NODE_BIN%\node.exe" server/src/db/wipeAndReimport.js > wipe-reimport-log.txt 2>&1
type wipe-reimport-log.txt
echo.
echo Done. Log saved to wipe-reimport-log.txt
pause
