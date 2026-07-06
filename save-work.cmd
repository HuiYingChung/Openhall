@echo off
rem save-work.cmd — one-click git checkpoint for Openhall.
rem Double-click this file to commit ALL current changes with a timestamp.
cd /d "%~dp0"
echo.
echo === Saving work to git ===
git add -A
git commit -m "chore: checkpoint %date% %time%"
echo.
echo === Latest commit ===
git log --oneline -3
echo.
echo (If it says "nothing to commit", everything was already saved.)
pause
