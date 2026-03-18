@echo off
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"

echo Installing xlsx package in client...
cd client
npm install xlsx --save
set EXIT_CODE=%ERRORLEVEL%
cd ..

echo.
if %EXIT_CODE% neq 0 (
    echo Install FAILED.
) else (
    echo xlsx installed successfully!
)
pause
exit /b 0
