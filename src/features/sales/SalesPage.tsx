import { useEffect, useMemo, useState } from 'react'
import { useLedger } from '../data/store'
import { Choice, ErrorNote, Sheet, useSubmit, useToast } from '../../ui/kit'
import { formatDay, formatMonth, monthOf, parseYmd, shiftMonth, weekday } from '../../lib/dates'
import { formatMoney, parseAmount } from '../../lib/money'
import { isFixedRestDay, monthDays, saleIncome } from '../../lib/ledger'
import type { DailySale, SaleMode } from '../../lib/types'

const WD = ['日', '一', '二', '三', '四', '五', '六']
const WD_INDEX: Record<string, number> = Object.fromEntries(WD.map((w, i) => [w, i]))

export function SalesPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { data, today, online, actions } = useLedger()
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null) // 日期
  const [restMode, setRestMode] = useState(false) // 按「今天休息」打開時預選休息
  const [priceOpen, setPriceOpen] = useState(false)

  const byDate = useMemo(() => new Map(data.sales.map((s) => [s.sale_date, s])), [data.sales])
  const todaySale = byDate.get(today)
  const days = monthDays(month)
  const lead = WD_INDEX[weekday(days[0])]
  const monthSales = data.sales.filter((s) => monthOf(s.sale_date) === month)
  const monthIncome = monthSales.reduce((s, x) => s + saleIncome(x), 0)

  return (
    <>
      <section className="summary" aria-label="今天">
        <div className="label">今天 {formatDay(today, today)}</div>
        <div className="big" style={{ fontSize: 26 }}>
          {todaySale
            ? todaySale.mode === 'rest'
              ? '休息'
              : formatMoney(saleIncome(todaySale))
            : isFixedRestDay(today)
              ? '週一固定休息'
              : '還沒登記'}
        </div>
        {todaySale?.mode === 'count' && (
          <div className="chips">
            <span className="chip">
              {todaySale.egg_count} 顆 × {todaySale.unit_price} 元
            </span>
          </div>
        )}
      </section>
      <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={() => setEditing(today)}>
        {todaySale ? '修改今天的紀錄' : '登記當日賣出'}
      </button>
      {!todaySale && !isFixedRestDay(today) && (
        <button
          type="button"
          className="btn secondary block"
          style={{ marginTop: 8 }}
          onClick={() => {
            setRestMode(true)
            setEditing(today)
          }}
        >
          今天休息
        </button>
      )}

      <div className="month-nav">
        <button type="button" aria-label="上個月" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <strong>{formatMonth(month)}</strong>
        <button type="button" aria-label="下個月" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= monthOf(today)}>
          ›
        </button>
      </div>
      <p className="note" style={{ marginTop: 0 }}>
        本月已登記收入 {formatMoney(monthIncome)}。點日期可補登、修改或改成休息；琥珀色是還沒記錄的日子，星期一固定休息。
      </p>
      <div className="cal" role="grid" aria-label={`${formatMonth(month)}日期表`}>
        {WD.map((w) => (
          <div key={w} className="wd" role="columnheader">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`b${i}`} />
        ))}
        {days.map((d) => {
          const s = byDate.get(d)
          const future = d > today
          const fixedRest = !s && isFixedRestDay(d)
          const cls = [s?.mode === 'rest' || fixedRest ? 'rest' : '', !s && !future && !fixedRest ? 'missing' : '', d === today ? 'today' : '']
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={d}
              type="button"
              className={cls}
              disabled={future}
              onClick={() => setEditing(d)}
              aria-label={`${formatDay(d, today)}${s ? (s.mode === 'rest' ? ' 休息' : ` 收入 ${saleIncome(s)} 元`) : fixedRest ? ' 固定休息' : future ? '' : ' 未記錄'}`}
            >
              <span className="d">{parseYmd(d).d}</span>
              <span className="s">{s ? (s.mode === 'rest' ? '休' : saleIncome(s).toLocaleString('en-US')) : fixedRest ? '休' : ''}</span>
            </button>
          )
        })}
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="kv">
          <span>按顆數登記的預設售價</span>
          <span className="v">
            每顆 {data.ledger.egg_unit_price} 元{' '}
            <button type="button" className="link-btn" onClick={() => setPriceOpen(true)} disabled={!online}>
              修改
            </button>
          </span>
        </div>
        <p className="note">改價只影響之後的登記，已登記的紀錄保留當時的售價。</p>
      </section>

      {editing && (
        <SaleForm
          date={editing}
          existing={byDate.get(editing) ?? null}
          initialMode={restMode ? 'rest' : undefined}
          onClose={() => {
            setEditing(null)
            setRestMode(false)
          }}
        />
      )}
      {priceOpen && (
        <UnitPriceForm
          current={data.ledger.egg_unit_price}
          onClose={() => setPriceOpen(false)}
          onSave={async (p) => {
            await actions.updateUnitPrice(p)
            toast({ text: `預設售價改為每顆 ${p} 元` })
          }}
        />
      )}
    </>
  )
}

