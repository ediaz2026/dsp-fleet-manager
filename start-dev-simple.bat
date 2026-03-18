@echo off
cd /d "%~dp0"

set "NODE_BIN=C:\Program Files\nodejs"
set "PATH=%NODE_BIN%;%APPDATA%\npm;%PATH%"

echo Stopping any running Node.js processes...
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting DSP Backend on port 3001...
start "DSP Backend" /min "%~dp0run-backend.bat"

echo Waiting for backend to initialize...
timeout /t 3 /nobreak >nul

echo Starting DSP Frontend on port 5173...
cd /d "%~dp0client"
set "PORT="
"%NODE_BIN%\npm.cmd" run dev -- --port 5173
