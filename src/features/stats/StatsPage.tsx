import { useMemo } from 'react'
import { useLedger } from '../data/store'
import { formatMonth, monthOf, shiftMonth, taipeiToday } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { buildOrderViews, monthStats } from '../../lib/ledger'

export function StatsPage({
  month,
  setMonth,
  goFillDays,
}: {
  month: string
  setMonth: (m: string) => void
  goFillDays: () => void
}) {
  const { data, today } = useLedger()
  const views = useMemo(
    () => buildOrderViews(data.orders, data.payments, data.allocations, today),
    [data.orders, data.payments, data.allocations, today],
  )
  const s = monthStats(month, views, data.payments, data.allocations, data.sales, today)
  const isFutureMonth = month > monthOf(today)

  return (
    <>
      <div className="month-nav">
        <button type="button" aria-label="上個月" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <strong>{formatMonth(month)}</strong>
        <button type="button" aria-label="下個月" onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </button>
      </div>

      <section className="card" aria-label="進貨">
        <div className="kv">
          <span>本月進貨箱數</span>
          <span className="v">{s.boxes} 箱</span>
        </div>
        <div className="kv">
          <span>已知進貨成本</span>
          <span className="v">{formatMoney(s.knownCost)}</span>
        </div>
        {s.unpricedCount > 0 && (
          <div className="kv">
            <span>待補價格</span>
            <span className="v amber">{s.unpricedCount} 筆（未計入成本）</span>
          </div>
        )}
        <div className="kv">
          <span>當月付給廠商</span>
          <span className="v">{formatMoney(s.paidToVendor)}</span>
        </div>
        {s.future.count > 0 && (
          <div className="kv">
            <span>未來預訂</span>
            <span className="v">
              {s.future.count} 筆 {s.future.boxes} 箱
            </span>
          </div>
        )}
        <p className="note">進貨依送蛋日期計入月份，預訂要等送蛋日到了才算進貨；付款依付款日期計算。</p>
      </section>

      <section className="card" style={{ marginTop: 10 }} aria-label="賣蛋">
        <div className="kv">
          <span>已登記賣蛋收入</span>
          <span className="v">{formatMoney(s.income)}</span>
        </div>
        <div className="kv">
          <span>已登記進銷差額</span>
          {s.diff == null ? (
            <span className="v amber">補齊 {s.unpricedCount} 筆價格後顯示</span>
          ) : (
            <span className={`v${s.diff < 0 ? ' danger' : ''}`}>{s.diff < 0 ? `−${formatMoney(-s.diff)}` : formatMoney(s.diff)}</span>
          )}
        </div>
        <p className="note">
          進銷差額＝已登記收入－已知進貨成本。沒有扣庫存、滷料、瓦斯、包裝等成本，不是淨利；有未登記的日子時收入也不完整。
        </p>
      </section>

      <section className="card" style={{ marginTop: 10 }} aria-label="登記天數">
        {isFutureMonth ? (
          <p className="note">這個月還沒開始。</p>
        ) : (
          <>
            <div className="kv">
              <span>已登記</span>
              <span className="v">
                {s.recordedDays} 天{s.restDays > 0 && `（含休息 ${s.restDays} 天）`}
              </span>
            </div>
            {s.fixedRestDays > 0 && (
              <div className="kv">
                <span>週一固定休息</span>
                <span className="v">{s.fixedRestDays} 天</span>
              </div>
            )}
            <div className="kv">
              <span>尚未記錄</span>
              <span className={`v${s.missingDays > 0 ? ' amber' : ''}`}>{s.missingDays} 天</span>
            </div>
            {s.missingDays > 0 && (
              <button type="button" className="btn secondary block" style={{ marginTop: 8 }} onClick={goFillDays}>
                到日期表補登
              </button>
            )}
          </>
        )}
      </section>

      <section className="card" style={{ marginTop: 10 }} aria-label="備份">
        <div className="kv">
          <span>匯出備份</span>
          <button type="button" className="btn secondary small" onClick={() => exportBackup(data)}>
            下載 JSON
          </button>
        </div>
        <p className="note">免費方案沒有自動備份，建議每月下載一次存到雲端硬碟。內容包含所有叫蛋、付款、賣蛋紀錄與最近的修改紀錄。</p>
      </section>
    </>
  )
}

function exportBackup(data: ReturnType<typeof useLedger>['data']) {
  const payload = {
    exported_at: new Date().toISOString(),
    ledger: data.ledger,
    members: data.members,
    egg_orders: data.orders,
    payments: data.payments,
    payment_allocations: data.allocations,
    daily_sales: data.sales,
    audit_log_recent: data.audit,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `叫蛋記帳備份-${taipeiToday()}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
