import { useEffect, useState } from 'react'
import { Choice, ErrorNote, Sheet, newRequestId, useSubmit, useToast } from '../../ui/kit'
import { useLedger } from '../data/store'
import { addDays } from '../../lib/dates'
import { formatMoney, parseAmount } from '../../lib/money'
import type { OrderView } from '../../lib/ledger'

/** 新增或修改一筆叫蛋。修改時顯示改後的差額，但不會動到已付款金額。 */
export function OrderForm({ view, onClose }: { view?: OrderView; onClose: () => void }) {
  const { data, today, online, actions } = useLedger()
  const toast = useToast()
  const o = view?.order
  const [orderedOn, setOrderedOn] = useState(o?.ordered_on ?? today)
  const [deliveryOn, setDeliveryOn] = useState(o?.delivery_on ?? addDays(today, 1))
  const [boxesText, setBoxesText] = useState(String(o?.boxes ?? 1))
  const [priceText, setPriceText] = useState(o?.price_per_box == null ? '' : String(o.price_per_box))
  const [orderedBy, setOrderedBy] = useState(o?.ordered_by ?? data.me.id)
  const [requestId] = useState(newRequestId)
  const { busy, error, submit } = useSubmit()
  // 以打開表單當下的版本儲存；對方先改過就會被擋下（衝突），不會直接覆蓋
  const [baseVersion, setBaseVersion] = useState(o?.version ?? 0)
  useEffect(() => {
    if (error?.kind === 'conflict' && o) setBaseVersion(o.version)
  }, [error, o])

  const boxes = Number(boxesText)
  const boxesValid = /^\d+$/.test(boxesText) && boxes >= 1 && boxes <= 999
  const price = parseAmount(priceText)
  const priceValid = price !== undefined
  const datesValid = Boolean(orderedOn && deliveryOn) && deliveryOn >= orderedOn
  const valid = boxesValid && priceValid && datesValid

  const newTotal = boxesValid && price != null ? price * boxes : null
  const paid = view?.paid ?? 0

  async function save() {
    const input = {
      ordered_on: orderedOn,
      delivery_on: deliveryOn,
      boxes,
      price_per_box: price ?? null,
      ordered_by: orderedBy,
    }
    const ok = await submit(async () => {
      if (o) await actions.updateOrder({ ...o, version: baseVersion }, input)
      else await actions.createOrder(input, requestId)
    })
    if (ok) {
      toast({ text: o ? '已儲存修改' : '已記下這筆叫蛋' })
      onClose()
    }
  }

  async function voidIt() {
    if (!o) return
    if (!window.confirm('確定作廢這筆叫蛋嗎？作廢後不會計入帳目，紀錄會保留。')) return
    const ok = await submit(() => actions.voidOrder(o))
    if (ok) {
      toast({ text: '已作廢這筆叫蛋', action: { label: '復原', run: () => actions.restoreOrder(o.id) } })
      onClose()
    }
  }

  return (
    <Sheet title={o ? '修改叫蛋' : '記一筆叫蛋'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !busy) void save()
        }}
      >
        <div className="two">
          <label className="field">
            <span>叫蛋日期</span>
            <input className="input" type="date" value={orderedOn} onChange={(e) => setOrderedOn(e.target.value)} required />
          </label>
          <label className="field">
            <span>送蛋日期</span>
            <input
              className={`input${datesValid ? '' : ' invalid'}`}
              type="date"
              value={deliveryOn}
              onChange={(e) => setDeliveryOn(e.target.value)}
              required
            />
          </label>
        </div>
        {!datesValid && <p className="hint error">送蛋日期不能早於叫蛋日期</p>}

        <div className="field">
          <span>箱數</span>
          <div className="stepper">
            <button type="button" aria-label="少一箱" onClick={() => setBoxesText(String(Math.max(1, (boxes || 1) - 1)))}>
              −
            </button>
            <input
              className={`input${boxesValid ? '' : ' invalid'}`}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="箱數"
              value={boxesText}
              onChange={(e) => setBoxesText(e.target.value.trim())}
            />
            <button type="button" aria-label="多一箱" onClick={() => setBoxesText(String(Math.min(999, (boxes || 0) + 1)))}>
              +
            </button>
          </div>
          {!boxesValid && <p className="hint error">箱數請填 1 到 999</p>}
        </div>

        <label className="field">
          <span>每箱價格（元，不知道可以先空白）</span>
          <input
            className={`input${priceValid ? '' : ' invalid'}`}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="價格待確認"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
          />
          {!priceValid && <p className="hint error">請填整數金額</p>}
          {priceValid && price == null && <p className="hint warn">之後可以在首頁點「待補價格」補上</p>}
          {newTotal != null && boxes > 1 && <p className="hint">本筆總額 {formatMoney(newTotal)}</p>}
        </label>

        <div className="field">
          <span>叫蛋人</span>
          <Choice
            label="叫蛋人"
            value={orderedBy}
            onChange={setOrderedBy}
            options={data.members.map((m) => ({ value: m.id, label: m.display_name }))}
          />
        </div>

        {o && paid > 0 && (
          <div className="card" aria-live="polite">
            <div className="kv">
              <span>實際已付（不會自動改）</span>
              <span className="v">{formatMoney(paid)}</span>
            </div>
            <div className="kv">
              <span>修改後本筆總額</span>
              <span className="v">{newTotal == null ? '價格待確認' : formatMoney(newTotal)}</span>
            </div>
            {newTotal != null && (
              <div className="kv">
                <span>{paid > newTotal ? '多付' : '尚欠'}</span>
                <span className={`v${paid > newTotal ? ' danger' : ''}`}>{formatMoney(Math.abs(newTotal - paid))}</span>
              </div>
            )}
          </div>
        )}

        <ErrorNote error={error} />
        {!online && <p className="hint error">目前離線，無法儲存</p>}
        <button className="btn primary block" type="submit" disabled={!valid || busy || !online} style={{ marginTop: 12 }}>
          {busy ? '儲存中…' : o ? '儲存修改' : '記下這筆'}
        </button>
        {o && (
          <p style={{ textAlign: 'center', marginTop: 12 }}>
            <button type="button" className="link-btn danger" onClick={voidIt} disabled={busy || !online}>
              記錯了，作廢這筆
            </button>
          </p>
        )}
      </form>
    </Sheet>
  )
}
