import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AppError, toAppError } from '../features/data/errors'

/** 從底部彈出的表單；dialog=true 為置中的確認視窗 */
export function Sheet({
  title,
  onClose,
  children,
  dialog = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  dialog?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // iPhone 鍵盤彈出時，把正在輸入的欄位捲到可見範圍
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement
      if (t.matches('input, textarea, select')) setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)
    }
    el.addEventListener('focusin', onFocus)
    return () => el.removeEventListener('focusin', onFocus)
  }, [])

  return createPortal(
    <div className={`backdrop${dialog ? ' center' : ''}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`sheet${dialog ? ' dialog' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          {!dialog && (
            <button type="button" className="link-btn" onClick={onClose}>
              關閉
            </button>
          )}
        </header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** 送出中鎖住按鈕，防止連按；錯誤保留在畫面上，輸入不清除 */
export function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const lock = useRef(false)
  const submit = useCallback(async (fn: () => Promise<void>): Promise<boolean> => {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setError(toAppError(err))
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }, [])
  return { busy, error, setError, submit }
}

export function ErrorNote({ error }: { error: AppError | null }) {
  if (!error) return null
  return (
    <div className={`banner ${error.kind === 'conflict' ? 'warn' : 'error'}`} role="alert">
      {error.message}
    </div>
  )
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="choice" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ───── 提示訊息（含「復原」） ─────

type ToastMsg = { id: number; text: string; action?: { label: string; run: () => Promise<void> | void } }
const ToastContext = createContext<(t: Omit<ToastMsg, 'id'>) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((t: Omit<ToastMsg, 'id'>) => {
    clearTimeout(timer.current)
    setToast({ ...t, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), t.action ? 10000 : 3500)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await toast.action!.run()
                  setToast(null)
                } catch (err) {
                  show({ text: toAppError(err).message })
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? '處理中…' : toast.action.label}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

export const newRequestId = () => crypto.randomUUID()
