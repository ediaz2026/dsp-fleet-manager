@echo off
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
node -e "console.log('Node test: ' + process.version); require('fs').writeFileSync('node-test-output.txt', 'Node is working: ' + process.version);"
echo Exit code: %ERRORLEVEL%
pause
