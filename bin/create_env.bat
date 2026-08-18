@echo off
REM ===========================================================================
REM  create_env.bat — writes the .env file the servers need.
REM
REM  Run this once. Double-click it, or from a prompt:  create_env.bat
REM  Works in Command Prompt and PowerShell alike.
REM
REM  .env holds the ManipalCigna gateway credential and payload key. It is
REM  git-ignored and must never be committed.
REM ===========================================================================

cd /d "%~dp0\.."

if exist ".env" (
  echo.
  echo   .env already exists — leaving it alone.
  echo   Delete it first if you want to recreate it.
  echo.
  pause
  exit /b
)

REM The redirect is placed BEFORE echo so that a trailing character can never
REM be mistaken for a file handle, and no stray space reaches the file.
> ".env" echo # Local secrets - NOT committed (see .gitignore).
>>".env" echo # Created by create_env.bat
>>".env" echo.
>>".env" echo MC_AUTH_TOKEN=Z01GMkx0amJZUDVGNTVuUnBVdzUrU09hWktTZTNhc1Y6UFFRZE1oaG5wTHUvS2wwMzNUUHNhT25heEZpRW14YXo=
>>".env" echo MC_AES_KEY=lv39eptlvuhaqqer

echo.
echo   Created .env
echo.
echo   ---------------------------------------------
type ".env"
echo   ---------------------------------------------
echo.
echo   Next:  start_all.bat
echo.
pause
