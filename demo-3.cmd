@echo off
rem Requirement 3 - Performance and caching (before / after). Double-click this file, or type its name in cmd.
chcp 65001 >nul
title Requirement 3 - Performance and caching (before / after)
cd /d "%~dp0backend"
call npm run demo:3
echo.
pause
