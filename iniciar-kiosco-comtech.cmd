@echo off
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo Microsoft Edge no esta instalado.
  pause
  exit /b 1
)
start "COMTECH Showroom" "%EDGE%" --app=http://localhost:3000 --kiosk-printing --no-first-run
