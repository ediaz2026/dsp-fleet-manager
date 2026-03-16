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
    goto :fail
)
for /f "tokens=*" %%v in ('git --version') do echo Found: %%v

REM Check for gh CLI
where gh >nul 2>&1
set "HAS_GH=%ERRORLEVEL%"
if %HAS_GH% equ 0 (
    for /f "tokens=*" %%v in ('gh --version 2^>nul') do echo Found: %%v
) else (
    echo NOTE: gh CLI not found. Will set up local git only.
    echo       Install gh from https://cli.github.com to auto-create GitHub repo.
)

echo.

REM ---- Init git repo ----
if exist ".git" (
    echo Git repo already initialized.
) else (
    echo Initializing git repository...
    git init -b main
    if %ERRORLEVEL% neq 0 ( git init && git checkout -b main 2>nul || git symbolic-ref HEAD refs/heads/main )
)

REM ---- Stage all files ----
echo Staging files...
git add .
git status --short

REM ---- Commit ----
git log --oneline -1 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo Creating initial commit...
    git -c user.email="dsp@fleet.local" -c user.name="DSP Fleet" commit -m "Initial commit: DSP Fleet & Workforce Management System

Full-stack DSP management platform with:
- Staff scheduling with weekly grid view
- Attendance tracking and consequence rules engine
- Vehicle fleet management with expiry alerts
- QR code vehicle inspection system with AI damage detection
- Amazon route matching (CSV/Excel upload)
- Payroll integration layer (Paycom/ADP)
- Driver profiles with license tracking
- React 18 + Vite + Tailwind CSS frontend
- Node.js + Express + PostgreSQL backend"
) else (
    echo Initial commit already exists.
)

echo.
echo ---- Git status ----
git log --oneline -3
echo.

REM ---- GitHub: create repo with gh CLI ----
if %HAS_GH% equ 0 (
    echo Checking gh auth status...
    gh auth status >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        echo Creating GitHub repository...
        gh repo create dsp-fleet-manager --private --description "DSP Fleet and Workforce Management System" --source=. --remote=origin --push
        if %ERRORLEVEL% equ 0 (
            echo.
            echo SUCCESS! Repository pushed to GitHub.
            gh repo view --web
        ) else (
            echo.
            echo Repo may already exist or there was an error. Trying to push...
            git push -u origin main 2>&1
        )
    ) else (
        echo.
        echo gh CLI found but not authenticated.
        echo Run: gh auth login
        echo Then re-run this script to push to GitHub.
        goto :local_done
    )
) else (
    :local_done
    echo.
    echo Local git repo is ready.
    echo.
    echo To push to GitHub manually:
    echo   1. Create a repo at https://github.com/new
    echo   2. Run:
    echo      git remote add origin https://github.com/YOUR_USERNAME/dsp-fleet-manager.git
    echo      git push -u origin main
)

echo.
echo Done!
pause
exit /b 0

:fail
echo.
pause
exit /b 1
