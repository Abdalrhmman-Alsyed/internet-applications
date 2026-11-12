@echo off
rem Requirement 1 - API design and security. Double-click this file, or type its name in cmd.
chcp 65001 >nul
title Requirement 1 - API design and security
cd /d "%~dp0backend"
call npm run demo:1
echo.
pause
