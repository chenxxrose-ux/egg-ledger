import { useState } from 'react'
import { supabase } from '../data/supabase'
import { ErrorNote, Sheet, useSubmit, useToast } from '../../ui/kit'
import { deviceHasPasskey, passkeySupported, registerFaceId } from './passkey'

/** 右上角名字：設定 Face ID 登入、登出。offer = 剛用密碼登入時主動詢問一次 */
export function AccountSheet({ me, offer = false, onClose }: { me: string; offer?: boolean; onClose: () => void }) {
  const toast = useToast()
  const { busy, error, submit } = useSubmit()
  const [hasPasskey, setHasPasskey] = useState(deviceHasPasskey)
  const supported = passkeySupported()

  async function setup() {
    await submit(async () => {
      if (await registerFaceId()) {
        setHasPasskey(true)
        toast({ text: '已設定 Face ID 登入' })
        onClose()
      }
    })
  }

  if (offer) {
    return (
      <Sheet title="下次用 Face ID 登入？" onClose={onClose} dialog>
        <p>設定後，這支手機下次登入只要刷 Face ID，不用輸入密碼。密碼登入仍然可以用。</p>
        <ErrorNote error={error} />
        <div className="row-btns">
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
            以後再說
          </button>
          <button type="button" className="btn primary" onClick={setup} disabled={busy}>
            {busy ? '設定中…' : '設定 Face ID'}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={`目前登入：${me || '—'}`} onClose={onClose} dialog>
      {supported &&
        (hasPasskey ? (
          <p className="note">這支手機已設定 Face ID 登入。</p>
        ) : (
          <>
            <p className="note">設定後，這支手機登入只要刷 Face ID，不用輸入密碼。</p>
            <button type="button" className="btn primary block" onClick={setup} disabled={busy}>
              {busy ? '設定中…' : '設定 Face ID 登入'}
            </button>
          </>
        ))}
      <ErrorNote error={error} />
      <div className="row-btns">
        <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button type="button" className="btn danger" onClick={() => void supabase.auth.signOut()} disabled={busy}>
          登出
        </button>
      </div>
    </Sheet>
  )
}
