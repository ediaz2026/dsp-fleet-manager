@echo off
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
echo Current dir: %CD%
echo.
echo Checking git...
where git
echo.
echo Git version:
git --version
echo.
echo Git log:
git log --oneline -3
echo.
echo Git status:
git status
echo.
pause
