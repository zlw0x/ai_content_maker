@echo off
setlocal
cd /d "%~dp0"
echo Starting isolated AI Content Maker test setup...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0portable\setup.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Setup did not finish successfully. Read the error above.
pause
exit /b %RC%
