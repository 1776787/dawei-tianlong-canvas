@echo off
if /i "%~1"=="--background" goto background
"%SystemRoot%\System32\wscript.exe" //nologo "%~dp0start.vbs"
exit /b

:background
call :launch >"%~dp0web\launcher.log" 2>&1
exit /b %errorlevel%

:launch
setlocal EnableExtensions EnableDelayedExpansion
title 大威天龙画布 Launcher
cd /d "%~dp0web"

set "NODE_EXE="
for /f "delims=" %%P in ('where node 2^>nul') do if not defined NODE_EXE call :try_node "%%P"
if defined NVM_SYMLINK call :try_node "%NVM_SYMLINK%\node.exe"
if defined NVM_HOME call :try_node "%NVM_HOME%\node.exe"
for /d %%D in ("%AppData%\nvm\v*") do if not defined NODE_EXE call :try_node "%%~fD\node.exe"
call :try_node "%ProgramFiles%\nodejs\node.exe"
call :try_node "%ProgramFiles(x86)%\nodejs\node.exe"
call :try_node "%LocalAppData%\Programs\nodejs\node.exe"
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Node.js" /v InstallPath 2^>nul') do if /i "%%A"=="REG_SZ" if not defined NODE_EXE call :try_node "%%Bnode.exe"
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\WOW6432Node\Node.js" /v InstallPath 2^>nul') do if /i "%%A"=="REG_SZ" if not defined NODE_EXE call :try_node "%%Bnode.exe"
for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Node.js" /v InstallPath 2^>nul') do if /i "%%A"=="REG_SZ" if not defined NODE_EXE call :try_node "%%Bnode.exe"

if not defined NODE_EXE (
    echo [ERROR] Node.js was not found or could not be started.
    echo Open a new Command Prompt after installing Node.js LTS.
    exit /b 1
)
for %%D in ("!NODE_EXE!") do set "NODE_DIR=%%~dpD"
set "PATH=!NODE_DIR!;!PATH!"
set "NPM_CMD=!NODE_DIR!npm.cmd"
if not exist "!NPM_CMD!" set "NPM_CMD=npm.cmd"

echo [INFO] Using Node.js: !NODE_EXE!
set "NEEDS_INSTALL=0"
if not exist "node_modules\vite\package.json" set "NEEDS_INSTALL=1"
if not exist "node_modules\@rollup\rollup-win32-x64-msvc\package.json" set "NEEDS_INSTALL=1"
if not exist "node_modules\@tailwindcss\oxide-win32-x64-msvc\package.json" set "NEEDS_INSTALL=1"
if not exist "node_modules\@esbuild\win32-x64\package.json" set "NEEDS_INSTALL=1"
if not exist "node_modules\lightningcss-win32-x64-msvc\package.json" set "NEEDS_INSTALL=1"
if "!NEEDS_INSTALL!"=="0" "!NODE_EXE!" -e "require('rollup'); require('@tailwindcss/oxide'); require('esbuild'); require('lightningcss')" >nul 2>nul
if errorlevel 1 set "NEEDS_INSTALL=1"

if "!NEEDS_INSTALL!"=="1" (
    echo Installing dependencies...
    call "!NPM_CMD!" install --legacy-peer-deps --include=optional --no-audit --no-fund
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check network access and retry.
        exit /b 1
    )
)

rem Rebuild the MONOFORM director studio when its bundled build marker is missing/stale.
if not exist "public\monoform\.build-v4" (
    echo Building MONOFORM director studio...
    call "!NPM_CMD!" run build:monoform
    if errorlevel 1 (
        echo [WARN] MONOFORM build failed; the director node will use the previous build.
    ) else (
        echo build-v4>"public\monoform\.build-v4"
    )
)
"!NODE_EXE!" "%~dp0web\scripts\launch-browser.mjs"
exit /b !errorlevel!

:try_node
if defined NODE_EXE exit /b 0
if not exist "%~1" exit /b 0
"%~1" --version >nul 2>nul
if errorlevel 1 exit /b 0
set "NODE_EXE=%~1"
exit /b 0
