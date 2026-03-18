@echo off
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
node.exe server/src/db/fleetImport.js
echo Done.
pause
