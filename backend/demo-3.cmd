@echo off
rem Requirement 3 - Performance and caching (before / after). Same as ..\demo-3.cmd, so it also works from the backend folder.
chcp 65001 >nul
title Requirement 3 - Performance and caching (before / after)
cd /d "%~dp0"
call npm run demo:3
echo.
pause
