window.BOOKWIDE_MODULES = [
  {id:'system',name:'系統',icon:'⚙️',tree:[
    {name:'系統管理',children:[
      {name:'功能導引',page:'home'},
      {name:'系統文件',children:[{name:'人員組織總覽',page:'people'},{name:'公司總覽',page:'companies'},{name:'員工總覽',page:'employees'},{name:'權限管理文件',page:'permissions'},{name:'瀏覽所有文件',page:'documents'},{name:'移動文件',page:'move'}]},
      {name:'單據總覽',page:'documents-all'},{name:'批次處理',page:'batch'},{name:'批單處理',page:'batch-orders'},{name:'搜尋',page:'search'},
      {name:'標籤相關',page:'labels'},{name:'電子郵件相關',page:'email'},{name:'系統設定',page:'settings'},{name:'系統資訊',page:'info'},
      {name:'更改密碼',page:'password'},{name:'簽出系統',page:'logout'}
    ]}
  ]},
  {id:'sales',name:'銷售',icon:'🧾',tree:[{name:'銷售管理',children:[{name:'客戶總覽',page:'customers'},{name:'報價單',page:'quotation'},{name:'銷售訂單',page:'sales-order'},{name:'出貨單',page:'shipment'},{name:'銷售退回',page:'sales-return'}]}]},
  {id:'purchase',name:'採購',icon:'📦',tree:[{name:'採購管理',children:[{name:'廠商總覽',page:'suppliers'},{name:'採購詢價',page:'rfq'},{name:'採購單',page:'purchase-order'},{name:'進貨單',page:'receipt'},{name:'採購退回',page:'purchase-return'}]}]},
  {id:'inventory',name:'存貨',icon:'🏭',tree:[{name:'存貨管理',children:[{name:'商品總覽',page:'items'},{name:'倉庫總覽',page:'warehouses'},{name:'庫存查詢',page:'stock'},{name:'庫存調整',page:'stock-adjust'},{name:'庫存調撥',page:'stock-transfer'},{name:'BOM 表總覽',page:'bom'}]}]},
  {id:'ar',name:'應收',icon:'💵',tree:[{name:'應收管理',children:[{name:'應收帳款',page:'ar-ledger'},{name:'收款單',page:'receipts'},{name:'帳齡分析',page:'ar-aging'}]}]},
  {id:'ap',name:'應付',icon:'📒',tree:[{name:'應付管理',children:[{name:'應付帳款',page:'ap-ledger'},{name:'付款單',page:'payments'},{name:'帳齡分析',page:'ap-aging'}]}]},
  {id:'bank',name:'銀行',icon:'🏦',tree:[{name:'銀行管理',children:[{name:'銀行帳戶',page:'bank-accounts'},{name:'支票管理',page:'checks'},{name:'信用卡管理',page:'cards'},{name:'銀行對帳',page:'reconcile'}]}]},
  {id:'finance',name:'財務',icon:'💰',tree:[{name:'財務管理',children:[{name:'傳票',page:'journal'},{name:'總分類帳',page:'general-ledger'},{name:'試算表',page:'trial-balance'},{name:'資產負債表',page:'balance-sheet'},{name:'損益表',page:'income'}]}]},
  {id:'cost',name:'成本',icon:'🪙',tree:[{name:'成本管理',children:[{name:'標準成本',page:'std-cost'},{name:'實際成本',page:'actual-cost'},{name:'成本分攤',page:'cost-distribution'}]}]},
  {id:'invoice',name:'發票',icon:'🧾',tree:[{name:'發票管理',children:[{name:'發票總覽',page:'invoice-list'},{name:'開立發票',page:'invoice-create'},{name:'作廢／折讓',page:'invoice-void'}]}]},
  {id:'export',name:'出口',icon:'🚢',tree:[{name:'出口管理',children:[{name:'出口報價',page:'ex-quotation'},{name:'出口訂單',page:'ex-order'},{name:'裝箱單',page:'packing'},{name:'出口發票',page:'ex-invoice'}]}]},
  {id:'import',name:'進口',icon:'🛳️',tree:[{name:'進口管理',children:[{name:'進口訂單',page:'im-order'},{name:'信用狀',page:'lc'},{name:'進口發票',page:'im-invoice'}]}]},
  {id:'issues',name:'事項',icon:'📌',tree:[{name:'事項管理',children:[{name:'我的事項',page:'my-issues'},{name:'待辦事項',page:'todo'},{name:'排程',page:'schedule'}]}]}
];
