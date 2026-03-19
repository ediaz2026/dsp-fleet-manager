@echo off
set "NODE_BIN=C:\Program Files\nodejs"
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
echo Running push-to-railway.js...
"%NODE_BIN%\node.exe" push-to-railway.js
echo Done. Check push-to-railway-output.txt
pause
