@echo off
setlocal
cd /d "%~dp0"
echo Starting exactly one real WaveSpeed image test...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0portable\run-once.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Test failed or was stopped. DO NOT rerun after an ambiguous paid task.
pause
exit /b %RC%
