import { useMemo, useState } from 'react'
import { Choice, ErrorNote, Sheet, newRequestId, useSubmit, useToast } from '../../ui/kit'
import { useLedger } from '../data/store'
import { formatDay } from '../../lib/dates'
import { formatMoney, parseAmount } from '../../lib/money'
import { planAllocation, type OrderView } from '../../lib/ledger'

/** 多筆結帳：勾選幾次叫蛋一起付款；金額小於合計時按送蛋日期由舊到新分配 */
export function MultiPay({ views, onClose }: { views: OrderView[]; onClose: () => void }) {
  const { data, today, online, actions } = useLedger()
  const toast = useToast()
  const unsettled = useMemo(
    () => views.filter((v) => !v.settled).sort((a, b) => a.order.delivery_on.localeCompare(b.order.delivery_on)),
    [views],
  )
  const payable = unsettled.filter((v) => v.owed != null && v.owed > 0)
  // 預設勾選已送達且有價格的未結清紀錄
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(payable.filter((v) => !v.isFuture).map((v) => v.order.id)),
  )
  const [amountText, setAmountText] = useState<string | null>(null) // null = 跟著勾選合計
  const [payer, setPayer] = useState(data.me.id)
  const [paidOn, setPaidOn] = useState(today)
  const [step, setStep] = useState<'pick' | 'confirm'>('pick')
  const [requestId, setRequestId] = useState(newRequestId)
  const { busy, error, submit } = useSubmit()

  const chosen = payable.filter((v) => selected.has(v.order.id))
  const totalOwed = chosen.reduce((s, v) => s + v.owed!, 0)
  const amount = amountText == null ? totalOwed : parseAmount(amountText)
  const plan = planAllocation(chosen, typeof amount === 'number' ? amount : 0)
  const amountValid = typeof amount === 'number' && amount > 0 && plan.excess === 0
  const dateValid = Boolean(paidOn) && paidOn <= today
  const payerName = data.members.find((m) => m.id === payer)?.display_name

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setRequestId(newRequestId())
  }

  async function confirm() {
    const allocations = plan.items.filter((i) => i.amount > 0).map((i) => ({ order_id: i.view.order.id, amount: i.amount }))
    const ok = await submit(async () => {
      const paymentId = await actions.recordPayment({ paid_on: paidOn, payer, allocations }, requestId)
      toast({
        text: `已登記付款 ${formatMoney(amount as number)}（${allocations.length} 筆）`,
        action: { label: '復原', run: () => actions.voidPayment(paymentId, null) },
      })
    })
    if (ok) onClose()
  }

  if (step === 'confirm') {
    return (
      <Sheet title={amount === totalOwed ? '確定付清嗎？' : '確定付款嗎？'} onClose={onClose} dialog>
        <div className="card">
          <div className="kv">
            <span>本次付款金額</span>
            <span className="v">{formatMoney(amount as number)}</span>
          </div>
          <div className="kv">
            <span>付款人</span>
            <span className="v">{payerName}</span>
          </div>
          <div className="kv">
            <span>付款日期</span>
            <span className="v">{formatDay(paidOn, today)}</span>
          </div>
        </div>
        <AllocationPreview plan={plan} today={today} />
        <ErrorNote error={error} />
        <div className="row-btns">
          <button type="button" className="btn secondary" onClick={() => setStep('pick')} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={confirm} disabled={busy || !online}>
            {busy ? '登記中…' : '確認付款'}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title="多筆結帳" onClose={onClose}>
      {unsettled.length === 0 ? (
        <p className="empty">目前沒有未結清的叫蛋。</p>
      ) : (
        <>
          <p className="note">勾選這次要付的叫蛋。金額少於合計時，會從送蛋日期最舊的開始付。</p>
          <div role="group" aria-label="選擇叫蛋">
            {unsettled.map((v) => {
              const disabled = v.owed == null || v.owed <= 0
              return (
                <label key={v.order.id} className={`checkrow${disabled ? ' disabled' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selected.has(v.order.id)}
                    onChange={() => toggle(v.order.id)}
                  />
                  <span className="grow">
                    {formatDay(v.order.delivery_on, today)} {v.order.boxes} 箱{v.isFuture && <span className="tag booking"> 預訂</span>}
                  </span>
                  <span>{v.owed == null ? <span style={{ color: 'var(--amber)' }}>待補價格</span> : `欠 ${formatMoney(v.owed)}`}</span>
                </label>
              )
            })}
          </div>

          <label className="field">
            <span>本次付款金額（所選尚欠合計 {formatMoney(totalOwed)}）</span>
            <input
              className={`input${amountValid || chosen.length === 0 ? '' : ' invalid'}`}
              inputMode="numeric"
              pattern="[0-9]*"
              value={amountText ?? String(totalOwed)}
              onChange={(e) => {
                setAmountText(e.target.value)
                setRequestId(newRequestId())
              }}
            />
            {plan.excess > 0 && <p className="hint error">超過所選尚欠 {formatMoney(plan.excess)}，請減少金額或多勾幾筆</p>}
            {amountText != null && (
              <button type="button" className="link-btn" onClick={() => setAmountText(null)}>
                改回全部付清
              </button>
            )}
          </label>

          {chosen.length > 0 && amountValid && <AllocationPreview plan={plan} today={today} />}

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

          <ErrorNote error={error} />
          <button
            type="button"
            className="btn primary block"
            disabled={chosen.length === 0 || !amountValid || !dateValid || !online}
            onClick={() => setStep('confirm')}
          >
            下一步：確認付款
          </button>
        </>
      )}
    </Sheet>
  )
}

function AllocationPreview({ plan, today }: { plan: ReturnType<typeof planAllocation>; today: string }) {
  return (
    <div className="card" style={{ marginTop: 10 }} aria-label="分配結果">
      <strong style={{ fontSize: 15 }}>分配結果</strong>
      {plan.items.map((i) => (
        <div className="kv" key={i.view.order.id}>
          <span>
            {formatDay(i.view.order.delivery_on, today)} {i.view.order.boxes} 箱
          </span>
          <span className="v">
            {i.amount > 0 ? `付 ${i.amount.toLocaleString('en-US')}` : '這次不付'}
            {i.owedAfter > 0 ? `，仍欠 ${i.owedAfter.toLocaleString('en-US')}` : '，付清'}
          </span>
        </div>
      ))}
    </div>
  )
}
