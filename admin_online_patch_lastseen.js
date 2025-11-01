import { supabase } from './supa.js';

async function loadAdminList() {
  const { data, error } = await supabase
    .from('profiles_admin') // ✅ 從 view 撈
    .select('email,display_name,is_admin,last_sign_in_at,expires_at,online')
    .order('online', { ascending: false })
    .order('last_seen', { ascending: false });

  if (error) {
    console.error('載入錯誤：', error);
    return;
  }

  console.log('管理清單：', data);
  // 這裡你可以把 data 填入表格，例如：
  // renderRows(data);
}

// 初始化
loadAdminList();
