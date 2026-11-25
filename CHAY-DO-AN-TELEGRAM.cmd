@echo off
setlocal
cd /d "%~dp0"
call "%~dp0start-node-red-telegram.cmd" --choose-demo
exit /b %errorlevel%
