@echo off
title Hunting Map
cd /d "%~dp0"

rem Already running? Just open it in the browser.
netstat -ano | findstr /R /C:":8765 .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:8765
  exit /b
)

rem Open the browser once the app is ready, then start the app in this window.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest http://localhost:8765 -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process http://localhost:8765; break}catch{Start-Sleep 1}}"

echo Starting Hunting Map... Close this window to turn it off.
node server.mjs
