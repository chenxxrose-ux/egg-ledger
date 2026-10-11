import { useMemo, useRef, useState } from 'react'
import { Sheet } from '../../ui/kit'
import { useLedger } from '../data/store'
import { monthOf } from '../../lib/dates'
import { reconcileText, type OrderView } from '../../lib/ledger'

/** 複製給廠商的對帳文字：只對帳，不含下單內容 */
export function Reconcile({ views, onClose }: { views: OrderView[]; onClose: () => void }) {
  const { today } = useLedger()
  const [mode, setMode] = useState<'unsettled' | 'month'>('unsettled')
  const [month, setMonth] = useState(monthOf(today))
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const text = useMemo(
    () => reconcileText(views, mode === 'unsettled' ? { type: 'unsettled' } : { type: 'month', month }, today),
    [views, mode, month, today],
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('ok')
    } catch {
      // 舊版瀏覽器：選取文字讓使用者自己複製
      textRef.current?.select()
      setCopied(document.execCommand?.('copy') ? 'ok' : 'fail')
    }
  }

  return (
    <Sheet title="複製對帳" onClose={onClose}>
      <div className="seg" role="group" aria-label="對帳範圍">
        <button type="button" aria-pressed={mode === 'unsettled'} onClick={() => { setMode('unsettled'); setCopied(null) }}>
          累積未結清
        </button>
        <button type="button" aria-pressed={mode === 'month'} onClick={() => { setMode('month'); setCopied(null) }}>
          指定月份
        </button>
      </div>
      {mode === 'month' && (
        <label className="field">
          <span>月份（依送蛋日期，列出當月全部叫蛋）</span>
          <input className="input" type="month" value={month} onChange={(e) => { setMonth(e.target.value || monthOf(today)); setCopied(null) }} />
        </label>
      )}
      <textarea ref={textRef} className="recon" readOnly value={text} aria-label="對帳文字" rows={Math.min(16, text.split('\n').length + 1)} />
      <button type="button" className="btn primary block" style={{ marginTop: 10 }} onClick={copy}>
        {copied === 'ok' ? '已複製，可以貼給廠商' : '複製文字'}
      </button>
      {copied === 'fail' && <p className="hint error">無法自動複製，請長按上方文字全選後複製。</p>}
    </Sheet>
  )
}
