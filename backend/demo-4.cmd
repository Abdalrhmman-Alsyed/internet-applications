@echo off
rem Requirement 4 - Queues (RabbitMQ) and real-time (Socket.io). Same as ..\demo-4.cmd, so it also works from the backend folder.
chcp 65001 >nul
title Requirement 4 - Queues and real-time
cd /d "%~dp0"
call npm run demo:4
echo.
pause
