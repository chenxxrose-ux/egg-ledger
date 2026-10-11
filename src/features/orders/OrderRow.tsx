import { useEffect, useState } from 'react'
import { useLedger } from '../data/store'
import { ErrorNote, useSubmit, useToast } from '../../ui/kit'
import { formatDay } from '../../lib/dates'
import { formatMoney, parseAmount } from '../../lib/money'
import type { OrderView } from '../../lib/ledger'

const n = (x: number) => x.toLocaleString('en-US')

export function OrderRow({
  view,
  onEdit,
  onPay,
  onRevert,
}: {
  view: OrderView
  onEdit: () => void
  onPay: () => void
  onRevert: () => void
}) {
  const { data, today, online, actions } = useLedger()
  const toast = useToast()
  const o = view.order
  const [editingPrice, setEditingPrice] = useState(false)
  const [priceText, setPriceText] = useState('')
  const [baseVersion, setBaseVersion] = useState(o.version)
  const { busy, error, setError, submit } = useSubmit()
  useEffect(() => {
    if (error?.kind === 'conflict') setBaseVersion(o.version)
  }, [error, o.version])
  const name = (id: string) => data.members.find((m) => m.id === id)?.display_name ?? '—'

  function startPriceEdit() {
    setPriceText(o.price_per_box == null ? '' : String(o.price_per_box))
    setError(null)
    setBaseVersion(o.version)
    setEditingPrice(true)
  }

  const price = parseAmount(priceText)
  async function savePrice() {
    if (price === undefined) return
    if (price === o.price_per_box) {
      setEditingPrice(false)
      return
    }
    const ok = await submit(() => actions.updateOrder({ ...o, version: baseVersion }, { price_per_box: price }))
    if (ok) {
      setEditingPrice(false)
      toast({ text: price == null ? '已改為價格待確認' : `已更新每箱 ${formatMoney(price)}` })
    }
  }

  return (
    <article className="card order" aria-label={`${formatDay(o.delivery_on, today)}送 ${o.boxes} 箱`}>
      <div className="meta">
        <button type="button" className="chip-btn date" onClick={onEdit} aria-label="修改送蛋日期">
          {formatDay(o.delivery_on, today)}
        </button>
        {view.isFuture && <span className="tag booking">預訂</span>}
        <button type="button" className="chip-btn" onClick={onEdit} aria-label="修改箱數">
          {o.boxes} 箱
        </button>
        <button type="button" className="chip-btn person" onClick={onEdit} aria-label="修改叫蛋人">
          {name(o.ordered_by)}叫
        </button>
      </div>

      <div className="money-row">
        {editingPrice ? (
          <form
            className="amount-edit"
            onSubmit={(e) => {
              e.preventDefault()
              void savePrice()
            }}
          >
            <input
              className={`input${price === undefined ? ' invalid' : ''}`}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="每箱價格"
              aria-label="每箱價格"
              autoFocus
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
            />
            <button type="submit" className="btn primary small" disabled={busy || price === undefined || !online}>
              {busy ? '…' : '儲存'}
            </button>
            <button type="button" className="btn ghost small" onClick={() => setEditingPrice(false)} disabled={busy}>
              取消
            </button>
            {price != null && o.boxes > 1 && <span className="hint">共 {formatMoney(price * o.boxes)}</span>}
          </form>
        ) : (
          <button
            type="button"
            className={`amount-btn${view.total == null ? ' unpriced' : ''}`}
            onClick={startPriceEdit}
            aria-label={view.total == null ? '補上價格' : '修改價格'}
          >
            {view.total == null ? (
              <span className="total">待補價格</span>
            ) : (
              <>
                <span className="total">{formatMoney(view.total)}</span>
                {o.boxes > 1 && <span className="per">每箱 {n(o.price_per_box!)} 元</span>}
              </>
            )}
          </button>
        )}

        {!editingPrice && <StatusButton view={view} onPay={onPay} onRevert={onRevert} onPrice={startPriceEdit} name={name} />}
      </div>
      {editingPrice && <ErrorNote error={error} />}
    </article>
  )
}

function StatusButton({
  view,
  onPay,
  onRevert,
  onPrice,
  name,
}: {
  view: OrderView
  onPay: () => void
  onRevert: () => void
  onPrice: () => void
  name: (id: string) => string
}) {
  const { today } = useLedger()
  const last = view.lastPayment
  switch (view.status) {
    case 'unpriced':
      return (
        <button type="button" className="status-btn unpriced" onClick={onPrice}>
          {view.paid > 0 ? `已付 ${n(view.paid)}` : '未付款'}
          <small>補價格後可付款</small>
        </button>
      )
    case 'unpaid':
      return (
        <button type="button" className="status-btn unpaid" onClick={onPay}>
          未付款
          <small>按這裡付款</small>
        </button>
      )
    case 'partial':
      return (
        <button type="button" className="status-btn partial" onClick={onPay}>
          已付 {n(view.paid)}
          <small>尚欠 {n(view.owed!)} 元</small>
        </button>
      )
    case 'paid':
      return (
        <button type="button" className="status-btn paid" onClick={onRevert}>
          已付清
          {last && (
            <small>
              {formatDay(last.paid_on, today)} {name(last.payer)}
            </small>
          )}
        </button>
      )
    case 'overpaid':
      return (
        <button type="button" className="status-btn overpaid" onClick={onRevert}>
          多付 {n(view.overpaid)} 元
          <small>已付 {n(view.paid)}</small>
        </button>
      )
  }
}
