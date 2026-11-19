@echo off
rem Requirement 4 - demo control page (scenes 6, 7, 8) on http://localhost:3999. Keep this window open while presenting.
chcp 65001 >nul
title Requirement 4 - demo control (keep open)
cd /d "%~dp0backend"
start "" http://localhost:3999
call npm run control:4
pause
