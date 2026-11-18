@echo off
rem Requirement 1 - API design and security. Same as ..\demo-1.cmd, so it also works from the backend folder.
chcp 65001 >nul
title Requirement 1 - API design and security
cd /d "%~dp0"
call npm run demo:1
echo.
pause
