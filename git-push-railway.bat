@echo off
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"

:: Try common Git install locations
SET GIT_EXE=
IF EXIST "C:\Program Files\Git\cmd\git.exe" SET GIT_EXE=C:\Program Files\Git\cmd\git.exe
IF EXIST "C:\Program Files (x86)\Git\cmd\git.exe" SET GIT_EXE=C:\Program Files (x86)\Git\cmd\git.exe
IF EXIST "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" SET GIT_EXE=%LOCALAPPDATA%\Programs\Git\cmd\git.exe

IF "%GIT_EXE%"=="" (
  echo ERROR: Git not found at standard locations.
  echo Please run this manually in a terminal:
  echo   git add railway.json nixpacks.toml package.json
  echo   git commit -m "Add Railway deployment config"
  echo   git push origin main
  pause
  exit /b 1
)

echo Found git at: %GIT_EXE%
echo.
"%GIT_EXE%" --version
echo.
"%GIT_EXE%" log --oneline -3
echo.
echo === Staging files ===
"%GIT_EXE%" add railway.json nixpacks.toml package.json client/src/pages/Drivers.jsx
echo.
echo === Status ===
"%GIT_EXE%" status
echo.
echo === Committing ===
"%GIT_EXE%" commit -m "Add Railway deployment config"
echo.
echo === Pushing to origin main ===
"%GIT_EXE%" push origin main
echo.
echo Done!
pause
