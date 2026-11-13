@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer and try again.
  pause
  exit /b 1
)
node src\cli.js
if errorlevel 1 (
  echo.
  echo The program exited with an error. See the message above.
  pause
)
endlocal
