// Public connection settings for the Enchanted store.
// These two values are SAFE to be public. Never put the database password,
// the secret/service_role key, or the Resend key in this file.
window.ENCHANTED_CONFIG = {
  supabaseUrl: 'https://pmpemnckvebyfvqkicew.supabase.co',
  supabaseKey: 'sb_publishable_k1JhiQsAfm54nGsvXH4Reg_fp4UvboT'
};

// One shared connection to Supabase for every page.
window.sb = window.supabase.createClient(window.ENCHANTED_CONFIG.supabaseUrl, window.ENCHANTED_CONFIG.supabaseKey);
