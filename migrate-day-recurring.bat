@echo off
cd /d "%~dp0server"
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
echo Running Day Recurring Migration...
node src/db/migrateDayRecurring.js
pause
