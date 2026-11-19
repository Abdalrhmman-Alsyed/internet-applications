@echo off
rem Requirement 4 - opens the admin and customer windows side by side, already signed in. Double-click before the presentation.
chcp 65001 >nul
title Requirement 4 - two-browser presentation
cd /d "%~dp0backend"
call npm run present:4
echo.
pause
