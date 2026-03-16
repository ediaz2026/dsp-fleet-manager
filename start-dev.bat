@echo off
REM DSP Fleet Manager - Dev Server Starter
REM This script tries common Node.js locations before launching

REM Add common Node.js installation paths to PATH
set "EXTRA_PATHS=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%LOCALAPPDATA%\nvm;%USERPROFILE%\.nvm\current\bin"
set "PATH=%EXTRA_PATHS%;%PATH%"

echo Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Node.js not found in PATH.
    echo Please install Node.js from https://nodejs.org ^(LTS version^)
    echo Then re-run this script.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm not found. Reinstall Node.js from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo Found Node.js %NODE_VER%

cd /d "%~dp0"
echo.
echo Installing dependencies...
call npm run install:all
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo Starting DSP Fleet Manager...
echo Frontend: http://localhost:5173
echo Backend API: http://localhost:3001
echo.
call npm run dev
