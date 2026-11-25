@echo off
chcp 65001 >nul
setlocal
title Thung rac thong minh IoT
cd /d "%~dp0"
set "NODE_PATH="
set "NODE_OPTIONS="

if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0scripts\start_project.cjs" %*
  goto finished
)
if exist "%~dp0PORTABLE.json" (
  echo Goi chay thieu runtime\node.exe. Hay giai nen lai TOAN BO file ZIP.
  pause
  exit /b 1
)

where node.exe >nul 2>nul
if not errorlevel 1 (
  node.exe "%~dp0scripts\start_project.cjs" %*
  goto finished
)
if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" "%~dp0scripts\start_project.cjs" %*
  goto finished
)
echo Khong tim thay Node.js. Hay cai Node.js LTS roi chay lai file nay.
pause
exit /b 1

:finished
if errorlevel 1 (
  echo.
  echo Khong the khoi dong. Xem nguyen nhan o phia tren.
  pause
  exit /b 1
)
exit /b 0
