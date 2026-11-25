@echo off
setlocal
cd /d "%~dp0"

where.exe node.exe >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js. Cai Node.js 24 LTS roi mo lai.
  goto failed
)
where.exe npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay npm.cmd. Cai ban Node.js co kem npm.
  goto failed
)
if not exist "tmp\native-toolchain\ziglang\zig.exe" (
  where.exe zig.exe >nul 2>nul
  if errorlevel 1 (
    echo Khong tim thay Zig. Giai nen Zig 0.13.0 va them thu muc chua zig.exe vao PATH.
    goto failed
  )
)

echo Dang cai Node-RED va MQTT...
pushd node-red
call npm.cmd ci --include=dev --no-audit --no-fund
set "SMARTBIN_INSTALL_RESULT=%errorlevel%"
popd
if not "%SMARTBIN_INSTALL_RESULT%"=="0" goto failed

echo Dang bien dich va kiem tra bo mo phong...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build_native.ps1"
if errorlevel 1 goto failed

echo Cai dat xong. Chay CHAY-DO-AN.cmd de mo demo.
if /i not "%~1"=="--no-pause" pause
exit /b 0

:failed
echo Cai dat chua hoan tat. Xem thong bao phia tren va README.md.
if /i not "%~1"=="--no-pause" pause
exit /b 1
