// 帳務計算：純函式，不碰 UI 或資料庫。
import type { Allocation, DailySale, EggOrder, Payment } from './types'
import { daysInMonth, formatDay, formatMonth, monthOf, parseYmd, weekday, ymd } from './dates'

export type OrderStatus = 'unpriced' | 'unpaid' | 'partial' | 'paid' | 'overpaid'

export type OrderView = {
  order: EggOrder
  /** 本筆總額；價格未知為 null（絕不當成 0） */
  total: number | null
  /** 實際已付（有效付款分配加總） */
  paid: number
  /** 尚欠；價格未知為 null */
  owed: number | null
  /** 多付金額 */
  overpaid: number
  status: OrderStatus
  settled: boolean
  isFuture: boolean
  /** 最後一次付款（付清日期與付款人） */
  lastPayment: { paid_on: string; payer: string } | null
}

export function activeAllocations(payments: Payment[], allocations: Allocation[]): Allocation[] {
  const live = new Set(payments.filter((p) => !p.voided_at).map((p) => p.id))
  return allocations.filter((a) => !a.voided_at && live.has(a.payment_id))
}

export function orderTotal(o: Pick<EggOrder, 'boxes' | 'price_per_box'>): number | null {
  return o.price_per_box == null ? null : o.price_per_box * o.boxes
}

export function buildOrderViews(
  orders: EggOrder[],
  payments: Payment[],
  allocations: Allocation[],
  today: string,
): OrderView[] {
  const paymentById = new Map(payments.map((p) => [p.id, p]))
  const byOrder = new Map<string, Allocation[]>()
  for (const a of activeAllocations(payments, allocations)) {
    const list = byOrder.get(a.order_id) ?? []
    list.push(a)
    byOrder.set(a.order_id, list)
  }
  return orders
    .filter((o) => !o.voided_at)
    .map((order) => {
      const allocs = byOrder.get(order.id) ?? []
      const paid = allocs.reduce((s, a) => s + a.amount, 0)
      const total = orderTotal(order)
      let status: OrderStatus
      if (total == null) status = 'unpriced'
      else if (paid === 0 && total > 0) status = 'unpaid'
      else if (paid < total) status = 'partial'
      else if (paid === total) status = 'paid'
      else status = 'overpaid'
      const last = allocs
        .map((a) => paymentById.get(a.payment_id)!)
        .sort((a, b) => (a.paid_on === b.paid_on ? a.created_at.localeCompare(b.created_at) : a.paid_on.localeCompare(b.paid_on)))
        .at(-1)
      return {
        order,
        total,
        paid,
        owed: total == null ? null : Math.max(total - paid, 0),
        overpaid: total == null ? 0 : Math.max(paid - total, 0),
        status,
        settled: status === 'paid' || status === 'overpaid',
        isFuture: order.delivery_on > today,
        lastPayment: last ? { paid_on: last.paid_on, payer: last.payer } : null,
      }
    })
    .sort(compareByDeliveryDesc)
}

function compareByDeliveryDesc(a: OrderView, b: OrderView) {
  return (
    b.order.delivery_on.localeCompare(a.order.delivery_on) ||
    b.order.ordered_on.localeCompare(a.order.ordered_on) ||
    b.order.created_at.localeCompare(a.order.created_at)
  )
}

function compareByDeliveryAsc(a: OrderView, b: OrderView) {
  return -compareByDeliveryDesc(a, b)
}

export type HomeSummary = {
  /** 已知未付金額：只計價格已知的尚欠 */
  knownUnpaid: number
  unsettledCount: number
  unpricedCount: number
  counts: { unsettled: number; settled: number; all: number }
}

export function summarize(views: OrderView[]): HomeSummary {
  const unsettled = views.filter((v) => !v.settled)
  return {
    knownUnpaid: unsettled.reduce((s, v) => s + (v.owed ?? 0), 0),
    unsettledCount: unsettled.length,
    unpricedCount: views.filter((v) => v.total == null).length,
    counts: { unsettled: unsettled.length, settled: views.length - unsettled.length, all: views.length },
  }
}

export type AllocationPlan = {
  items: { view: OrderView; amount: number; owedAfter: number }[]
  /** 付款金額超過所選尚欠的部分 */
  excess: number
  totalOwed: number
}

/** 多筆結帳：按送蛋日期由舊到新分配付款金額 */
export function planAllocation(selected: OrderView[], amount: number): AllocationPlan {
  let left = amount
  const sorted = [...selected].filter((v) => v.owed != null && v.owed > 0).sort(compareByDeliveryAsc)
  const items = sorted.map((view) => {
    const give = Math.min(left, view.owed!)
    left -= give
    return { view, amount: give, owedAfter: view.owed! - give }
  })
  return { items, excess: left, totalOwed: sorted.reduce((s, v) => s + v.owed!, 0) }
}

// ───────────── 對帳文字 ─────────────

export type ReconcileScope = { type: 'unsettled' } | { type: 'month'; month: string }

const n = (x: number) => x.toLocaleString('en-US')

