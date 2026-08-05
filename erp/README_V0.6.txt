BookWide ERP V0.6 - PostgreSQL Product Mapping + Label Printing

1. Copy all files into D:\bookwide_erp\erp and replace the old files.
2. Close the old V0.5 Python window.
3. Double-click START_V0.6_POSTGRES_PRODUCTS.bat.
4. Keep the black window open.
5. Open http://127.0.0.1:8787/

V0.6 changes:
- Reads public."Item" first.
- Automatically joins every text-bearing table that shares the same i_oid.
- Finds the RunEC product number/name fields without scanning all table rows.
- Repairs common Big5/CP950 mojibake.
- Handles Decimal values safely in JSON.
- Keeps PostgreSQL strictly read-only.
- Product data can be used immediately by the label preview/printing page.
