$env:PATH = "C:\Program Files\Git\cmd;" + $env:PATH
Set-Location "C:\Users\arace\OneDrive\Desktop\DSP Scheduler"
$log = "C:\Users\arace\OneDrive\Desktop\DSP Scheduler\git-push-output.txt"

$output = @()
$output += git --version 2>&1
$output += "--- log ---"
$output += git log --oneline -3 2>&1
$output += "--- add ---"
$output += git add railway.json nixpacks.toml package.json "client/src/pages/Drivers.jsx" 2>&1
$output += "--- status ---"
$output += git status 2>&1
$output += "--- commit ---"
$output += git commit -m "Add Railway deployment config" 2>&1
$output += "--- push ---"
$output += git push origin main 2>&1
$output += "DONE"
$output | Out-File -FilePath $log -Encoding utf8
Write-Host "Finished. Output written to git-push-output.txt"
