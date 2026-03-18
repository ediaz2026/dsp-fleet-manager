@echo off
echo ================================================
echo  DSP Fleet Manager - Wipe and Reimport
echo ================================================
echo.
echo WARNING: This will DELETE all driver and vehicle
echo data and reimport from AssociateData (2).csv
echo.
echo Press any key to continue or Ctrl+C to cancel...
pause > nul

cd /d "%~dp0"
node server/src/db/wipeAndReimport.js

echo.
pause
