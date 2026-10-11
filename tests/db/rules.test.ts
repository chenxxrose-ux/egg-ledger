import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDb, LEDGER, MEMBER, USERS } from './harness'

let db: PGlite
beforeEach(async () => {
  db = await createDb()
})

const uuid = () => crypto.randomUUID()

async function addOrder(user: string, o: { delivery: string; boxes: number; price: number | null; ordered?: string }) {
  const rows = await as<{ id: string; version: number }>(
    db,
    user,
    `insert into public.egg_orders (ledger_id, ordered_on, delivery_on, boxes, price_per_box, ordered_by, client_request_id)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, version`,
    [LEDGER, o.ordered ?? o.delivery, o.delivery, o.boxes, o.price, MEMBER.berry, uuid()],
  )
  return rows[0]
}

async function pay(user: string, allocations: { order_id: string; amount: number }[], requestId = uuid(), paidOn = '2026-01-05') {
  const rows = await as<{ id: string }>(db, user, `select public.record_payment($1, $2, $3, $4::jsonb, $5) as id`, [
    LEDGER,
    paidOn,
    MEMBER.bao,
    JSON.stringify(allocations),
    requestId,
  ])
  return rows[0].id
}

async function paidFor(orderId: string) {
  const r = await db.query<{ paid: number }>(
    `select coalesce(sum(a.amount),0)::int as paid from public.payment_allocations a join public.payments p on p.id = a.payment_id
     where a.order_id = $1 and a.voided_at is null and p.voided_at is null`,
    [orderId],
  )
  return r.rows[0].paid
}

describe('權限', () => {
  test('非成員看不到也寫不進帳本', async () => {
    await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: 800 })
    expect(await as(db, USERS.stranger, 'select * from public.egg_orders')).toHaveLength(0)
    await expect(addOrder(USERS.stranger, { delivery: '2026-01-02', boxes: 1, price: 800 })).rejects.toThrow()
  })

  test('操作人取自登入帳號並寫入修改紀錄', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: 800 })
    const [row] = await as<{ created_by: string }>(db, USERS.berry, 'select created_by from public.egg_orders where id=$1', [o.id])
    expect(row.created_by).toBe(USERS.bao)
    const audit = await as<{ actor: string; actor_name: string; action: string }>(db, USERS.berry, "select actor, actor_name, action from public.audit_log where entity='egg_orders'")
    expect(audit).toEqual([{ actor: USERS.bao, actor_name: '阿寶', action: 'create' }])
  })

  test('前端無法指定建立者', async () => {
    await expect(
      as(db, USERS.bao, `insert into public.egg_orders (ledger_id, ordered_on, delivery_on, boxes, ordered_by, client_request_id, created_by)
        values ($1,'2026-01-01','2026-01-02',1,$2,$3,$4)`, [LEDGER, MEMBER.bao, uuid(), USERS.berry]),
    ).rejects.toThrow(/permission denied/)
  })

  test('一般使用者不能刪除帳務或修改紀錄', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: 800 })
    await expect(as(db, USERS.bao, 'delete from public.egg_orders where id=$1', [o.id])).rejects.toThrow(/permission denied/)
    await expect(as(db, USERS.bao, 'delete from public.audit_log')).rejects.toThrow(/permission denied/)
    await expect(as(db, USERS.bao, `update public.audit_log set actor_name='x'`)).rejects.toThrow(/permission denied/)
    await expect(
      as(db, USERS.bao, `insert into public.audit_log (ledger_id, actor_name, action, entity) values ($1,'阿寶','x','y')`, [LEDGER]),
    ).rejects.toThrow(/permission denied/)
    await expect(db.query('delete from public.audit_log')).rejects.toThrow(/不能刪除/)
  })

  test('不能直接新增付款，必須透過付款函式', async () => {
    await expect(
      as(db, USERS.bao, `insert into public.payments (ledger_id, paid_on, payer, client_request_id) values ($1,'2026-01-01',$2,$3)`, [LEDGER, MEMBER.bao, uuid()]),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('同時修改', () => {
  test('版本不符時不覆蓋', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: null })
    const first = await as(db, USERS.bao, 'update public.egg_orders set price_per_box=800 where id=$1 and version=$2 returning version', [o.id, o.version])
    expect(first).toEqual([{ version: 2 }])
    // 草莓手上仍是版本 1
    const second = await as(db, USERS.berry, 'update public.egg_orders set price_per_box=900 where id=$1 and version=$2 returning version', [o.id, o.version])
    expect(second).toEqual([])
    const [row] = await as<{ price_per_box: number }>(db, USERS.bao, 'select price_per_box from public.egg_orders where id=$1', [o.id])
    expect(row.price_per_box).toBe(800)
  })
})

