# RunEC → BookWide ERP V2.0 mapping

This rebuild is based on the uploaded RunEC installation package, not on V1.2 patch code.

Detected original RunEC assets include:
- `sap/trans/quotation.html.jsp`, `i_quotation.html.jsp`, `quotationJournal`, `printQuotation*.jasper/.xls`
- `sap/trans/order.html.jsp`, `i_order.html.jsp`, `orderJournal`, `printOrder*.jasper/.xls`
- `sap/trans/i_shippingHeader.html.jsp`, `i_shippingDetail.html.jsp`, `i_shippingData`, `i_shippingFreightInsurance`, `i_shippingMark`
- `sap/trans/return.html.jsp`, `returnJournal`, `printReturn*`
- `sap/trans/invoice.html.jsp`, `invoiceJournal`, `printInvoice*`
- party organization/person/employee compiled JSPs including `i_partyOrganizationBasic`, contact and data forms.

V2 principles:
- V1.1 remains untouched at `/erp/`.
- V2 is a parallel clean install at `/erp-v2/`.
- No local PostgreSQL, `server.py`, or BAT.
- No ERP code is added to LINE Gift `gift-core.js`.
- Dedicated ERP Worker and dedicated R2 namespace `erp/v2/*`.
- BwCommerce/current product master remains the SKU source via `_meta/bw-products/products.json`.
- RunEC document flow is restored through one shared document engine: Quotation → Sales Order → Shipment → Return.
- Customer-specific SKU is a mapping field; it never replaces BookWide/ERP SKU.
- Quote print hides internal list price and discount columns.
