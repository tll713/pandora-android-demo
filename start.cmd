@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\workspace.ps1"
set "PANDORA_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %PANDORA_EXIT%
