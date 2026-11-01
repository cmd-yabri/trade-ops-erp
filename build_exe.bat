@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo  TradeOps - build Windows executable
echo ============================================

REM 1. Python environment
if not exist .venv\Scripts\python.exe (
    echo Creating virtual environment...
    python -m venv .venv || goto :fail
)
call .venv\Scripts\python.exe -m pip install -q -r requirements-build.txt || goto :fail

REM 2. Compile the React app
pushd frontend
call npm ci || (popd & goto :fail)
call npm run build || (popd & goto :fail)
popd

REM 3. Collect static files (React build + Django) into ./staticfiles
set TRADEOPS_DATA_DIR=%~dp0build_data
.venv\Scripts\python.exe backend\manage.py collectstatic --noinput --clear || goto :fail

REM 4. Package (icon + version come from assets\icon.ico and the VERSION file)
.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean TradeOps.spec || goto :fail

echo.
echo Build complete:  dist\TradeOps.exe
echo For the customer installer run release.bat instead.
if /i not "%~1"=="nopause" pause
exit /b 0

:fail
echo.
echo BUILD FAILED
if /i not "%~1"=="nopause" pause
exit /b 1
