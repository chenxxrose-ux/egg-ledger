import { createClient } from '@supabase/supabase-js'

// 這裡只會有 Supabase 的「公開金鑰」(publishable key)，它本來就設計成放在前端，
// 資料靠資料庫的權限規則(RLS)保護。資料庫管理金鑰絕不能放進前端（npm run check:secrets 會檢查）。
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const configured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'egg-ledger-auth' },
})
