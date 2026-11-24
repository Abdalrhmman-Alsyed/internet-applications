@echo off
cd /d "%~dp0backend"
call npm run control:5
exit /b %errorlevel%