describe('付款', () => {
  test('部分付款、超付被擋、重複送出只記一次', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 2, price: 850 })
    const req = uuid()
    const p1 = await pay(USERS.bao, [{ order_id: o.id, amount: 1000 }], req)
    const p1again = await pay(USERS.bao, [{ order_id: o.id, amount: 1000 }], req)
    expect(p1again).toBe(p1)
    expect(await paidFor(o.id)).toBe(1000)
    await expect(pay(USERS.berry, [{ order_id: o.id, amount: 701 }])).rejects.toThrow(/超過/)
    await pay(USERS.berry, [{ order_id: o.id, amount: 700 }])
    expect(await paidFor(o.id)).toBe(1700)
    const audit = await as<{ action: string; actor_name: string }>(db, USERS.bao, `select action, actor_name from public.audit_log where entity='payments' order by id`)
    expect(audit).toEqual([
      { action: 'pay', actor_name: '阿寶' },
      { action: 'pay', actor_name: '草莓' },
    ])
  })

  test('價格未知不能付款', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: null })
    await expect(pay(USERS.bao, [{ order_id: o.id, amount: 100 }])).rejects.toThrow(/還沒有價格/)
  })

  test('未來付款日期被擋', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: 800 })
    await expect(pay(USERS.bao, [{ order_id: o.id, amount: 100 }], uuid(), '2999-01-01')).rejects.toThrow(/未來/)
  })

  test('改價後保留實際已付金額', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 2, price: 850 })
    await pay(USERS.bao, [{ order_id: o.id, amount: 1700 }])
    await as(db, USERS.berry, 'update public.egg_orders set price_per_box=800 where id=$1', [o.id])
    expect(await paidFor(o.id)).toBe(1700) // 多付 100，付款不被改寫
  })

  test('復原付款保留歷史', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: 800 })
    const p = await pay(USERS.bao, [{ order_id: o.id, amount: 800 }])
    await as(db, USERS.berry, 'select public.void_payment($1, 1)', [p])
    expect(await paidFor(o.id)).toBe(0)
    await expect(as(db, USERS.berry, 'select public.void_payment($1, null)', [p])).rejects.toThrow(/已經復原/)
    const [row] = await db.query<{ n: number }>('select count(*)::int as n from public.payments').then((r) => r.rows)
    expect(row.n).toBe(1)
    const actions = await as<{ action: string }>(db, USERS.bao, `select action from public.audit_log where entity='payments' order by id`)
    expect(actions.map((a) => a.action)).toEqual(['pay', 'void_payment'])
  })

  test('多筆結帳後把其中一筆改回未付款', async () => {
    const a = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: 800 })
    const b = await addOrder(USERS.bao, { delivery: '2026-01-03', boxes: 1, price: 900 })
    const p = await pay(USERS.bao, [
      { order_id: a.id, amount: 800 },
      { order_id: b.id, amount: 900 },
    ])
    await as(db, USERS.berry, 'select public.revert_order_payments($1, null)', [a.id])
    expect(await paidFor(a.id)).toBe(0)
    expect(await paidFor(b.id)).toBe(900)
    const [pr] = await db.query<{ voided_at: string | null }>('select voided_at from public.payments where id=$1', [p]).then((r) => r.rows)
    expect(pr.voided_at).toBeNull()
    await as(db, USERS.berry, 'select public.revert_order_payments($1, null)', [b.id])
    const [pr2] = await db.query<{ voided_at: string | null }>('select voided_at from public.payments where id=$1', [p]).then((r) => r.rows)
    expect(pr2.voided_at).not.toBeNull()
  })

  test('更正付款日期、付款人與金額', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: 800 })
    const p = await pay(USERS.bao, [{ order_id: o.id, amount: 800 }])
    await as(db, USERS.berry, `update public.payments set paid_on='2026-01-04', payer=$2 where id=$1 and version=1`, [p, MEMBER.berry])
    await as(db, USERS.berry, `update public.payment_allocations set amount=500 where payment_id=$1`, [p])
    expect(await paidFor(o.id)).toBe(500)
    const audit = await as<{ action: string; entity: string; actor_name: string }>(
      db, USERS.bao, `select action, entity, actor_name from public.audit_log where action='update' order by id`,
    )
    expect(audit).toEqual([
      { action: 'update', entity: 'payments', actor_name: '草莓' },
      { action: 'update', entity: 'payment_allocations', actor_name: '草莓' },
    ])
  })

  test('作廢叫蛋需先改回未付款，可復原', async () => {
    const o = await addOrder(USERS.bao, { delivery: '2026-01-02', boxes: 1, price: 800 })
    await pay(USERS.bao, [{ order_id: o.id, amount: 300 }])
    await expect(as(db, USERS.bao, 'select public.void_order($1, null)', [o.id])).rejects.toThrow(/先改回未付款/)
    await as(db, USERS.bao, 'select public.revert_order_payments($1, null)', [o.id])
    await as(db, USERS.bao, 'select public.void_order($1, null)', [o.id])
    await expect(as(db, USERS.bao, 'update public.egg_orders set boxes=3 where id=$1', [o.id])).rejects.toThrow(/已作廢/)
    await as(db, USERS.bao, 'select public.restore_order($1)', [o.id])
    const [row] = await as<{ voided_at: string | null }>(db, USERS.bao, 'select voided_at from public.egg_orders where id=$1', [o.id])
    expect(row.voided_at).toBeNull()
  })
})

