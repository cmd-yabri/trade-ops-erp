@echo off
setlocal
cd /d "%~dp0"
set /p VERSION=<VERSION
echo ============================================
echo  TradeOps release %VERSION%
echo ============================================

REM 1. Backend tests (any failure stops the release)
set TRADEOPS_DATA_DIR=%~dp0build_data
pushd backend
..\.venv\Scripts\python.exe manage.py test tradeops || (popd & goto :fail)
popd

REM 2. Frontend type check + lint
pushd frontend
call npx tsc --noEmit -p tsconfig.app.json || (popd & goto :fail)
call npx eslint src --quiet || (popd & goto :fail)
popd

REM 3. WhatsApp gateway files for the installer (Node + Baileys; the exe itself stays small)
pushd whatsapp-service
call npm ci --omit=dev --no-audit --no-fund || (popd & goto :fail)
popd
if not exist whatsapp-service\node.exe (
    if exist "%ProgramFiles%\nodejs\node.exe" (copy /y "%ProgramFiles%\nodejs\node.exe" whatsapp-service\node.exe >nul) else (
        echo Node.js not found: install it once ^(winget install OpenJS.NodeJS.LTS^) so node.exe can be bundled.
        goto :fail
    )
)

REM 3b. Build the exe
call "%~dp0build_exe.bat" nopause || goto :fail

REM 4. Build the installer
set ISCC=
for %%P in ("%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" "%ProgramFiles%\Inno Setup 6\ISCC.exe") do if exist %%P set ISCC=%%~P
if not defined ISCC (
    echo Inno Setup 6 not found. Install it with:  winget install JRSoftware.InnoSetup
    goto :fail
)
"%ISCC%" /DAppVersion=%VERSION% installer\TradeOps.iss || goto :fail

REM 5. Checksum to send/keep with the installer
REM    (PSModulePath cleared: when started from PowerShell 7 it points Windows PowerShell at the wrong modules)
set PSModulePath=
powershell -NoProfile -Command "$f='dist\TradeOps-Setup-%VERSION%.exe'; $h=(Get-FileHash $f -Algorithm SHA256).Hash; \"$h  TradeOps-Setup-%VERSION%.exe\" | Set-Content -Encoding ascii 'dist\TradeOps-Setup-%VERSION%.sha256.txt'; $h"

echo.
echo DONE.  Send this file to customers:  dist\TradeOps-Setup-%VERSION%.exe
pause
exit /b 0

:fail
echo.
echo RELEASE FAILED - nothing should be sent to customers.
pause
exit /b 1
