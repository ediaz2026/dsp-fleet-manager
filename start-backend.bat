@echo off
cd /d "%~dp0server"

set "NODE_BIN=C:\Program Files\nodejs"
set "PATH=%NODE_BIN%;%APPDATA%\npm;%PATH%"

echo Starting backend...
"%NODE_BIN%\node.exe" src/index.js > "%~dp0backend.log" 2>&1
echo Exit code: %ERRORLEVEL% >> "%~dp0backend.log"
type "%~dp0backend.log"
