@echo off
setlocal
cd /d "%~dp0"
title BookWide ERP V0.6

set "PG_BIN=D:\PostgreSQL\8.0\bin"
set "PG_DATA=D:\PostgreSQL\8.0\data"
set "PG_LOG=D:\PostgreSQL\8.0\log\postgres_v06.log"

netstat -ano | findstr /R /C:":5433 .*LISTENING" >nul
if errorlevel 1 (
  echo Starting PostgreSQL on port 5433...
  if not exist "%PG_BIN%\pg_ctl.exe" (
    echo ERROR: Cannot find %PG_BIN%\pg_ctl.exe
    pause
    exit /b 1
  )
  if not exist "D:\PostgreSQL\8.0\log" mkdir "D:\PostgreSQL\8.0\log"
  "%PG_BIN%\pg_ctl.exe" -D "%PG_DATA%" -l "%PG_LOG%" -o "-p 5433 -h 127.0.0.1" start
  timeout /t 4 /nobreak >nul
)

python -c "import psycopg2" >nul 2>&1
if errorlevel 1 (
  echo Installing psycopg2-binary...
  python -m pip install psycopg2-binary
  if errorlevel 1 (
    echo ERROR: psycopg2-binary installation failed.
    pause
    exit /b 1
  )
)

echo Starting BookWide ERP V0.6...
python server.py
pause
