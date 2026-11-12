@echo off
rem Requirement 2 - Inventory service (Go + gRPC). Double-click this file, or type its name in cmd.
chcp 65001 >nul
title Requirement 2 - Inventory service (Go + gRPC)
cd /d "%~dp0backend"
call npm run demo:2
echo.
pause
