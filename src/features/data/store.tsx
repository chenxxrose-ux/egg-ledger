import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { ConflictError, toAppError } from './errors'
import type { Allocation, AuditEntry, DailySale, EggOrder, Ledger, Member, Payment, SaleMode } from '../../lib/types'
import { taipeiToday } from '../../lib/dates'

export type LedgerData = {
  ledger: Ledger
  members: Member[]
  me: Member
  orders: EggOrder[]
  payments: Payment[]
  allocations: Allocation[]
  sales: DailySale[]
  audit: AuditEntry[]
  auditHasMore: boolean
  loadedAt: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'no-ledger' }
  | { status: 'error'; message: string; cached: LedgerData | null }
  | { status: 'ready'; data: LedgerData; stale: boolean }

export type OrderInput = {
  ordered_on: string
  delivery_on: string
  boxes: number
  price_per_box: number | null
  ordered_by: string
}

export type SaleInput = {
  sale_date: string
  mode: SaleMode
  income: number | null
  egg_count: number | null
  unit_price: number | null
  recorded_by: string
}

const AUDIT_PAGE = 100
const CACHE_KEY = 'egg-ledger-cache-v1'

function readCache(userId: string): LedgerData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId: string; data: LedgerData }
    return parsed.userId === userId ? parsed.data : null
  } catch {
    return null
  }
}

function writeCache(userId: string, data: LedgerData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, data }))
  } catch {
    /* 無痕模式等情況存不了，不影響使用 */
  }
}

async function must<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}

