@echo off
cd /d "%~dp0backend"
call npm run demo:5 -- %*
exit /b %errorlevel%
