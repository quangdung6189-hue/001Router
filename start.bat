@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   001Router - Local AI Router Gateway
echo ==================================================

if not exist "node_modules" (
  echo [1/3] Installing backend dependencies...
  call npm install
  if errorlevel 1 goto :error
)

if not exist "web\dist\index.html" (
  echo [2/3] Building web dashboard...
  if not exist "web\node_modules" (
    call npm --prefix web install
    if errorlevel 1 goto :error
  )
  call npm run build
  if errorlevel 1 goto :error
)

echo [3/3] Starting 001Router server...
echo Dashboard: http://localhost:20128
echo API Base : http://localhost:20128/v1
echo Default password: 1234
echo.
start "" http://localhost:20128
node server/index.js
goto :eof

:error
echo.
echo [ERROR] Failed to start 001Router. Please check Node.js and npm installation.
pause
exit /b 1
