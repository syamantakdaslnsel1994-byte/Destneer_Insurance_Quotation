@echo off
echo ============================================
echo  Starting All Health Insurance Calculator
echo  Servers — Please Wait...
echo ============================================
echo.

cd /d "%~dp0\.."

echo [1/4] Starting Niva Bupa    (PORT 3002)...
start "Niva Bupa    :3002" cmd /k "node server\niva_server.js"

timeout /t 1 /nobreak >nul

echo [2/4] Starting ManipalCigna (PORT 3003)...
start "ManipalCigna :3003" cmd /k "node server\mc_server.js"

timeout /t 1 /nobreak >nul

echo [3/4] Starting Star Health  (PORT 3004)...
start "Star Health  :3004" cmd /k "node server\sh_server.js"

timeout /t 1 /nobreak >nul

echo [4/4] Starting Care Health  (PORT 3005)...
start "Care Health  :3005" cmd /k "node server\care_server.js"

timeout /t 2 /nobreak >nul

echo.
echo ============================================
echo  All 4 servers started!
echo.
echo  Open Insurance Hub (current):
echo  http://localhost:3005/hub
echo.
echo  Individual calculators:
echo  Niva Bupa    -  http://localhost:3002
echo  ManipalCigna -  http://localhost:3003
echo  Star Health  -  http://localhost:3004
echo  Care Health  -  http://localhost:3005
echo.
echo  Legacy hub (superseded, kept for the print view):
echo  http://localhost:3005/unified
echo ============================================
echo.

start "" "http://localhost:3005/hub"

pause