export function reconcileText(views: OrderView[], scope: ReconcileScope, today: string): string {
  const rows = views
    .filter((v) => (scope.type === 'unsettled' ? !v.settled : monthOf(v.order.delivery_on) === scope.month))
    .sort(compareByDeliveryAsc)
  const title = scope.type === 'unsettled' ? '叫蛋對帳（未結清）' : `叫蛋對帳（${formatMonth(scope.month)}，依送蛋日期）`
  if (rows.length === 0) {
    return `${title}\n目前沒有${scope.type === 'unsettled' ? '未結清' : '這個月'}的叫蛋紀錄。`
  }
  const lines = [title]
  for (const v of rows) {
    const date = formatDay(v.order.delivery_on, today) + (v.isFuture ? ' 預訂' : '')
    let line = `${date} ${v.order.boxes} 箱 `
    if (v.total == null) {
      line += '價格待確認'
      if (v.paid > 0) line += `｜已付 ${n(v.paid)} 元`
    } else {
      line += `共 ${n(v.total)} 元`
      if (v.status === 'partial') line += `｜已付 ${n(v.paid)} 元，尚欠 ${n(v.owed!)} 元`
      else if (v.status === 'paid') line += '｜已付清'
      else if (v.status === 'overpaid') line += `｜已付 ${n(v.paid)} 元，多付 ${n(v.overpaid)} 元`
    }
    lines.push(line)
  }
  const boxes = rows.reduce((s, v) => s + v.order.boxes, 0)
  const knownUnpaid = rows.filter((v) => !v.settled).reduce((s, v) => s + (v.owed ?? 0), 0)
  const unpriced = rows.filter((v) => v.total == null).length
  lines.push('—')
  lines.push(`總箱數：${n(boxes)} 箱`)
  lines.push(`已知未付合計：${n(knownUnpaid)} 元`)
  lines.push(`待補價格：${unpriced} 筆`)
  return lines.join('\n')
}

// ───────────── 賣蛋 ─────────────

export function saleIncome(s: DailySale): number {
  return s.mode === 'rest' ? 0 : (s.income ?? 0)
}

// ───────────── 每月統計 ─────────────

export type MonthStats = {
  month: string
  /** 送蛋日已到的進貨 */
  boxes: number
  knownCost: number
  unpricedCount: number
  income: number
  /** 價格齊全才有值 */
  diff: number | null
  paidToVendor: number
  recordedDays: number
  restDays: number
  /** 已過去（含今天）、沒登記的星期一（固定休息） */
  fixedRestDays: number
  /** 已過去（含今天）但沒登記的天數，不含固定休息的星期一 */
  missingDays: number
  elapsedDays: number
  future: { count: number; boxes: number }
}

export function monthStats(
  month: string,
  views: OrderView[],
  payments: Payment[],
  allocations: Allocation[],
  sales: DailySale[],
  today: string,
): MonthStats {
  const inMonth = views.filter((v) => monthOf(v.order.delivery_on) === month)
  const arrived = inMonth.filter((v) => !v.isFuture)
  const future = inMonth.filter((v) => v.isFuture)
  const knownCost = arrived.reduce((s, v) => s + (v.total ?? 0), 0)
  const unpricedCount = arrived.filter((v) => v.total == null).length

  const monthSales = sales.filter((s) => monthOf(s.sale_date) === month)
  const income = monthSales.reduce((s, x) => s + saleIncome(x), 0)

  const paymentMonth = new Map(payments.filter((p) => !p.voided_at).map((p) => [p.id, monthOf(p.paid_on)]))
  const paidToVendor = activeAllocations(payments, allocations)
    .filter((a) => paymentMonth.get(a.payment_id) === month)
    .reduce((s, a) => s + a.amount, 0)

  const elapsedDays = elapsedDaysInMonth(month, today)
  const recordedInElapsed = monthSales.filter((s) => s.sale_date <= today).length
  const recordedDates = new Set(monthSales.map((s) => s.sale_date))
  const fixedRestDays = monthDays(month)
    .slice(0, elapsedDays)
    .filter((d) => isFixedRestDay(d) && !recordedDates.has(d)).length

  return {
    month,
    boxes: arrived.reduce((s, v) => s + v.order.boxes, 0),
    knownCost,
    unpricedCount,
    income,
    diff: unpricedCount === 0 ? income - knownCost : null,
    paidToVendor,
    recordedDays: monthSales.length,
    restDays: monthSales.filter((s) => s.mode === 'rest').length,
    fixedRestDays,
    missingDays: Math.max(elapsedDays - recordedInElapsed - fixedRestDays, 0),
    elapsedDays,
    future: { count: future.length, boxes: future.reduce((s, v) => s + v.order.boxes, 0) },
  }
}

export function elapsedDaysInMonth(month: string, today: string): number {
  const tm = monthOf(today)
  if (month > tm) return 0
  if (month < tm) return daysInMonth(month)
  return parseYmd(today).d
}

/** 每週一固定休息。那天沒登記就當休息；真的有賣，照常登記即可，登記的紀錄優先 */
export function isFixedRestDay(d: string): boolean {
  return weekday(d) === '一'
}

export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  return Array.from({ length: daysInMonth(month) }, (_, i) => ymd(y, m, i + 1))
}
