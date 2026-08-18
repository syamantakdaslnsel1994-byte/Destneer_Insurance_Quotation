@echo off
REM ===========================================================================
REM  decode_mc_url.bat — read what the real ManipalCigna page put on the wire.
REM
REM  Double-click this file, or run it from a prompt. Works in Command Prompt
REM  and PowerShell alike.
REM
REM  Two ways to use it:
REM    1. Put your captures in mc_captures.txt (one per line) and run this.
REM    2. Run this with the file empty and paste a single value when asked.
REM ===========================================================================

cd /d "%~dp0\.."

REM Any line in mc_captures.txt that is not blank and not a comment?
set FOUND=
if exist "scripts\mc-tools\mc_captures.txt" (
  for /f "usebackq tokens=* delims=" %%L in (`findstr /v /r /c:"^#" /c:"^$" "scripts\mc-tools\mc_captures.txt"`) do set FOUND=1
)

if defined FOUND (
  echo.
  echo   Reading captures from scripts\mc-tools\mc_captures.txt
  echo.
  node scripts\mc-tools\mc_decode_url.js --file scripts\mc-tools\mc_captures.txt
  echo.
  pause
  exit /b
)

echo.
echo   mc_captures.txt has no captures in it yet.
echo.
echo   Paste ONE value below and press Enter — either the whole URL from the
echo   address bar, or just the long "encodedString" from the network request.
echo.
set /p VALUE=  Value:

if not defined VALUE (
  echo.
  echo   Nothing pasted. Exiting.
  echo.
  pause
  exit /b
)

echo.
node scripts\mc-tools\mc_decode_url.js "%VALUE%"
echo.
pause
