# BookWide ERP V0.1 — RunEC 商品克隆（唯讀測試）

此版本先依 RunEC 商品管理的使用方式建立新介面，功能包括：

- 商品搜尋
- 商品詳細資料
- 商品照片
- 標籤池
- 標籤預覽
- 瀏覽器列印

## 使用方式

上傳整個資料夾到 GitHub Repository，開啟 GitHub Pages。請勿直接雙擊 `index.html`，因瀏覽器可能阻擋 JSON 載入。

## 目前資料來源

`data/products.json` 為測試資料。此版本不連線、不修改 RunEC。

## 下一階段

將 `products.json` 替換為公司主機上的唯讀 API，由 API 查詢 RunEC PostgreSQL 8.0 `we` 資料庫。未確認真實商品表與欄位前，不寫入舊資料庫。
