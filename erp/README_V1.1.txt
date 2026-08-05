BookWide ERP V1.1

基底：使用已證實能讀取 PostgreSQL 產品的 V0.6 server.py，不重寫資料庫核心。
新增：
1. 左側分類可展開/收起
2. 預設分類收起，不一次顯示大量產品
3. 每個分類每次顯示 100 筆，可按「載入更多」
4. 全部收起
5. 搜尋仍直接使用 V0.6 /api/products PostgreSQL 查詢
6. 保留標籤池、預覽、Code39 與批次列印
7. 唯讀，不寫入 PostgreSQL

啟動：START_V1.1_PRODUCT_TREE.bat
網址：http://127.0.0.1:8787/
