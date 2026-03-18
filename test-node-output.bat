@echo off
cd /d "%~dp0"
set "NODE_BIN=C:\Program Files\nodejs"
echo Testing node output...
"%NODE_BIN%\node.exe" -e "console.log('Node is running'); console.error('stderr test');" > test-node-out.txt 2>&1
echo Node exit code: %ERRORLEVEL%
type test-node-out.txt
echo Done.
pause
