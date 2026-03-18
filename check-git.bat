@echo off
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
echo === Last 3 commits ===
git log --oneline -3
echo.
echo === Remote status ===
git status
pause
