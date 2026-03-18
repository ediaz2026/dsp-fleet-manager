@echo off
cd /d "%~dp0server"
set "NODE_BIN=C:\Program Files\nodejs"
set "PATH=%NODE_BIN%;%APPDATA%\npm;%PATH%"
set "PORT=3001"
"%NODE_BIN%\node.exe" src/index.js
