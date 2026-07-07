@echo off
rem save-work.cmd — one-click git checkpoint for Openhall.
rem Double-click this file to commit ALL current changes with a timestamp.
cd /d "%~dp0"
echo.
rem Clear a stale index.lock (left behind when a read-only tool touched git).
rem Safe here: this script is the only thing running git on this repo.
if exist ".git\index.lock" (
  echo Removing stale .git\index.lock ...
  del /f ".git\index.lock"
)
echo === Saving work to git ===
git add -A
git commit -m "chore: checkpoint %date% %time%"
echo.
echo === Latest commit ===
git log --oneline -3
echo.
echo (If it says "nothing to commit", everything was already saved.)
pause
