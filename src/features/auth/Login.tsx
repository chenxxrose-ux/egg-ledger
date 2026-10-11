import { useState } from 'react'
import { supabase } from '../data/supabase'
import { ErrorNote, useSubmit } from '../../ui/kit'
import { AppError } from '../data/errors'
import { deviceHasPasskey, markOfferPasskey, passkeySupported, signInWithFaceId } from './passkey'

export function Login() {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('egg-ledger-email') ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit()
  const faceId = useSubmit()
  // 只有這支手機設定過 Face ID 才顯示按鈕；沒設定過的先用密碼登入，登入後會詢問要不要設定
  const [showFaceId] = useState(() => passkeySupported() && deviceHasPasskey())

  async function login() {
    await submit(async () => {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (err) {
        if (/invalid login credentials/i.test(err.message)) throw new AppError('帳號或密碼不正確', 'validation')
        throw err
      }
      markOfferPasskey()
      try {
        localStorage.setItem('egg-ledger-email', email.trim())
      } catch {
        /* 忽略 */
      }
    })
  }

  return (
    <main className="login">
      <h1>叫蛋記帳</h1>
      <p className="note">阿寶、草莓各自用自己的帳號登入，看到的是同一本帳。</p>
      {showFaceId && (
        <>
          <button
            type="button"
            className="btn primary block"
            disabled={faceId.busy || busy}
            onClick={() => void faceId.submit(async () => void (await signInWithFaceId()))}
          >
            {faceId.busy ? '登入中…' : '用 Face ID 登入'}
          </button>
          <ErrorNote error={faceId.error} />
          <p className="note" style={{ textAlign: 'center' }}>或用密碼登入</p>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void login()
        }}
      >
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>密碼</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <ErrorNote error={error} />
        <button className={`btn ${showFaceId ? 'secondary' : 'primary'} block`} type="submit" disabled={busy || !email || !password}>
          {busy ? '登入中…' : '登入'}
        </button>
      </form>
    </main>
  )
}
