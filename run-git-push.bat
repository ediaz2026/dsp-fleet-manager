@echo off
set "NODE_BIN=C:\Program Files\nodejs"
set "GIT_BIN=C:\Program Files\Git\cmd"
set "PATH=%NODE_BIN%;%GIT_BIN%;%PATH%"
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
"%NODE_BIN%\node.exe" git-commit-push.js
echo Finished.
