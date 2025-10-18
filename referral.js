import { supabase } from './supa.js'

// 建立或更新推薦紀錄
export async function recordReferral(user_id, amount) {
  const { data, error } = await supabase
    .from('referral_stats')
    .upsert({ user_id, total_amount: amount }, { onConflict: 'user_id' })
  
  if (error) {
    console.error('Insert/Update failed:', error.message)
  } else {
    console.log('Referral record saved:', data)
  }
}

// 讀取目前登入者的推薦紀錄
export async function getMyReferralStats() {
  const { data, error } = await supabase
    .from('referral_stats')
    .select('*')
  
  if (error) {
    console.error('Read failed:', error.message)
  } else {
    console.log('My referral stats:', data)
  }
}
