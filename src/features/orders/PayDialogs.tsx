import { useState } from 'react'
import { Choice, ErrorNote, Sheet, newRequestId, useSubmit, useToast } from '../../ui/kit'
import { useLedger } from '../data/store'
import { formatDay } from '../../lib/dates'
import { formatMoney, parseAmount } from '../../lib/money'
import type { OrderView } from '../../lib/ledger'

/** 首頁按付款狀態：確定付清嗎？顯示金額、付款人、付款日期。取消不改資料。 */
export function PayConfirm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const { data, today, online, actions } = useLedger()
  const toast = useToast()
  const owed = view.owed ?? 0
  const [amountText, setAmountText] = useState(String(owed))
  const [payer, setPayer] = useState(data.me.id)
  const [paidOn, setPaidOn] = useState(today)
  const [editAmount, setEditAmount] = useState(false)
  const [requestId] = useState(newRequestId) // 同一個視窗只會登記一次
  const { busy, error, submit } = useSubmit()

  const amount = parseAmount(amountText)
  const amountValid = typeof amount === 'number' && amount > 0 && amount <= owed
  const dateValid = Boolean(paidOn) && paidOn <= today
  const isFull = amount === owed

  async function confirm() {
    const ok = await submit(async () => {
      const paymentId = await actions.recordPayment(
        { paid_on: paidOn, payer, allocations: [{ order_id: view.order.id, amount: amount as number }] },
        requestId,
      )
      toast({
        text: `已登記付款 ${formatMoney(amount as number)}`,
        action: { label: '復原', run: () => actions.voidPayment(paymentId, null) },
      })
    })
    if (ok) onClose()
  }

  return (
    <Sheet title={isFull ? '確定付清嗎？' : '確定付款嗎？'} onClose={onClose} dialog>
      <p style={{ margin: '4px 0 8px' }}>
        {formatDay(view.order.delivery_on, today)}送 {view.order.boxes} 箱，本筆 {formatMoney(view.total ?? 0)}
        {view.paid > 0 && `，已付 ${formatMoney(view.paid)}`}
      </p>
      <div className="card">
        <div className="kv">
          <span>本次付款金額</span>
          {editAmount ? (
            <input
              className={`input${amountValid ? '' : ' invalid'}`}
              style={{ width: 130, minHeight: 44 }}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="本次付款金額"
              value={amountText}
              autoFocus
              onChange={(e) => setAmountText(e.target.value)}
            />
          ) : (
            <span className="v">
              {formatMoney(owed)}{' '}
              <button type="button" className="link-btn" onClick={() => setEditAmount(true)}>
                只付一部分
              </button>
            </span>
          )}
        </div>
        {editAmount && !amountValid && <p className="hint error">金額需大於 0、不超過尚欠 {formatMoney(owed)}</p>}
        {editAmount && amountValid && !isFull && <p className="hint">付後尚欠 {formatMoney(owed - (amount as number))}</p>}
        <div className="field">
          <span>付款人</span>
          <Choice
            label="付款人"
            value={payer}
            onChange={setPayer}
            options={data.members.map((m) => ({ value: m.id, label: m.display_name }))}
          />
        </div>
        <label className="field">
          <span>付款日期</span>
          <input className={`input${dateValid ? '' : ' invalid'}`} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          {!dateValid && <p className="hint error">付款日期不能是未來</p>}
        </label>
      </div>
      <ErrorNote error={error} />
      <div className="row-btns">
        <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button type="button" className="btn primary" onClick={confirm} disabled={!amountValid || !dateValid || busy || !online}>
          {busy ? '登記中…' : '確認付款'}
        </button>
      </div>
    </Sheet>
  )
}

/** 已結清（或部分付款）改回未付款：需確認，紀錄保留 */
export function RevertConfirm({ view, onClose }: { view: OrderView; onClose: () => void }) {
  const { data, today, online, actions } = useLedger()
  const toast = useToast()
  const { busy, error, submit } = useSubmit()
  const payer = data.members.find((m) => m.id === view.lastPayment?.payer)?.display_name

  async function confirm() {
    const ok = await submit(() => actions.revertOrderPayments(view.order))
    if (ok) {
      toast({ text: '已改回未付款，付款紀錄仍保留在下方' })
      onClose()
    }
  }

  return (
    <Sheet title="改回未付款嗎？" onClose={onClose} dialog>
      <p>
        {formatDay(view.order.delivery_on, today)}送 {view.order.boxes} 箱這筆，已付 {formatMoney(view.paid)}
        {view.lastPayment && `（最後付款：${formatDay(view.lastPayment.paid_on, today)} ${payer ?? ''}）`}。
      </p>
      <p className="note">改回後這筆的付款會標記為已取消，修改紀錄會保留。如果同一次付款還包含其他叫蛋，那些不受影響。</p>
      <ErrorNote error={error} />
      <div className="row-btns">
        <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button type="button" className="btn danger" onClick={confirm} disabled={busy || !online}>
          {busy ? '處理中…' : '改回未付款'}
        </button>
      </div>
    </Sheet>
  )
}
