@echo off
REM create-vercel-branch.cmd — one-shot: create deploy/vercel-ph, commit the
REM Vercel deployment changes, push, and return to main.
REM Double-click me from the Openhall folder. Safe to close the window after
REM you see "ALL DONE".
setlocal
cd /d "%~dp0"

echo.
echo === Openhall: create deploy/vercel-ph branch ===
echo.

git rev-parse --verify deploy/vercel-ph >nul 2>&1
if not errorlevel 1 (
  echo ERROR: branch deploy/vercel-ph already exists. Nothing was changed.
  echo If you want to redo this, delete the branch first or ask Claude.
  pause
  exit /b 1
)

echo --- Current status (files staged for the new branch): ---
git status --short
echo.

git switch -c deploy/vercel-ph
if errorlevel 1 goto :fail

git add "api/relay/[...path].ts" "api/relay/relay.test.ts" vercel.json vitest.config.ts tsconfig.json eslint.config.js src/ui/app.ts src/ui/app.relay-default.test.ts docs/claude-sessions/2026-07-24-vercel-ph-deploy.md
if errorlevel 1 goto :fail

git commit -m "feat(deploy): hosted Vercel deployment with same-origin watsonx relay" -m "Port worker/token-exchange.ts to a same-origin Vercel function (api/relay), default the Settings Token Worker URL to /api/relay with honest disclosure copy, exclude /api from the SPA rewrite, add CSP headers and a 120s maxDuration. Branch-only: never merge to main; not part of the IBM challenge evidence." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01G9hP2PhjgjcnJbQHV7nSms"
if errorlevel 1 goto :fail

git push -u origin deploy/vercel-ph
if errorlevel 1 goto :fail

git switch main
if errorlevel 1 goto :fail

echo.
echo === ALL DONE ===
echo Branch deploy/vercel-ph is on GitHub; your folder is back on main.
echo Next: connect the repo in Vercel (Claude will guide you).
pause
exit /b 0

:fail
echo.
echo *** SOMETHING FAILED — see the message above. ***
echo Your files are safe. Copy the error to Claude and we'll fix it together.
pause
exit /b 1
