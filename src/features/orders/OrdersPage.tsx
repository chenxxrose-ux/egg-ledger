import { useMemo, useState } from 'react'
import { useLedger } from '../data/store'
import { buildOrderViews, summarize, type OrderView } from '../../lib/ledger'
import { formatMoney } from '../../lib/money'
import { OrderRow } from './OrderRow'
import { OrderForm } from './OrderForm'
import { PayConfirm, RevertConfirm } from './PayDialogs'
import { MultiPay } from './MultiPay'
import { Reconcile } from './Reconcile'
import { AuditList, PaymentHistory } from './History'

type Filter = 'unsettled' | 'settled' | 'all'
type Modal =
  | { type: 'new' }
  | { type: 'edit'; id: string }
  | { type: 'pay'; id: string }
  | { type: 'revert'; id: string }
  | { type: 'multi' }
  | { type: 'recon' }
  | null

export function OrdersPage() {
  const { data, today } = useLedger()
  const [filter, setFilter] = useState<Filter>('unsettled')
  const [modal, setModal] = useState<Modal>(null)

  const views = useMemo(
    () => buildOrderViews(data.orders, data.payments, data.allocations, today),
    [data.orders, data.payments, data.allocations, today],
  )
  const summary = summarize(views)
  const shown = views.filter((v) => (filter === 'all' ? true : filter === 'settled' ? v.settled : !v.settled))
  // 未結清依送蛋日期由舊到新（先處理舊帳），其他由新到舊
  if (filter === 'unsettled') shown.reverse()

  // 彈窗以 id 追蹤，資料更新（例如對方剛修改）時顯示最新內容
  const find = (id: string): OrderView | undefined => views.find((v) => v.order.id === id)
  const close = () => setModal(null)

  return (
    <>
      <section className="summary" aria-label="未付摘要">
        <div className="label">已知未付金額</div>
        <div className="big">{formatMoney(summary.knownUnpaid)}</div>
        <div className="chips">
          <span className="chip">未結清 {summary.unsettledCount} 筆</span>
          {summary.unpricedCount > 0 && <span className="chip amber">待補價格 {summary.unpricedCount} 筆</span>}
        </div>
      </section>

      <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={() => setModal({ type: 'new' })}>
        記一筆叫蛋
      </button>
      <div className="row-btns">
        <button type="button" className="btn secondary" onClick={() => setModal({ type: 'multi' })}>
          多筆結帳
        </button>
        <button type="button" className="btn secondary" onClick={() => setModal({ type: 'recon' })}>
          複製對帳
        </button>
      </div>

      <div className="seg" role="group" aria-label="篩選">
        {(
          [
            ['unsettled', '未結清', summary.counts.unsettled],
            ['settled', '已結清', summary.counts.settled],
            ['all', '全部', summary.counts.all],
          ] as const
        ).map(([key, label, count]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} {count}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="empty">
          {views.length === 0
            ? '還沒有叫蛋紀錄。按「記一筆叫蛋」開始。'
            : filter === 'unsettled'
              ? '沒有未結清的叫蛋，帳都付清了。'
              : '這個分類沒有紀錄。'}
        </p>
      ) : (
        <div className="list">
          {shown.map((v) => (
            <OrderRow
              key={v.order.id}
              view={v}
              onEdit={() => setModal({ type: 'edit', id: v.order.id })}
              onPay={() => setModal({ type: 'pay', id: v.order.id })}
              onRevert={() => setModal({ type: 'revert', id: v.order.id })}
            />
          ))}
        </div>
      )}

      <PaymentHistory />
      <AuditList />

      {modal?.type === 'new' && <OrderForm onClose={close} />}
      {modal?.type === 'edit' && find(modal.id) && <OrderForm key={modal.id} view={find(modal.id)} onClose={close} />}
      {modal?.type === 'pay' && find(modal.id) && <PayConfirm view={find(modal.id)!} onClose={close} />}
      {modal?.type === 'revert' && find(modal.id) && <RevertConfirm view={find(modal.id)!} onClose={close} />}
      {modal?.type === 'multi' && <MultiPay views={views} onClose={close} />}
      {modal?.type === 'recon' && <Reconcile views={views} onClose={close} />}
    </>
  )
}
