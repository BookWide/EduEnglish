# BookWide ERP V0.2｜RunEC 商品克隆

本版遵守「先克隆、再進化」：

- 依 RunEC 原順序保留：基本資料、其他資料、交易對象、安全存量、庫存數量、附件、狀態。
- 新增功能只放在最後：標籤池、標籤預覽。
- 內建 `424.10刀片` 的 21 個既有 `.ezp` 模板，可搜尋及下載後用 QLabel IV 開啟。
- 使用 `products.js`，所以可直接雙擊 `index.html` 測試，也可上傳 GitHub Pages。
- 目前為唯讀測試資料，未連接 RunEC PostgreSQL，也不會寫回原 ERP。

## GitHub 放置
將本資料夾內所有檔案與資料夾放入：

`EduEnglish/erp/`

測試網址：

`https://bookwide.github.io/EduEnglish/erp/`

## 一鍵部署
解壓縮後，雙擊 `一鍵部署到GitHub.bat`：
- 有安裝 Git：自動下載／更新 `BookWide/EduEnglish`，備份原 `erp`，覆蓋並推送。
- 沒有安裝 Git：自動建立桌面上傳資料夾，並開啟 GitHub `/erp` 上傳頁。
