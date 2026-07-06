@echo off
rem organize-docs.cmd — one-time cleanup: move Bob prompts + test reports
rem into docs/, remove stale duplicates. Double-click to run; deletes itself
rem when done.
cd /d "%~dp0"
echo === Moving Bob prompts to docs/bob-prompts/ ===
if not exist docs\bob-prompts mkdir docs\bob-prompts
if not exist docs\test-reports mkdir docs\test-reports
for %%f in (BOB_PROMPT_*.md) do git mv "%%f" "docs/bob-prompts/%%f"
echo === Moving test reports to docs/test-reports/ ===
git mv WEEK1_TEST_REPORT.md docs/test-reports/WEEK1_TEST_REPORT.md
git mv WEEK2_TEST_REPORT.md docs/test-reports/WEEK2_TEST_REPORT.md
git mv WEEK3_TEST_REPORT.md docs/test-reports/WEEK3_TEST_REPORT.md
echo === Removing stale duplicates in docs/ ===
git rm -q docs/BOB_PROMPT_01.md docs/BOB_PROMPT_02.md docs/BOB_PROMPT_03.md docs/AGENTS.md
echo === Committing (also picks up prompts index, AGENTS.md, session log) ===
git add AGENTS.md docs/bob-prompts/README.md docs/claude-sessions
git commit -m "docs: organize Bob prompts + test reports under docs/, add index, drop stale duplicates"
echo.
git log --oneline -2
echo.
echo Done. This script will now delete itself.
pause
del "%~f0"
