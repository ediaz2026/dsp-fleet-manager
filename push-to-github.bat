@echo off
cd /d "%~dp0"

echo Adding GitHub remote...
git remote remove origin 2>nul
git remote add origin https://github.com/ediaz2026/dsp-fleet-manager.git

echo Pushing to GitHub...
git push -u origin main

if %ERRORLEVEL% neq 0 (
    echo.
    echo Push failed. You may need to authenticate.
    echo Run: git push -u origin main
    echo And enter your GitHub credentials when prompted.
    echo.
    echo TIP: GitHub no longer accepts passwords. Use a Personal Access Token.
    echo Generate one at: https://github.com/settings/tokens
) else (
    echo.
    echo Successfully pushed to GitHub!
    echo View your repo: https://github.com/ediaz2026/dsp-fleet-manager
)

pause
exit /b 0