function SaleForm({
  date,
  existing: live,
  initialMode,
  onClose,
}: {
  date: string
  existing: DailySale | null
  initialMode?: SaleMode
  onClose: () => void
}) {
  const { data, today, online, actions } = useLedger()
  // 以打開表單當下的紀錄為準；對方先存過會出現衝突提示，再按一次儲存才會覆蓋
  const [existing, setExisting] = useState(live)
  const toast = useToast()
  const [saleDate, setSaleDate] = useState(date)
  const [mode, setMode] = useState<SaleMode>(existing?.mode ?? initialMode ?? 'income')
  const [incomeText, setIncomeText] = useState(existing?.mode === 'income' ? String(existing.income) : '')
  const [countText, setCountText] = useState(existing?.egg_count != null ? String(existing.egg_count) : '')
  const [priceText, setPriceText] = useState(String(existing?.unit_price ?? data.ledger.egg_unit_price))
  const [recordedBy, setRecordedBy] = useState(existing?.recorded_by ?? data.me.id)
  const { busy, error, submit } = useSubmit()
  useEffect(() => {
    if (error?.kind === 'conflict') setExisting(live)
  }, [error, live])

  // 改到另一個已有紀錄的日期：那天已經有一筆，不能重複
  const other = data.sales.find((s) => s.sale_date === saleDate && s.id !== existing?.id)
  const income = parseAmount(incomeText)
  const count = parseAmount(countText)
  const price = parseAmount(priceText)
  const dateValid = Boolean(saleDate) && saleDate <= today && !other
  const incomeCountOptional = mode === 'income' ? (countText === '' ? null : count) : null
  const valid =
    dateValid &&
    (mode === 'rest' ||
      (mode === 'income' && typeof income === 'number' && incomeCountOptional !== undefined) ||
      (mode === 'count' && typeof count === 'number' && typeof price === 'number' && price > 0))

  async function save() {
    const input = {
      sale_date: saleDate,
      mode,
      income: mode === 'income' ? (income as number) : mode === 'count' ? (count as number) * (price as number) : null,
      egg_count: mode === 'count' ? (count as number) : mode === 'income' ? (incomeCountOptional as number | null) : null,
      unit_price: mode === 'count' ? (price as number) : null,
      recorded_by: recordedBy,
    }
    const ok = await submit(() => actions.saveSale(existing, input))
    if (ok) {
      toast({ text: existing ? '已修改這天的紀錄' : '已登記' })
      onClose()
    }
  }

  return (
    <Sheet title={existing ? `修改 ${formatDay(date, today)}` : `登記 ${formatDay(date, today)}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !busy) void save()
        }}
      >
        {existing && <p className="note">這天已有紀錄，儲存會修改它，不會重複累加。</p>}
        <label className="field">
          <span>日期</span>
          <input className={`input${dateValid ? '' : ' invalid'}`} type="date" max={today} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
          {saleDate > today && <p className="hint error">未來日期不能登記銷售</p>}
          {other && <p className="hint error">{formatDay(saleDate, today)}已經有紀錄，請回日期表點那天修改。</p>}
        </label>
        <div className="field">
          <span>記錄方式</span>
          <Choice
            label="記錄方式"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'income', label: '填收入' },
              { value: 'count', label: '填顆數' },
              { value: 'rest', label: '休息' },
            ]}
          />
        </div>

        {mode === 'income' && (
          <>
            <label className="field">
              <span>當日收入（元）</span>
              <input className="input" inputMode="numeric" pattern="[0-9]*" value={incomeText} onChange={(e) => setIncomeText(e.target.value)} />
              {income === undefined && <p className="hint error">請填整數金額</p>}
            </label>
            <label className="field">
              <span>賣出顆數（不知道可空白）</span>
              <input className="input" inputMode="numeric" pattern="[0-9]*" value={countText} onChange={(e) => setCountText(e.target.value)} />
              {countText !== '' && count === undefined && <p className="hint error">請填整數</p>}
            </label>
          </>
        )}
        {mode === 'count' && (
          <div className="two">
            <label className="field">
              <span>賣出顆數</span>
              <input className="input" inputMode="numeric" pattern="[0-9]*" value={countText} onChange={(e) => setCountText(e.target.value)} />
            </label>
            <label className="field">
              <span>這次每顆售價</span>
              <input className="input" inputMode="numeric" pattern="[0-9]*" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
            </label>
          </div>
        )}
        {mode === 'count' && typeof count === 'number' && typeof price === 'number' && (
          <p className="hint">收入 {formatMoney(count * price)}</p>
        )}
        {mode === 'rest' && <p className="note">這天標記為休息，不計收入。</p>}

        <div className="field">
          <span>登記人</span>
          <Choice
            label="登記人"
            value={recordedBy}
            onChange={setRecordedBy}
            options={data.members.map((m) => ({ value: m.id, label: m.display_name }))}
          />
        </div>
        <ErrorNote error={error} />
        {!online && <p className="hint error">目前離線，無法儲存</p>}
        <button type="submit" className="btn primary block" disabled={!valid || busy || !online}>
          {busy ? '儲存中…' : '儲存'}
        </button>
      </form>
    </Sheet>
  )
}

function UnitPriceForm({ current, onClose, onSave }: { current: number; onClose: () => void; onSave: (p: number) => Promise<void> }) {
  const [text, setText] = useState(String(current))
  const { busy, error, submit } = useSubmit()
  const p = parseAmount(text)
  const valid = typeof p === 'number' && p > 0
  return (
    <Sheet title="預設每顆售價" onClose={onClose} dialog>
      <label className="field">
        <span>每顆（元）</span>
        <input className="input" inputMode="numeric" pattern="[0-9]*" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
      <p className="note">已登記的紀錄不會被改動。</p>
      <ErrorNote error={error} />
      <div className="row-btns">
        <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!valid || busy}
          onClick={async () => {
            if (await submit(() => onSave(p as number))) onClose()
          }}
        >
          {busy ? '儲存中…' : '儲存'}
        </button>
      </div>
    </Sheet>
  )
}
