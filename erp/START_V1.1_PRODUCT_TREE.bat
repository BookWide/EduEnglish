@echo off
setlocal
cd /d "%~dp0"
title BookWide ERP V1.1
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found.
  pause
  exit /b 1
)
echo Starting BookWide ERP V1.1...
python server.py
pause
