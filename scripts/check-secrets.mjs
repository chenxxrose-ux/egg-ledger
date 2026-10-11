// 確認前端程式與 repo 沒有夾帶管理金鑰（service_role / secret key）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['dist', 'src', 'e2e', '.env', '.env.e2e', '.github']
const skip = new Set(['node_modules', '.git'])
const patterns = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
  [/service_role/i, 'service_role 字樣'],
  [/SUPABASE_SERVICE_ROLE/i, 'service role 環境變數'],
  [/postgres(ql)?:\/\/[^\s'"]+:[^\s'"]+@/i, '資料庫連線密碼'],
]

function* files(p) {
  let st
  try {
    st = statSync(p)
  } catch {
    return
  }
  if (st.isFile()) return yield p
  for (const f of readdirSync(p)) if (!skip.has(f)) yield* files(join(p, f))
}

// JWT 形式的金鑰：解出 role，只允許 anon
function badJwt(text) {
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      const role = JSON.parse(Buffer.from(m[1], 'base64url').toString()).role
      if (role && role !== 'anon') return `JWT role=${role}`
    } catch {
      /* 不是 JWT */
    }
  }
  return null
}

let failed = false
for (const root of roots) {
  for (const f of files(root)) {
    if (f.endsWith('check-secrets.mjs')) continue
    const text = readFileSync(f, 'utf8')
    for (const [re, label] of patterns) {
      if (re.test(text)) {
        console.error(`✗ ${f}: 發現 ${label}`)
        failed = true
      }
    }
    const jwt = badJwt(text)
    if (jwt) {
      console.error(`✗ ${f}: 發現 ${jwt}`)
      failed = true
    }
  }
}
if (failed) process.exit(1)
console.log('✓ 沒有發現管理金鑰')
