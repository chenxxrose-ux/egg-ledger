import { supabase } from '../data/supabase'
import { AppError, toAppError } from '../data/errors'

// Face ID 登入用 Supabase 的 passkey（WebAuthn）：私鑰存在手機的鑰匙圈，用 Face ID 解鎖。
// 密碼登入一直保留，passkey 只是多一個方式。

const DEVICE_FLAG = 'egg-ledger-passkey' // 這支手機已設定過（只影響畫面提示）
const OFFER_FLAG = 'egg-ledger-offer-passkey' // 剛用密碼登入，詢問一次要不要設定

export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
}

function read(key: string, store: Storage = localStorage): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null, store: Storage = localStorage) {
  try {
    if (value == null) store.removeItem(key)
    else store.setItem(key, value)
  } catch {
    /* 私密瀏覽等情況寫不進去，不影響登入 */
  }
}

export const deviceHasPasskey = () => read(DEVICE_FLAG) === '1'
export const markOfferPasskey = () => write(OFFER_FLAG, '1', sessionStorage)
export function takeOfferPasskey(): boolean {
  const v = read(OFFER_FLAG, sessionStorage) === '1'
  write(OFFER_FLAG, null, sessionStorage)
  return v && passkeySupported() && !deviceHasPasskey()
}

type Coded = { code?: string; name?: string; cause?: unknown }

/** 使用者自己按了取消：不算錯誤，不顯示訊息 */
function isCancel(err: unknown): boolean {
  const e = err as Coded | null
  if (!e) return false
  if (e.code === 'ERROR_CEREMONY_ABORTED' || e.name === 'NotAllowedError' || e.name === 'AbortError') return true
  const cause = e.cause as Coded | undefined
  return cause?.name === 'NotAllowedError' || cause?.name === 'AbortError'
}

function toPasskeyError(err: unknown): AppError | null {
  if (isCancel(err)) return null
  const code = (err as Coded | null)?.code
  if (code === 'passkey_disabled') return new AppError('Face ID 登入還沒開啟，請先用密碼登入。', 'validation')
  if (code === 'webauthn_credential_not_found')
    return new AppError('這支手機還沒設定 Face ID 登入。請先用密碼登入，再按右上角的名字設定。', 'validation')
  if (code === 'webauthn_credential_exists' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
    return new AppError('這支手機已經設定過 Face ID 登入了。', 'validation')
  return toAppError(err)
}

/** 回傳 true = 成功；false = 使用者取消；失敗時丟出 AppError */
export async function signInWithFaceId(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.signInWithPasskey()
    if (error) throw error
    write(DEVICE_FLAG, '1')
    return true
  } catch (err) {
    const e = toPasskeyError(err)
    if (e) throw e
    return false
  }
}

export async function registerFaceId(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.registerPasskey()
    if (error) throw error
    write(DEVICE_FLAG, '1')
    return true
  } catch (err) {
    const e = toPasskeyError(err)
    if (e?.message.includes('已經設定過')) write(DEVICE_FLAG, '1')
    if (e) throw e
    return false
  }
}
