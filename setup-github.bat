@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo  DSP Fleet Manager - GitHub Setup
echo ============================================
echo.

REM Check for git
where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: git not found. Install Git from https://git-scm.com
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('git --version') do echo Found: %%v

REM Init
if not exist ".git" (
    echo Initializing git repo...
    git init
    git checkout -b main 2>nul || git symbolic-ref HEAD refs/heads/main
)

REM Stage
echo Staging all files...
git add .

REM Commit (single-line message to avoid cmd.exe issues)
git log --oneline -1 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Creating initial commit...
    git -c user.email="dsp@fleet.local" -c user.name="DSP Fleet" commit -m "Initial commit: DSP Fleet and Workforce Management System"
) else (
    echo Repo already has commits.
)

echo.
echo ---- Recent commits ----
git log --oneline -3
echo.
echo ---- Remotes ----
git remote -v

echo.
echo Local git setup complete.
echo.
echo Next: add your GitHub remote and push:
echo   git remote add origin https://github.com/YOUR_USERNAME/dsp-fleet-manager.git
echo   git push -u origin main
echo.
pause
exit /b 0
