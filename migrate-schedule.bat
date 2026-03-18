@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"

echo Running Schedule Migration...
echo.

cd server
node src/db/migrateSchedule.js
set EXIT_CODE=%ERRORLEVEL%
cd ..

echo.
if %EXIT_CODE% neq 0 (
    echo Migration FAILED. Check the error above.
) else (
    echo Migration complete! Restart the dev server to load the new routes.
)
pause
exit /b 0
