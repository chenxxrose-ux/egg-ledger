import { useMemo, useState } from 'react'
import { Choice, ErrorNote, Sheet, useSubmit, useToast } from '../../ui/kit'
import { useLedger } from '../data/store'
import { formatDay, formatTaipeiTime } from '../../lib/dates'
import { formatMoney, parseAmount } from '../../lib/money'
import { describeAudit } from '../../lib/audit'
import type { Allocation, Payment } from '../../lib/types'

/** 付款紀錄：可更正日期、付款人、金額，或復原整筆付款 */
export function PaymentHistory() {
  const { data, today } = useLedger()
  const [editing, setEditing] = useState<Payment | null>(null)
  const [showAll, setShowAll] = useState(false)
  const name = (id: string) => data.members.find((m) => m.id === id)?.display_name ?? '—'

  const rows = useMemo(
    () =>
      [...data.payments]
        .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at))
        .map((p) => {
          const allocs = data.allocations.filter((a) => a.payment_id === p.id && !a.voided_at)
          return { p, allocs, total: allocs.reduce((s, a) => s + a.amount, 0) }
        })
        .filter((r) => r.allocs.length > 0 || r.p.voided_at),
    [data.payments, data.allocations],
  )
  const shown = showAll ? rows : rows.slice(0, 5)

  return (
    <section aria-labelledby="pay-h">
      <h2 className="section-title" id="pay-h">
        付款紀錄
      </h2>
      {rows.length === 0 ? (
        <p className="note">還沒有付款紀錄。</p>
      ) : (
        <ul className="history">
          {shown.map(({ p, allocs, total }) => (
            <li key={p.id}>
              <button type="button" className="item" onClick={() => setEditing(p)} disabled={Boolean(p.voided_at)}>
                <span className={p.voided_at ? 'void' : ''}>
                  {formatDay(p.paid_on, today)} {name(p.payer)}付 {formatMoney(total)}（{allocs.length} 筆叫蛋）
                </span>
                {p.voided_at ? <span className="tag void"> 已復原</span> : <span className="when"> · 點此更正</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 5 && (
        <button type="button" className="link-btn" onClick={() => setShowAll((s) => !s)}>
          {showAll ? '收合' : `顯示全部 ${rows.length} 筆`}
        </button>
      )}
      {editing && <PaymentEditor payment={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function PaymentEditor({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { data, today, online, actions } = useLedger()
  const toast = useToast()
  // 以打開當下的版本為準，避免覆蓋對方剛做的更正
  const [allocs] = useState(() => data.allocations.filter((a) => a.payment_id === payment.id && !a.voided_at))
  const [paidOn, setPaidOn] = useState(payment.paid_on)
  const [payer, setPayer] = useState(payment.payer)
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(allocs.map((a) => [a.id, String(a.amount)])),
  )
  const { busy, error, submit } = useSubmit()
  const orderOf = (a: Allocation) => data.orders.find((o) => o.id === a.order_id)

  const parsed = allocs.map((a) => ({ allocation: a, amount: parseAmount(amounts[a.id] ?? '') }))
  const amountsValid = parsed.every((x) => typeof x.amount === 'number' && x.amount > 0)
  const dateValid = Boolean(paidOn) && paidOn <= today

  async function save() {
    const changes = parsed
      .filter((x) => x.amount !== x.allocation.amount)
      .map((x) => ({ allocation: x.allocation, amount: x.amount as number }))
    const ok = await submit(() => actions.correctPayment(payment, { paid_on: paidOn, payer }, changes))
    if (ok) {
      toast({ text: '已更正付款' })
      onClose()
    }
  }

  async function voidIt() {
    if (!window.confirm('確定復原這筆付款嗎？相關叫蛋會變回未付款，紀錄會保留。')) return
    const ok = await submit(() => actions.voidPayment(payment.id, payment.version))
    if (ok) {
      toast({ text: '已復原這筆付款' })
      onClose()
    }
  }

  return (
    <Sheet title="更正付款" onClose={onClose}>
      <label className="field">
        <span>付款日期</span>
        <input className={`input${dateValid ? '' : ' invalid'}`} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </label>
      <div className="field">
        <span>付款人</span>
        <Choice label="付款人" value={payer} onChange={setPayer} options={data.members.map((m) => ({ value: m.id, label: m.display_name }))} />
      </div>
      <div className="field">
        <span>各筆付款金額</span>
        {allocs.map((a) => {
          const o = orderOf(a)
          return (
            <label key={a.id} className="checkrow">
              <span className="grow">{o ? `${formatDay(o.delivery_on, today)} ${o.boxes} 箱` : '叫蛋'}</span>
              <input
                className="input"
                style={{ width: 130, minHeight: 44, height: 44 }}
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="付款金額"
                value={amounts[a.id] ?? ''}
                onChange={(e) => setAmounts((s) => ({ ...s, [a.id]: e.target.value }))}
              />
            </label>
          )
        })}
        {!amountsValid && <p className="hint error">金額需為大於 0 的整數。若這筆不該付，請用下方「復原這筆付款」或在首頁改回未付款。</p>}
      </div>
      <ErrorNote error={error} />
      <button type="button" className="btn primary block" onClick={save} disabled={!amountsValid || !dateValid || busy || !online}>
        {busy ? '儲存中…' : '儲存更正'}
      </button>
      <p style={{ textAlign: 'center', marginTop: 12 }}>
        <button type="button" className="link-btn danger" onClick={voidIt} disabled={busy || !online}>
          復原這筆付款
        </button>
      </p>
    </Sheet>
  )
}

/** 修改紀錄：誰、何時（台灣時間）、改了什麼。只能看，不能刪。 */
export function AuditList() {
  const { data, today, actions } = useLedger()
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const rows = showAll ? data.audit : data.audit.slice(0, 8)
  return (
    <section aria-labelledby="audit-h">
      <h2 className="section-title" id="audit-h">
        修改紀錄
      </h2>
      {data.audit.length === 0 ? (
        <p className="note">還沒有任何紀錄。</p>
      ) : (
        <ul className="history">
          {rows.map((e) => (
            <li key={e.id}>
              <div className="when">
                {formatTaipeiTime(e.at)} · {e.actor_name}
              </div>
              <div>{describeAudit(e, data.members, today)}</div>
            </li>
          ))}
        </ul>
      )}
      {((!showAll && (data.audit.length > 8 || data.auditHasMore)) || (showAll && data.auditHasMore)) && (
        <button
          type="button"
          className="link-btn"
          disabled={loading}
          onClick={async () => {
            if (!showAll) return setShowAll(true)
            setLoading(true)
            try {
              await actions.loadMoreAudit()
            } finally {
              setLoading(false)
            }
          }}
        >
          {!showAll ? '顯示更多' : loading ? '載入中…' : '載入更早的紀錄'}
        </button>
      )}
    </section>
  )
}