async function fetchAll(userId: string, auditLimit: number): Promise<LedgerData | null> {
  const mine = await must(supabase.from('ledger_members').select('*').eq('user_id', userId).maybeSingle())
  if (!mine) return null
  const ledgerId = (mine as Member & { ledger_id: string }).ledger_id
  const [ledger, members, orders, payments, allocations, sales, audit] = await Promise.all([
    must(supabase.from('ledgers').select('id,name,egg_unit_price,version').eq('id', ledgerId).single()),
    must(supabase.from('ledger_members').select('id,user_id,display_name,sort').eq('ledger_id', ledgerId).order('sort')),
    must(supabase.from('egg_orders').select('*').eq('ledger_id', ledgerId)),
    must(supabase.from('payments').select('*').eq('ledger_id', ledgerId)),
    must(supabase.from('payment_allocations').select('*').eq('ledger_id', ledgerId)),
    must(supabase.from('daily_sales').select('*').eq('ledger_id', ledgerId)),
    must(
      supabase
        .from('audit_log')
        .select('*')
        .eq('ledger_id', ledgerId)
        .order('id', { ascending: false })
        .limit(auditLimit + 1),
    ),
  ])
  const auditRows = audit as AuditEntry[]
  return {
    ledger: ledger as unknown as Ledger,
    members: members as Member[],
    me: (members as Member[]).find((m) => m.user_id === userId)!,
    orders: orders as EggOrder[],
    payments: payments as Payment[],
    allocations: allocations as Allocation[],
    sales: sales as DailySale[],
    audit: auditRows.slice(0, auditLimit),
    auditHasMore: auditRows.length > auditLimit,
    loadedAt: new Date().toISOString(),
  }
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function useLedgerStore(session: Session) {
  const userId = session.user.id
  const [state, setState] = useState<LoadState>(() => {
    const cached = readCache(userId)
    return cached ? { status: 'ready', data: cached, stale: true } : { status: 'loading' }
  })
  const [today, setToday] = useState(taipeiToday())
  const online = useOnline()
  const auditLimit = useRef(AUDIT_PAGE)
  const loadSeq = useRef(0)

  const refresh = useCallback(async () => {
    const seq = ++loadSeq.current
    setToday(taipeiToday())
    try {
      const data = await fetchAll(userId, auditLimit.current)
      if (seq !== loadSeq.current) return
      if (!data) {
        setState({ status: 'no-ledger' })
        return
      }
      writeCache(userId, data)
      setState({ status: 'ready', data, stale: false })
    } catch (err) {
      if (seq !== loadSeq.current) return
      const message = toAppError(err).message.replace('資料沒有儲存', '無法載入最新資料')
      setState((prev) => {
        const cached = prev.status === 'ready' ? prev.data : prev.status === 'error' ? prev.cached : readCache(userId)
        return cached ? { status: 'ready', data: cached, stale: true } : { status: 'error', message, cached: null }
      })
    }
  }, [userId])

  // 初次載入、回到前景、恢復連線時重新整理
  useEffect(() => {
    void refresh()
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refresh)
    }
  }, [refresh])

  // 即時同步：另一支手機有變動就重新載入
  const ledgerId = state.status === 'ready' ? state.data.ledger.id : null
  useEffect(() => {
    if (!ledgerId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 300)
    }
    const channel = supabase.channel(`ledger-${ledgerId}`)
    for (const table of ['egg_orders', 'payments', 'payment_allocations', 'daily_sales', 'ledgers', 'audit_log']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
    }
    channel.subscribe()
    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [ledgerId, refresh])

  const data = state.status === 'ready' ? state.data : null

  // 所有寫入：成功後重新載入；失敗丟出 AppError，呼叫端保留使用者輸入
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      if (!navigator.onLine) throw toAppError(new Error('offline'))
      try {
        const r = await fn()
        await refresh()
        return r
      } catch (err) {
        const e = toAppError(err)
        if (e.kind === 'conflict') await refresh()
        throw e
      }
    },
    [refresh],
  )

  const requireData = () => {
    if (!data) throw new Error('資料尚未載入')
    return data
  }

  /** 以版本號更新，沒更新到任何一列代表對方已改過 */
  const versionedUpdate = useCallback(
    async (table: string, id: string, version: number, patch: Record<string, unknown>) => {
      const rows = await must(supabase.from(table).update(patch).eq('id', id).eq('version', version).select('id'))
      if (!rows || (rows as unknown[]).length === 0) throw new ConflictError()
    },
    [],
  )

  const actions = useMemo(
    () => ({
      refresh,
      async loadMoreAudit() {
        auditLimit.current += AUDIT_PAGE
        await refresh()
      },
      createOrder: (input: OrderInput, requestId: string) =>
        run(async () => {
          const d = requireData()
          const { error } = await supabase
            .from('egg_orders')
            .insert({ ...input, ledger_id: d.ledger.id, client_request_id: requestId })
          // 連按送出第二次會撞到同一個請求編號：視為已成功
          if (error && !(error.code === '23505' && /client_request_id/.test(error.message))) throw error
        }),
      updateOrder: (o: EggOrder, patch: Partial<OrderInput>) =>
        run(() => versionedUpdate('egg_orders', o.id, o.version, patch)),
      voidOrder: (o: EggOrder) =>
        run(async () => {
          await must(supabase.rpc('void_order', { p_order: o.id, p_expected_version: o.version }))
        }),
      restoreOrder: (orderId: string) =>
        run(async () => {
          await must(supabase.rpc('restore_order', { p_order: orderId }))
        }),
      recordPayment: (
        p: { paid_on: string; payer: string; allocations: { order_id: string; amount: number }[] },
        requestId: string,
      ) =>
        run(async () => {
          const d = requireData()
          return must<string>(
            supabase.rpc('record_payment', {
              p_ledger: d.ledger.id,
              p_paid_on: p.paid_on,
              p_payer: p.payer,
              p_allocations: p.allocations,
              p_client_request_id: requestId,
            }),
          )
        }),
      voidPayment: (paymentId: string, version: number | null) =>
        run(async () => {
          await must(supabase.rpc('void_payment', { p_payment: paymentId, p_expected_version: version }))
        }),
      revertOrderPayments: (o: EggOrder) =>
        run(async () => {
          await must(supabase.rpc('revert_order_payments', { p_order: o.id, p_expected_version: o.version }))
        }),
      correctPayment: (
        p: Payment,
        patch: { paid_on: string; payer: string },
        allocationChanges: { allocation: Allocation; amount: number }[],
      ) =>
        run(async () => {
          if (patch.paid_on !== p.paid_on || patch.payer !== p.payer) {
            await versionedUpdate('payments', p.id, p.version, patch)
          }
          for (const c of allocationChanges) {
            await versionedUpdate('payment_allocations', c.allocation.id, c.allocation.version, { amount: c.amount })
          }
        }),
      saveSale: (existing: DailySale | null, input: SaleInput) =>
        run(async () => {
          const d = requireData()
          if (existing) {
            await versionedUpdate('daily_sales', existing.id, existing.version, { ...input })
          } else {
            const { error } = await supabase.from('daily_sales').insert({ ...input, ledger_id: d.ledger.id })
            if (error) throw error
          }
        }),
      updateUnitPrice: (price: number) =>
        run(async () => {
          const d = requireData()
          await versionedUpdate('ledgers', d.ledger.id, d.ledger.version, { egg_unit_price: price })
        }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh, run, versionedUpdate, data],
  )

  return { state, today, online, actions }
}

type Store = ReturnType<typeof useLedgerStore>
const StoreContext = createContext<Store | null>(null)

export function LedgerProvider({ session, children }: { session: Session; children: ReactNode }) {
  const store = useLedgerStore(session)
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore outside provider')
  return s
}

/** 只在資料已載入的頁面使用 */
export function useLedger() {
  const s = useStore()
  if (s.state.status !== 'ready') throw new Error('ledger not ready')
  return { data: s.state.data, stale: s.state.stale, today: s.today, online: s.online, actions: s.actions }
}
