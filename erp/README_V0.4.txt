BookWide ERP V0.4 — PostgreSQL 真實產品＋標籤套印

重要：
1. 這版必須在 Win11 執行 START_V0.4_POSTGRES_TEST.bat。
2. 網址是 http://127.0.0.1:8787/，不是 bookwide.net/erp。
3. 它會連到 127.0.0.1:5433 / we，也就是 D:\PostgreSQL\8.0\data 啟動出的資料庫。
4. V0.4 為唯讀：可以讀真實產品並套印標籤，不會 UPDATE/INSERT/DELETE。
5. 首次執行會安裝 psycopg2-binary。

測試方式：
- 雙擊 START_V0.4_POSTGRES_TEST.bat
- 瀏覽器會自動開啟 http://127.0.0.1:8787/
- 右上角必須顯示「PostgreSQL 127.0.0.1:5433/we 已連線（唯讀）」
- 左側產品必須來自 PostgreSQL，而不是 data/products.js 假資料
- 點選產品後可直接進入標籤預覽並套印
