@echo off
rem save-work.cmd - one-click git checkpoint for Openhall.
rem Double-click this file to commit ALL current changes with a timestamp.
cd /d "%~dp0"
echo.
rem Clear a stale index.lock (left behind when a read-only tool touched git).
rem Safe here: this script is the only thing running git on this repo.
if exist ".git\index.lock" (
  echo Removing stale .git\index.lock ...
  del /f