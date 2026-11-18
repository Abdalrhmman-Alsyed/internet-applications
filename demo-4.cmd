@echo off
rem Requirement 4 - Queues (RabbitMQ) and real-time (Socket.io). Double-click this file, or type its name in cmd.
chcp 65001 >nul
title Requirement 4 - Queues and real-time
cd /d "%~dp0backend"
call npm run demo:4
echo.
pause
