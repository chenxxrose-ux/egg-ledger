import { useMemo, useRef, useState } from 'react'
import { Sheet } from '../../ui/kit'
import { useLedger } from '../data/store'
import { monthOf } from '../../lib/dates'
import { reconcile, reconcileText, type OrderView } from '../../lib/ledger'
import { formatMoney } from '../../lib/money'

/** 複製給廠商的對帳文字：只對帳，不含下單內容 */
export function Reconcile({ views, onClose }: { views: OrderView[]; onClose: () => void }) {
  const { today } = useLedger()
  const [mode, setMode] = useState<'unsettled' | 'month'>('unsettled')
  const [month, setMonth] = useState(monthOf(today))
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const scope = useMemo(() => (mode === 'unsettled' ? { type: 'unsettled' as const } : { type: 'month' as const, month }), [mode, month])
  const r = useMemo(() => reconcile(views, scope, today), [views, scope, today])
  const text = useMemo(() => reconcileText(views, scope, today), [views, scope, today])

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
      <section className="recon-card" aria-label="對帳內容">
        <h3>{r.title}</h3>
        {r.rows.length === 0 ? (
          <p className="note">{r.emptyText}</p>
        ) : (
          <>
            <div className="recon-table" role="table" aria-label="叫蛋明細">
              <div className="recon-head" role="row">
                <span role="columnheader">送蛋日</span>
                <span role="columnheader" className="num">箱數</span>
                <span role="columnheader" className="num">金額</span>
              </div>
              {r.rows.map((row) => (
                <div className="recon-row" role="row" key={row.id}>
                  <span role="cell">
                    {row.date}
                    {row.isFuture && <span className="tag booking">預訂</span>}
                  </span>
                  <span role="cell" className="num">{row.boxes} 箱</span>
                  <span role="cell" className={`num${row.total == null ? ' amber' : ''}`}>
                    {row.total == null ? '待確認' : formatMoney(row.total)}
                  </span>
                  {row.note && (
                    <span role="cell" className="recon-note">
                      {row.note}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="recon-sum">
              <div className="kv">
                <span>共</span>
                <span className="v">{r.boxes} 箱</span>
              </div>
              <div className="kv">
                <span>已知未付</span>
                <strong className="v">{formatMoney(r.knownUnpaid)}</strong>
              </div>
              {r.unpriced > 0 && (
                <div className="kv">
                  <span>價格待確認</span>
                  <span className="v amber">{r.unpriced} 筆</span>
                </div>
              )}
            </div>
          </>
        )}
      </section>
      <button type="button" className="btn primary block" style={{ marginTop: 10 }} onClick={copy}>
        {copied === 'ok' ? '已複製，可以貼給廠商' : '複製文字'}
      </button>
      {copied === 'fail' && <p className="hint error">無法自動複製，請展開下方「複製出去的文字」，長按全選後複製。</p>}
      <details className="recon-raw" open={copied === 'fail' || undefined}>
        <summary>複製出去的文字</summary>
        <textarea ref={textRef} className="recon" readOnly value={text} aria-label="對帳文字" rows={Math.min(16, text.split('\n').length + 1)} />
      </details>
    </Sheet>
  )
}
