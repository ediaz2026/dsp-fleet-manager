@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"

echo Running Associate Data Import...
echo.

cd server
node src/db/importAssociates.js
set EXIT_CODE=%ERRORLEVEL%
cd ..

echo.
echo --- Import Log ---
if exist import-log.txt (
    type import-log.txt
) else (
    echo No log file found.
)
echo --- End Log ---
echo.

if %EXIT_CODE% neq 0 (
    echo Import FAILED. See log above.
) else (
    echo Done! Refresh the Drivers page in the app to see all associates.
)
pause
exit /b 0
