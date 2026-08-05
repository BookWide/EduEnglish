@echo off
chcp 65001 >nul
cd /d "%~dp0"
title BookWide ERP V0.5 PostgreSQL TEST

echo ================================================================
echo BookWide ERP V0.5 - PostgreSQL 真實連線測試（唯讀）
echo ================================================================

set "PG_BIN=D:\PostgreSQL\8.0\bin"
set "PG_DATA=D:\PostgreSQL\8.0\data"
set "PG_LOG=D:\PostgreSQL\8.0\log\postgres.log"

if not exist "%PG_BIN%\pg_ctl.exe" (
  echo [錯誤] 找不到 %PG_BIN%\pg_ctl.exe
  pause
  exit /b 1
)

if not exist "D:\PostgreSQL\8.0\log" mkdir "D:\PostgreSQL\8.0\log"

"%PG_BIN%\pg_ctl.exe" -D "%PG_DATA%" status >nul 2>&1
if errorlevel 1 (
  echo [INFO] PostgreSQL 尚未啟動，正在啟動 5433...
  "%PG_BIN%\pg_ctl.exe" -D "%PG_DATA%" -l "%PG_LOG%" -o "-p 5433 -h 127.0.0.1" start
  timeout /t 3 /nobreak >nul
) else (
  echo [OK] PostgreSQL 已在執行。
)

python -c "import psycopg2" >nul 2>&1
if errorlevel 1 (
  echo [INFO] 第一次執行，安裝 psycopg2-binary...
  python -m pip install --user psycopg2-binary
  if errorlevel 1 (
    echo [錯誤] psycopg2-binary 安裝失敗。
    pause
    exit /b 1
  )
)

set "ERP_DB_HOST=127.0.0.1"
set "ERP_DB_PORT=5433"
set "ERP_DB_NAME=we"
set "ERP_DB_USER=postgresql"
set "ERP_DB_PASSWORD=ssdbqazse"
set "ERP_WEB_PORT=8787"
python server.py
pause
