@echo off
cd /d "%~dp0server"
set "NODE_BIN=C:\Program Files\nodejs"
set "PATH=%NODE_BIN%;%APPDATA%\npm;%PATH%"
echo Running auth columns migration...
"%NODE_BIN%\node.exe" src/db/migrateAuthColumns.js
