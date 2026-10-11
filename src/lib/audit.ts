// 把修改紀錄轉成人看得懂的一句話
import type { AuditEntry, Member } from './types'
import { formatDay } from './dates'

type Row = Record<string, unknown>

const ORDER_FIELDS: Record<string, string> = {
  ordered_on: '叫蛋日期',
  delivery_on: '送蛋日期',
  boxes: '箱數',
  price_per_box: '每箱價格',
  ordered_by: '叫蛋人',
}
const PAYMENT_FIELDS: Record<string, string> = { paid_on: '付款日期', payer: '付款人' }
const SALE_FIELDS: Record<string, string> = {
  sale_date: '日期',
  mode: '記錄方式',
  income: '收入',
  egg_count: '顆數',
  unit_price: '每顆售價',
  recorded_by: '登記人',
}
const LEDGER_FIELDS: Record<string, string> = { egg_unit_price: '預設每顆售價', name: '帳本名稱' }
const MODE: Record<string, string> = { income: '填收入', count: '填顆數', rest: '休息' }

export function describeAudit(e: AuditEntry, members: Member[], today: string): string {
  const name = (id: unknown) => members.find((m) => m.id === id)?.display_name ?? '（未知）'
  const day = (v: unknown) => (typeof v === 'string' ? formatDay(v, today) : '—')
  const money = (v: unknown) => (typeof v === 'number' ? `${v.toLocaleString('en-US')} 元` : '未填')
  const fmt = (field: string, v: unknown): string => {
    if (v === null || v === undefined) return field === 'price_per_box' ? '待補' : '空白'
    if (field.endsWith('_on') || field === 'sale_date') return day(v)
    if (['ordered_by', 'payer', 'recorded_by'].includes(field)) return name(v)
    if (['price_per_box', 'income', 'unit_price', 'egg_unit_price', 'amount'].includes(field)) return money(v)
    if (field === 'boxes') return `${v} 箱`
    if (field === 'egg_count') return `${v} 顆`
    if (field === 'mode') return MODE[String(v)] ?? String(v)
    return String(v)
  }
  const diff = (fields: Record<string, string>) => {
    const b = (e.before ?? {}) as Row
    const a = (e.after ?? {}) as Row
    const parts = Object.entries(fields)
      .filter(([k]) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
      .map(([k, label]) => `${label} ${fmt(k, b[k])} → ${fmt(k, a[k])}`)
    return parts.join('、')
  }
  const a = (e.after ?? {}) as Row
  const b = (e.before ?? {}) as Row

  switch (`${e.entity}:${e.action}`) {
    case 'egg_orders:create':
      return `新增叫蛋：${day(a.delivery_on)}送 ${a.boxes} 箱，每箱 ${fmt('price_per_box', a.price_per_box)}，${name(a.ordered_by)}叫`
    case 'egg_orders:update':
      return `修改叫蛋（${day(b.delivery_on)}送）：${diff(ORDER_FIELDS)}`
    case 'egg_orders:void_order':
      return `作廢叫蛋：${day(b.delivery_on)}送 ${b.boxes} 箱`
    case 'egg_orders:restore_order':
      return '復原作廢的叫蛋'
    case 'egg_orders:revert_order': {
      const list = (b.allocations as Row[] | undefined) ?? []
      const total = list.reduce((s, x) => s + Number(x.amount ?? 0), 0)
      return `改回未付款，取消已付 ${money(total)}`
    }
    case 'payments:pay': {
      const list = (a.allocations as Row[] | undefined) ?? []
      return `登記付款 ${money(a.total)}（${list.length} 筆叫蛋），付款人${name(a.payer)}，${day(a.paid_on)}`
    }
    case 'payments:void_payment': {
      const list = (b.allocations as Row[] | undefined) ?? []
      const total = list.reduce((s, x) => s + Number(x.amount ?? 0), 0)
      return `復原付款 ${money(total)}（原付款日 ${day(b.paid_on)}）`
    }
    case 'payments:update':
      return `更正付款：${diff(PAYMENT_FIELDS)}`
    case 'payment_allocations:update':
      return `更正付款金額：${fmt('amount', b.amount)} → ${fmt('amount', a.amount)}`
    case 'daily_sales:create':
      return `登記賣蛋 ${day(a.sale_date)}：${saleSummary(a)}`
    case 'daily_sales:update':
      return `修改賣蛋（${day(b.sale_date)}）：${diff(SALE_FIELDS)}`
    case 'ledgers:update':
      return `修改設定：${diff(LEDGER_FIELDS)}`
    case 'ledgers:create':
      return '建立帳本'
    case 'payment_allocations:create':
    case 'payments:create':
      return '登記付款'
    default:
      return `${e.entity} ${e.action}`
  }
}

function saleSummary(a: Row): string {
  if (a.mode === 'rest') return '休息'
  const income = `${Number(a.income).toLocaleString('en-US')} 元`
  if (a.mode === 'count') return `${a.egg_count} 顆 × ${a.unit_price} 元 = ${income}`
  return `收入 ${income}`
}
