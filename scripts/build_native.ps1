$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compilerPath = Join-Path $projectRoot 'tmp\native-toolchain\ziglang\zig.exe'
if (!(Test-Path -LiteralPath $compilerPath)) {
    $compilerCommand = Get-Command zig -ErrorAction SilentlyContinue
    if (!$compilerCommand) { throw 'Can Zig C/C++ compiler de build lai. Ban ZIP da kem simulator/bin/smartbin-sim.exe.' }
    $compilerPath = $compilerCommand.Source
}
Push-Location $projectRoot
try {
    New-Item -ItemType Directory -Force -Path 'simulator\bin','tmp\zig-cache','tmp\zig-local' | Out-Null
    $env:ZIG_GLOBAL_CACHE_DIR = Join-Path $projectRoot 'tmp\zig-cache'
    $env:ZIG_LOCAL_CACHE_DIR = Join-Path $projectRoot 'tmp\zig-local'
    & $compilerPath cc -x c++ -std=c++11 -Wall -Wextra -Werror -Iinclude simulator/native.cpp -o simulator/bin/smartbin-sim.exe
    if ($LASTEXITCODE -ne 0) { throw 'Build simulator failed' }
    & $compilerPath cc -x c++ -std=c++11 -Wall -Wextra -Werror -Iinclude tests/logic_test.cpp -o tmp/logic_test.exe
    if ($LASTEXITCODE -ne 0) { throw 'Build logic tests failed' }
    & '.\tmp\logic_test.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Logic tests failed' }
    & $compilerPath cc -x c++ -std=c++11 -Wall -Wextra -Werror -Iinclude tests/controller_test.cpp -o tmp/controller_test.exe
    if ($LASTEXITCODE -ne 0) { throw 'Build controller tests failed' }
    & '.\tmp\controller_test.exe'
    if ($LASTEXITCODE -ne 0) { throw 'Controller tests failed' }
} finally { Pop-Location }
