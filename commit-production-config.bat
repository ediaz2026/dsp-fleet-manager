@echo off
SET PATH=C:\Program Files\Git\cmd;C:\Program Files\Git\bin;%PATH%
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
SET LOG="C:\Users\arace\OneDrive\Desktop\DSP Scheduler\commit-production-output.txt"

echo === Commit Production Config === > %LOG% 2>&1
echo. >> %LOG%
git --version >> %LOG% 2>&1
echo. >> %LOG%
echo [status before] >> %LOG%
git status >> %LOG% 2>&1
echo. >> %LOG%
echo [add] >> %LOG%
git add server/src/index.js >> %LOG% 2>&1
echo. >> %LOG%
echo [status after add] >> %LOG%
git status >> %LOG% 2>&1
echo. >> %LOG%
echo [commit] >> %LOG%
git commit -m "production: CORS allow Railway domain + serve client/dist in production" >> %LOG% 2>&1
echo. >> %LOG%
echo [push] >> %LOG%
git push origin main >> %LOG% 2>&1
echo. >> %LOG%
echo [log after push] >> %LOG%
git log --oneline -3 >> %LOG% 2>&1
echo. >> %LOG%
echo DONE >> %LOG%
echo Finished. Check commit-production-output.txt
