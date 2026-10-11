import { describe, expect, test } from 'vitest'
import type { Allocation, DailySale, EggOrder, Payment } from './types'
import { buildOrderViews, monthStats, planAllocation, reconcileText, summarize } from './ledger'
import { formatDay, taipeiToday } from './dates'
import { parseAmount } from './money'

const TODAY = '2026-10-12'
let seq = 0
function order(p: Partial<EggOrder> & { delivery_on: string }): EggOrder {
  seq++
  return {
    id: `o${seq}`,
    ledger_id: 'L',
    ordered_on: p.ordered_on ?? p.delivery_on,
    boxes: 1,
    price_per_box: 850,
    ordered_by: 'm-berry',
    voided_at: null,
    version: 1,
    created_at: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    ...p,
  }
}
function payment(id: string, paid_on: string, extra: Partial<Payment> = {}): Payment {
  return { id, ledger_id: 'L', paid_on, payer: 'm-bao', voided_at: null, version: 1, created_at: `${paid_on}T10:00:00Z`, ...extra }
}
function alloc(payment_id: string, order_id: string, amount: number, extra: Partial<Allocation> = {}): Allocation {
  return { id: `${payment_id}-${order_id}`, payment_id, order_id, amount, voided_at: null, version: 1, ...extra }
}

describe('日期', () => {
  test('同年只顯示月/日（星期）', () => {
    expect(formatDay('2026-10-12', TODAY)).toBe('10/12（一）')
  })
  test('跨年顯示年份', () => {
    expect(formatDay('2025-12-30', TODAY)).toBe('2025/12/30（二）')
  })
  test('台灣時區的今天', () => {
    // UTC 10/11 17:00 = 台灣 10/12 01:00
    expect(taipeiToday(new Date('2026-10-11T17:00:00Z'))).toBe('2026-10-12')
  })
})

describe('金額輸入', () => {
  test('空白是未知，不是 0', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('0')).toBe(0)
    expect(parseAmount('1,700')).toBe(1700)
    expect(parseAmount('8.5')).toBeUndefined()
    expect(parseAmount('-5')).toBeUndefined()
  })
})

describe('首頁統計', () => {
  test('未知價格不算 0、不算結清', () => {
    const a = order({ delivery_on: '2026-10-01', price_per_box: null })
    const b = order({ delivery_on: '2026-10-02', boxes: 2 })
    const views = buildOrderViews([a, b], [], [], TODAY)
    const s = summarize(views)
    expect(s).toEqual({ knownUnpaid: 1700, unsettledCount: 2, unpricedCount: 1, counts: { unsettled: 2, settled: 0, all: 2 } })
    expect(views.find((v) => v.order.id === a.id)!.status).toBe('unpriced')
  })

  test('部分付款顯示已付與尚欠', () => {
    const a = order({ delivery_on: '2026-10-01', boxes: 2 })
    const views = buildOrderViews([a], [payment('p1', '2026-10-05')], [alloc('p1', a.id, 1000)], TODAY)
    expect(views[0]).toMatchObject({ total: 1700, paid: 1000, owed: 700, status: 'partial', settled: false })
  })

  test('改價後差額重算、保留已付、顯示多付', () => {
    const a = order({ delivery_on: '2026-10-01', boxes: 2, price_per_box: 800 })
    const views = buildOrderViews([a], [payment('p1', '2026-10-05')], [alloc('p1', a.id, 1700)], TODAY)
    expect(views[0]).toMatchObject({ total: 1600, paid: 1700, owed: 0, overpaid: 100, status: 'overpaid', settled: true })
  })

  test('作廢的付款與分配不算', () => {
    const a = order({ delivery_on: '2026-10-01' })
    const views = buildOrderViews(
      [a],
      [payment('p1', '2026-10-05', { voided_at: 'x' }), payment('p2', '2026-10-06')],
      [alloc('p1', a.id, 850), alloc('p2', a.id, 300, { voided_at: 'x' })],
      TODAY,
    )
    expect(views[0]).toMatchObject({ paid: 0, status: 'unpaid' })
  })

  test('結清後顯示最後付款', () => {
    const a = order({ delivery_on: '2026-10-01' })
    const views = buildOrderViews(
      [a],
      [payment('p1', '2026-10-03'), payment('p2', '2026-10-05', { payer: 'm-berry' })],
      [alloc('p1', a.id, 500), alloc('p2', a.id, 350)],
      TODAY,
    )
    expect(views[0].lastPayment).toEqual({ paid_on: '2026-10-05', payer: 'm-berry' })
  })

  test('未來送蛋為預訂', () => {
    const views = buildOrderViews([order({ delivery_on: '2026-10-13' })], [], [], TODAY)
    expect(views[0].isFuture).toBe(true)
  })
})

