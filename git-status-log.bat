@echo off
cd /d "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"

echo Checking git locations... > git-output.txt

IF EXIST "C:\Program Files\Git\cmd\git.exe" (
  echo FOUND: C:\Program Files\Git\cmd\git.exe >> git-output.txt
) ELSE (
  echo NOT FOUND: C:\Program Files\Git\cmd\git.exe >> git-output.txt
)

IF EXIST "C:\Program Files (x86)\Git\cmd\git.exe" (
  echo FOUND: C:\Program Files ^(x86^)\Git\cmd\git.exe >> git-output.txt
) ELSE (
  echo NOT FOUND: Program Files x86 >> git-output.txt
)

IF EXIST "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" (
  echo FOUND: %LOCALAPPDATA%\Programs\Git\cmd\git.exe >> git-output.txt
) ELSE (
  echo NOT FOUND: LocalAppData Git >> git-output.txt
)

IF EXIST "%USERPROFILE%\AppData\Local\Programs\Git\cmd\git.exe" (
  echo FOUND: %USERPROFILE%\AppData\Local\Programs\Git\cmd\git.exe >> git-output.txt
) ELSE (
  echo NOT FOUND: UserProfile AppData Git >> git-output.txt
)

echo. >> git-output.txt
echo Checking if .git folder exists: >> git-output.txt
IF EXIST ".git" (
  echo .git folder EXISTS - this IS a git repo >> git-output.txt
) ELSE (
  echo .git folder MISSING - NOT a git repo >> git-output.txt
)

echo. >> git-output.txt
echo Directory listing: >> git-output.txt
dir /b >> git-output.txt

echo Done. Check git-output.txt
