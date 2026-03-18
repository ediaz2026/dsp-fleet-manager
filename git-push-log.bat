@echo off
SET PATH=C:\Program Files\Git\cmd;C:\Program Files\Git\bin;%PATH%
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
SET LOG="C:\Users\arace\OneDrive\Desktop\DSP Scheduler\git-push-output.txt"

git --version > %LOG% 2>&1
echo [log] >> %LOG%
git log --oneline -3 >> %LOG% 2>&1
echo [add] >> %LOG%
git add railway.json nixpacks.toml package.json client/src/pages/Drivers.jsx >> %LOG% 2>&1
echo [status] >> %LOG%
git status >> %LOG% 2>&1
echo [commit] >> %LOG%
git commit -m "Add Railway deployment config" >> %LOG% 2>&1
echo [push] >> %LOG%
git push origin main >> %LOG% 2>&1
echo DONE >> %LOG%
echo Finished. Check git-push-output.txt
