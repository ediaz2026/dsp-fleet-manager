@echo off
cd /d "%~dp0server"
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
echo Starting backend server (port 3001)...
echo.
node src/index.js
pause
