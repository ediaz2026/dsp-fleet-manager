@echo off
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
echo Adding Railway deployment config files...
git add railway.json nixpacks.toml package.json client/src/pages/Drivers.jsx
git status
git commit -m "Add Railway deployment config"
echo.
echo Pushing to GitHub...
git push origin main
echo.
echo Done.
pause
