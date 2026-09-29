@echo off
rem Levanta la caja COMTECH con doble clic: puente SAP (3101), caja (3000) y Edge en modo caja.
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs

rem Puente a SAP: solo si no esta corriendo.
netstat -ano | findstr /r /c:":3101 .*LISTENING" >nul
if errorlevel 1 (
  echo Iniciando puente SAP...
  start "COMTECH - Puente SAP" /min cmd /c "node sap-proxy.mjs >> logs\sap-proxy.log 2>&1"
)

rem Caja: solo si el puerto 3000 esta libre.
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if errorlevel 1 (
  echo Iniciando caja...
  start "COMTECH - Caja" /min cmd /c "npm.cmd run dev -- --port 3000 --strictPort >> logs\caja.log 2>&1"
)

rem Espera hasta 90 segundos a que la caja responda.
set /a intentos=0
:esperar
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul && goto lista
set /a intentos+=1
if %intentos% geq 45 goto fallo
timeout /t 2 /nobreak >nul
goto esperar

:lista
call "%~dp0iniciar-kiosco-comtech.cmd"
exit /b 0

:fallo
echo.
echo La caja no arranco. Revise logs\caja.log y logs\sap-proxy.log
pause
exit /b 1
