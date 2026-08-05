@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem BookWide ERP V0.2 - 一鍵部署到 GitHub
rem Repository: https://github.com/BookWide/EduEnglish
rem Target folder: erp
rem ============================================================

set "REPO_URL=https://github.com/BookWide/EduEnglish.git"
set "BRANCH=main"
set "WORK_ROOT=%USERPROFILE%\Documents\BookWide_ERP_Git"
set "REPO_DIR=%WORK_ROOT%\EduEnglish"
set "TARGET_DIR=%REPO_DIR%\erp"
set "SOURCE_DIR=%~dp0"

cls
echo ============================================================
echo   BookWide ERP V0.2 - 一鍵部署到 GitHub /erp
echo ============================================================
echo.
echo 程式來源：%SOURCE_DIR%
echo GitHub 專案：%REPO_URL%
echo 目標資料夾：erp
echo.

where git >nul 2>nul
if errorlevel 1 goto NO_GIT

if not exist "%WORK_ROOT%" mkdir "%WORK_ROOT%"

if not exist "%REPO_DIR%\.git" (
    echo [1/5] 第一次下載 GitHub 專案...
    git clone -b "%BRANCH%" "%REPO_URL%" "%REPO_DIR%"
    if errorlevel 1 goto ERROR
) else (
    echo [1/5] 更新本機 GitHub 專案...
    pushd "%REPO_DIR%"
    git checkout "%BRANCH%"
    if errorlevel 1 goto ERROR_POPD
    git pull origin "%BRANCH%"
    if errorlevel 1 goto ERROR_POPD
    popd
)

for /f "tokens=1-4 delims=/ " %%a in ("%date%") do set "DATESTAMP=%%a%%b%%c%%d"
for /f "tokens=1-3 delims=:,. " %%a in ("%time%") do set "TIMESTAMP=%%a%%b%%c"
set "TIMESTAMP=%TIMESTAMP: =0%"
set "BACKUP_DIR=%REPO_DIR%\erp_backup_%DATESTAMP%_%TIMESTAMP%"

if exist "%TARGET_DIR%" (
    echo [2/5] 備份原有 erp 資料夾...
    robocopy "%TARGET_DIR%" "%BACKUP_DIR%" /E /R:1 /W:1 >nul
)

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [3/5] 覆蓋新版 ERP 程式...
robocopy "%SOURCE_DIR%" "%TARGET_DIR%" /MIR /R:1 /W:1 /XD ".git" /XF "一鍵部署到GitHub.bat" >nul
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 goto ERROR

pushd "%REPO_DIR%"
echo [4/5] 建立 GitHub 版本...
git add erp
if exist "%BACKUP_DIR%" git add "%BACKUP_DIR%"
git commit -m "BookWide ERP V0.2 RunEC product clone"
if errorlevel 1 (
    echo 沒有新的檔案需要提交，或 Commit 未建立。
)

echo [5/5] 上傳到 GitHub...
git push origin "%BRANCH%"
if errorlevel 1 goto ERROR_POPD
popd

echo.
echo ============================================================
echo   完成！已部署到 GitHub：EduEnglish/erp
echo ============================================================
echo 測試網址：
echo https://bookwide.github.io/EduEnglish/erp/
echo.
start "" "https://bookwide.github.io/EduEnglish/erp/"
pause
exit /b 0

:NO_GIT
cls
echo ============================================================
echo   找不到 Git for Windows
 echo ============================================================
echo.
echo 先安裝 Git for Windows，安裝完成後重新執行本 BAT。
echo.
echo 目前先幫你建立「手動上傳資料夾」。
set "UPLOAD_DIR=%USERPROFILE%\Desktop\BookWide_ERP_V0.2_UPLOAD_TO_GITHUB_ERP"
if exist "%UPLOAD_DIR%" rmdir /s /q "%UPLOAD_DIR%"
mkdir "%UPLOAD_DIR%"
robocopy "%SOURCE_DIR%" "%UPLOAD_DIR%" /E /R:1 /W:1 /XF "一鍵部署到GitHub.bat" >nul
start "" explorer "%UPLOAD_DIR%"
start "" "https://github.com/BookWide/EduEnglish/upload/main/erp"
echo.
echo 已開啟：
echo 1. 桌面的手動上傳資料夾
echo 2. GitHub erp 上傳頁面
echo.
echo 將資料夾內全部檔案與資料夾拖入 GitHub 即可。
pause
exit /b 1

:ERROR_POPD
popd
:ERROR
echo.
echo ============================================================
echo   部署失敗，沒有刪除原本 GitHub 資料。
echo ============================================================
echo 請截圖此畫面給我。
pause
exit /b 1