describe('每日賣蛋', () => {
  const insertSale = (user: string, date: string, mode: string, income: number | null, count: number | null, price: number | null) =>
    as(db, user, `insert into public.daily_sales (ledger_id, sale_date, mode, income, egg_count, unit_price, recorded_by)
      values ($1,$2,$3,$4,$5,$6,$7) returning income, version`, [LEDGER, date, mode, income, count, price, MEMBER.berry])

  test('同一天只能一筆，按顆數由資料庫計算收入', async () => {
    const [r] = await insertSale(USERS.bao, '2026-01-02', 'count', 0, 100, 15)
    expect(r).toEqual({ income: 1500, version: 1 })
    await expect(insertSale(USERS.berry, '2026-01-02', 'income', 2000, null, null)).rejects.toThrow(/duplicate key|unique/)
    await as(db, USERS.berry, `update public.daily_sales set mode='income', income=2000, egg_count=null, unit_price=null where sale_date='2026-01-02' and version=1`)
    const rows = await as<{ income: number }>(db, USERS.bao, 'select income from public.daily_sales')
    expect(rows).toEqual([{ income: 2000 }])
  })

  test('未來日期不能登記', async () => {
    await expect(insertSale(USERS.bao, '2999-01-01', 'rest', null, null, null)).rejects.toThrow(/未來/)
  })

  test('休息與只記收入', async () => {
    await insertSale(USERS.bao, '2026-01-02', 'rest', null, null, null)
    await insertSale(USERS.bao, '2026-01-03', 'income', 3000, null, null)
    await expect(insertSale(USERS.bao, '2026-01-04', 'income', null, null, null)).rejects.toThrow()
  })
})
