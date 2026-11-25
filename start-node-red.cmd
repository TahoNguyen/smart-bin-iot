@echo off
setlocal
cd /d "%~dp0node-red"
set "NODE_OPTIONS="
set "NODE_PATH="
set "SMARTBIN_NODE="
if exist "%~dp0runtime\node.exe" set "SMARTBIN_NODE=%~dp0runtime\node.exe"
if not defined SMARTBIN_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "SMARTBIN_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined SMARTBIN_NODE (
  for /f "delims=" %%I in ('where.exe node.exe 2^>nul') do if not defined SMARTBIN_NODE set "SMARTBIN_NODE=%%I"
)
if not defined SMARTBIN_NODE (
  echo Node.js was not found. Use the bundled runtime or install Node.js LTS.
  goto failed
)
if not exist "node_modules\node-red\red.js" (
  if exist "%~dp0PORTABLE.json" (
    echo Node-RED dependencies are missing. Extract the complete portable ZIP again.
    goto failed
  )
  for %%I in ("%SMARTBIN_NODE%") do set "SMARTBIN_NPM=%%~dpInpm.cmd"
  call :install_dependencies
  if errorlevel 1 goto failed
)
if not defined PORT set "PORT=1880"
echo Dashboard: http://127.0.0.1:%PORT%/bin
echo Stop with Ctrl+C.
"%SMARTBIN_NODE%" "node_modules\node-red\red.js" --userDir .runtime --settings settings.js flows.json
if errorlevel 1 goto failed
exit /b 0

:install_dependencies
if exist "%SMARTBIN_NPM%" (
  call "%SMARTBIN_NPM%" ci
  exit /b
)
where.exe npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node-RED dependencies are missing. Install Node.js LTS with npm, or extract the complete portable ZIP.
  exit /b 1
)
call npm.cmd ci
exit /b

:failed
if /i not "%~1"=="--no-pause" pause
exit /b 1
