@echo off
rem Requirement 2 - Inventory service (Go + gRPC). Same as ..\demo-2.cmd, so it also works from the backend folder.
chcp 65001 >nul
title Requirement 2 - Inventory service (Go + gRPC)
cd /d "%~dp0"
call npm run demo:2
echo.
pause
