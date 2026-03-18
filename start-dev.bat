@echo off
cd /d "%~dp0"

REM Add common Node.js paths
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%LOCALAPPDATA%\nvm;%PATH%"

echo Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo Found Node.js %NODE_VER%

echo.
echo Installing root dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Root npm install failed.
    pause
    exit /b 1
)

echo Installing server dependencies...
cd server
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Server npm install failed.
    pause
    exit /b 1
)
cd ..

echo Installing client dependencies...
cd client
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Client npm install failed.
    pause
    exit /b 1
)
cd ..

echo.
echo Starting Backend (port 3001)...
start "DSP Backend" cmd /c "cd /d "%~dp0server" && npm run dev"

echo Starting Frontend (port 5173)...
cd client
call npm run dev