describe('多筆結帳分配', () => {
  test('部分付款按送蛋日期由舊到新', () => {
    const a = order({ delivery_on: '2026-10-05' })
    const b = order({ delivery_on: '2026-10-01' })
    const c = order({ delivery_on: '2026-10-03' })
    const views = buildOrderViews([a, b, c], [], [], TODAY)
    const plan = planAllocation(views, 1200)
    expect(plan.items.map((i) => [i.view.order.delivery_on, i.amount, i.owedAfter])).toEqual([
      ['2026-10-01', 850, 0],
      ['2026-10-03', 350, 500],
      ['2026-10-05', 0, 850],
    ])
    expect(plan.excess).toBe(0)
    expect(plan.totalOwed).toBe(2550)
  })
  test('已部分付款的只分配尚欠，超過顯示多出金額', () => {
    const a = order({ delivery_on: '2026-10-01' })
    const views = buildOrderViews([a], [payment('p1', '2026-10-02')], [alloc('p1', a.id, 800)], TODAY)
    const plan = planAllocation(views, 100)
    expect(plan.items[0].amount).toBe(50)
    expect(plan.excess).toBe(50)
  })
  test('未知價格不參與分配', () => {
    const views = buildOrderViews([order({ delivery_on: '2026-10-01', price_per_box: null })], [], [], TODAY)
    expect(planAllocation(views, 100).items).toHaveLength(0)
  })
})

describe('對帳文字', () => {
  test('未結清：含預訂、部分付款、價格待確認與合計', () => {
    const a = order({ delivery_on: '2026-10-08', boxes: 2 })
    const b = order({ delivery_on: '2026-10-10' })
    const c = order({ delivery_on: '2026-10-13', price_per_box: null })
    const d = order({ delivery_on: '2026-10-01' }) // 已付清，不列
    const views = buildOrderViews(
      [a, b, c, d],
      [payment('p1', '2026-10-11')],
      [alloc('p1', b.id, 500), alloc('p1', d.id, 850)],
      TODAY,
    )
    expect(reconcileText(views, { type: 'unsettled' }, TODAY)).toBe(
      [
        '叫蛋對帳（未結清）',
        '',
        '・10/8（四） 2 箱，1,700 元',
        '・10/10（六） 1 箱，850 元（已付 500，尚欠 350）',
        '・10/13（二）預訂 1 箱，價格待確認',
        '',
        '共 4 箱，已知未付 2,050 元',
        '另有 1 筆價格待確認',
      ].join('\n'),
    )
  })

  test('跨月：指定月份列出當月全部（依送蛋日期），跨年顯示年份', () => {
    const a = order({ delivery_on: '2025-12-30', ordered_on: '2025-12-29' })
    const b = order({ delivery_on: '2026-01-02', ordered_on: '2025-12-31' })
    const views = buildOrderViews([a, b], [payment('p1', '2026-01-03')], [alloc('p1', a.id, 850)], TODAY)
    expect(reconcileText(views, { type: 'month', month: '2025-12' }, TODAY)).toBe(
      ['叫蛋對帳（2025 年 12 月，依送蛋日期）', '', '・2025/12/30（二） 1 箱，850 元（已付清）', '', '共 1 箱，已知未付 0 元'].join('\n'),
    )
    expect(reconcileText(views, { type: 'month', month: '2026-01' }, TODAY)).toContain('・1/2（五） 1 箱，850 元')
  })

  test('不含下單用語', () => {
    const views = buildOrderViews([order({ delivery_on: '2026-10-08' })], [], [], TODAY)
    expect(reconcileText(views, { type: 'unsettled' }, TODAY)).not.toMatch(/麻煩|送蛋$|請送/)
  })
})

describe('每月統計', () => {
  const sale = (sale_date: string, mode: DailySale['mode'], income: number | null): DailySale => ({
    id: sale_date, ledger_id: 'L', sale_date, mode, income, egg_count: null, unit_price: null, recorded_by: 'm', version: 1,
  })

  test('進貨依送蛋日、收入依販售日、付款依付款日；預訂另列', () => {
    const a = order({ delivery_on: '2026-10-02', boxes: 2 }) // 1700
    const b = order({ delivery_on: '2026-09-30', ordered_on: '2026-09-29' }) // 9 月
    const c = order({ delivery_on: '2026-10-20' }) // 預訂
    const views = buildOrderViews([a, b, c], [payment('p1', '2026-10-01')], [alloc('p1', b.id, 850)], TODAY)
    const s = monthStats('2026-10', views, [payment('p1', '2026-10-01')], [alloc('p1', b.id, 850)],
      [sale('2026-10-01', 'income', 3000), sale('2026-10-02', 'rest', null), sale('2026-09-30', 'income', 999)], TODAY)
    expect(s).toMatchObject({
      boxes: 2, knownCost: 1700, unpricedCount: 0, income: 3000, diff: 1300, paidToVendor: 850,
      recordedDays: 2, restDays: 1, fixedRestDays: 2, elapsedDays: 12, missingDays: 8, future: { count: 1, boxes: 1 },
    })
  })

  test('價格未齊時不顯示完整差額', () => {
    const views = buildOrderViews([order({ delivery_on: '2026-10-02', price_per_box: null })], [], [], TODAY)
    const s = monthStats('2026-10', views, [], [], [], TODAY)
    expect(s.diff).toBeNull()
    expect(s.unpricedCount).toBe(1)
  })

  test('過去月份以整月計算未記錄天數', () => {
    const s = monthStats('2026-09', [], [], [], [], TODAY)
    // 2026 年 9 月有 4 個星期一（7、14、21、28 日）固定休息
    expect(s.fixedRestDays).toBe(4)
    expect(s.missingDays).toBe(26)
  })

  test('星期一有登記就照登記算，不當固定休息', () => {
    const s = monthStats('2026-10', [], [], [], [sale('2026-10-05', 'income', 500)], TODAY)
    expect(s).toMatchObject({ income: 500, recordedDays: 1, fixedRestDays: 1, missingDays: 10 })
  })
})
