// english-videos/supa.js
// 這檔案是純 JS，千萬不要包 <script> ... </script>

(function () {
  // 換成你的專案參數（你已經有）：
  const SUPABASE_URL = 'https://https://qtgwedankftrqjmzuset.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0Z3dlZGFua2Z0cnFqbXp1c2V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4NDYxMDMsImV4cCI6MjA3NDQyMjEwM30.jyETpt09pgm66aCZheMgsjtbKlVmYo-lt-hrrt6BF8g';

  // 建立全域 supa 物件，給 login.js / player.js 共用
  window.supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();





