@echo off
cd /d "%~dp0server"

set "NODE_BIN=C:\Program Files\nodejs"
set "PATH=%NODE_BIN%;%APPDATA%\npm;%PATH%"

echo Starting server, capturing all output...
"%NODE_BIN%\node.exe" src/index.js > "%~dp0debug-output.txt" 2>&1
echo Exit code: %ERRORLEVEL% >> "%~dp0debug-output.txt"

echo === DEBUG OUTPUT ===
type "%~dp0debug-output.txt"
echo === END ===
