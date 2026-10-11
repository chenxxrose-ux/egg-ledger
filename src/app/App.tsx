import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from '../features/data/supabase'
import { LedgerProvider, useStore } from '../features/data/store'
import { Login } from '../features/auth/Login'
import { AccountSheet } from '../features/auth/AccountSheet'
import { takeOfferPasskey } from '../features/auth/passkey'
import { OrdersPage } from '../features/orders/OrdersPage'
import { SalesPage } from '../features/sales/SalesPage'
import { StatsPage } from '../features/stats/StatsPage'
import { ToastProvider } from '../ui/kit'
import { formatTaipeiTime, monthOf, taipeiToday } from '../lib/dates'

type Tab = 'orders' | 'sales' | 'stats'
const TABS: { key: Tab; label: string }[] = [
  { key: 'orders', label: '叫蛋' },
  { key: 'sales', label: '賣蛋' },
  { key: 'stats', label: '統計' },
]

function readTab(): Tab {
  const h = location.hash.replace('#', '')
  return h === 'sales' || h === 'stats' ? h : 'orders'
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!configured) {
    return (
      <main className="login">
        <h1>叫蛋記帳</h1>
        <div className="banner error">網站尚未設定資料庫連線（VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY）。</div>
      </main>
    )
  }
  if (session === undefined) return <p className="loading">載入中…</p>
  if (!session) return <ToastProvider><Login /></ToastProvider>

  return (
    <ToastProvider>
      <LedgerProvider key={session.user.id} session={session}>
        <Shell />
      </LedgerProvider>
    </ToastProvider>
  )
}

function Shell() {
  const { state, online, actions } = useStore()
  const [tab, setTabState] = useState<Tab>(readTab)
  const [month, setMonth] = useState(monthOf(taipeiToday()))
  const [account, setAccount] = useState<null | 'menu' | 'offer'>(() => (takeOfferPasskey() ? 'offer' : null))

  useEffect(() => {
    const onHash = () => setTabState(readTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setTab = (t: Tab) => {
    location.hash = t === 'orders' ? '' : t
    setTabState(t)
    window.scrollTo(0, 0)
  }

  const me = state.status === 'ready' ? state.data.me.display_name : ''

  return (
    <div className="app">
      <header className="topbar">
        <h1>{tab === 'orders' ? '叫蛋紀錄' : tab === 'sales' ? '賣蛋紀錄' : '每月統計'}</h1>
        <button
          type="button"
          className="who"
          onClick={() => setAccount('menu')}
        >
          {me || '帳號'}
        </button>
      </header>

      {!online && (
        <div className="banner warn" role="status">
          目前離線。畫面是最後載入的資料，恢復連線前無法儲存。
        </div>
      )}
      {online && state.status === 'ready' && state.stale && (
        <div className="banner warn" role="status">
          無法取得最新資料，顯示的是 {formatTaipeiTime(state.data.loadedAt)} 的內容。{' '}
          <button type="button" className="link-btn" onClick={() => void actions.refresh()}>
            重試
          </button>
        </div>
      )}

      {state.status === 'loading' && <p className="loading">載入中…</p>}
      {state.status === 'error' && (
        <div className="banner error" role="alert">
          載入失敗：{state.message}{' '}
          <button type="button" className="link-btn" onClick={() => void actions.refresh()}>
            重試
          </button>
        </div>
      )}
      {state.status === 'no-ledger' && (
        <div className="banner error">這個帳號還沒加入帳本，請依部署說明把帳號加入成員。</div>
      )}
      {state.status === 'ready' && (
        <main>
          {tab === 'orders' && <OrdersPage />}
          {tab === 'sales' && <SalesPage month={month} setMonth={setMonth} />}
          {tab === 'stats' && <StatsPage month={month} setMonth={setMonth} goFillDays={() => setTab('sales')} />}
        </main>
      )}

      {account && <AccountSheet me={me} offer={account === 'offer'} onClose={() => setAccount(null)} />}

      <div className="tabbar">
        <nav aria-label="主選單">
          {TABS.map((t) => (
            <button key={t.key} type="button" aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
