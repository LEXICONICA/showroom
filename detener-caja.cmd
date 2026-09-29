@echo off
rem Apaga la caja COMTECH: cierra lo que escucha en los puertos 3000 (caja) y 3101 (puente SAP).
setlocal
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING" /c:":3101 .*LISTENING"') do (
  taskkill /PID %%p /T /F >nul 2>&1
)
echo Caja detenida.
timeout /t 3 /nobreak >nul
