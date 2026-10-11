import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { addDays, formatDay, monthOf, shiftMonth, taipeiToday, ymd, parseYmd } from '../src/lib/dates'

// 驗收流程：阿寶、草莓兩支手機同時操作同一本帳
const MOCK = 'http://localhost:54321'
const today = taipeiToday()
const tomorrow = addDays(today, 1)
const yesterday = addDays(today, -1)
const prevMonth = shiftMonth(monthOf(today), -1)
const prevMonthDay1 = `${prevMonth}-01`

test.describe.configure({ mode: 'serial' })

let bao: Page
let berry: Page
let baoCtx: BrowserContext
let berryCtx: BrowserContext

async function login(browser: Browser, email: string) {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('密碼').fill('test-password')
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await expect(page.getByRole('heading', { name: '叫蛋紀錄' })).toBeVisible()
  // 密碼登入後詢問一次要不要設定 Face ID
  await page.getByRole('dialog', { name: '下次用 Face ID 登入？' }).getByRole('button', { name: '以後再說' }).click()
  return { ctx, page }
}

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const r = await fetch(`${MOCK}/__test/sql`, { method: 'POST', body: JSON.stringify({ sql: query, params }) })
  return r.json()
}

const card = (page: Page, delivery: string, boxes: number) =>
  page.getByRole('article', { name: `${formatDay(delivery, today)}送 ${boxes} 箱` })

async function addOrder(page: Page, o: { ordered: string; delivery: string; boxes: number; price?: number }) {
  await page.getByRole('button', { name: '記一筆叫蛋' }).click()
  const sheet = page.getByRole('dialog', { name: '記一筆叫蛋' })
  await sheet.getByLabel('叫蛋日期').fill(o.ordered)
  await sheet.getByLabel('送蛋日期').fill(o.delivery)
  await sheet.getByLabel('箱數').fill(String(o.boxes))
  if (o.price != null) await sheet.getByLabel(/每箱價格/).fill(String(o.price))
  await sheet.getByRole('button', { name: '記下這筆' }).click()
  await expect(sheet).toBeHidden()
}

test.beforeAll(async ({ browser }) => {
  ;({ ctx: baoCtx, page: bao } = await login(browser, 'bao@test.local'))
  ;({ ctx: berryCtx, page: berry } = await login(browser, 'berry@test.local'))
})

test.afterAll(async () => {
  await baoCtx?.close()
  await berryCtx?.close()
})

test('Face ID 登入選項：登入頁有按鈕，詢問只出現一次，帳號選單可設定與登出', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.getByRole('button', { name: '用 Face ID 登入' })).toBeVisible()
  await page.getByLabel('Email').fill('bao@test.local')
  await page.getByLabel('密碼').fill('test-password')
  await page.getByRole('button', { name: '登入', exact: true }).click()
  const offer = page.getByRole('dialog', { name: '下次用 Face ID 登入？' })
  await expect(offer).toBeVisible()
  await offer.getByRole('button', { name: '以後再說' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '叫蛋紀錄' })).toBeVisible()
  await expect(offer).toHaveCount(0)
  await page.getByRole('banner').getByRole('button').click()
  const menu = page.getByRole('dialog', { name: /目前登入/ })
  await expect(menu.getByRole('button', { name: '設定 Face ID 登入' })).toBeVisible()
  await menu.getByRole('button', { name: '登出' }).click()
  await expect(page.getByRole('button', { name: '用 Face ID 登入' })).toBeVisible()
  await ctx.close()
})

test('登入錯誤密碼顯示錯誤', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/')
  await page.getByLabel('Email').fill('bao@test.local')
  await page.getByLabel('密碼').fill('wrong')
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('帳號或密碼不正確')
  await ctx.close()
})

test('空帳本與新增預設值（今天叫、明天送、一箱）', async () => {
  await expect(bao.getByText('還沒有叫蛋紀錄')).toBeVisible()
  await bao.getByRole('button', { name: '記一筆叫蛋' }).click()
  const sheet = bao.getByRole('dialog', { name: '記一筆叫蛋' })
  await expect(sheet.getByLabel('叫蛋日期')).toHaveValue(today)
  await expect(sheet.getByLabel('送蛋日期')).toHaveValue(tomorrow)
  await expect(sheet.getByLabel('箱數')).toHaveValue('1')
  await expect(sheet.getByRole('button', { name: '阿寶' })).toHaveAttribute('aria-pressed', 'true')
  // 價格空白直接存
  await sheet.getByRole('button', { name: '記下這筆' }).click()
  await expect(sheet).toBeHidden()

  const c = card(bao, tomorrow, 1)
  await expect(c.getByText('預訂')).toBeVisible()
  await expect(c.getByText('待補價格')).toBeVisible()
  const summary = bao.getByLabel('未付摘要')
  await expect(summary).toContainText('0 元') // 未知價格不算成金額
  await expect(summary).toContainText('未結清 1 筆')
  await expect(summary).toContainText('待補價格 1 筆')
})

test('兩人同步：草莓不用重新整理就看到阿寶新增的紀錄', async () => {
  await expect(card(berry, tomorrow, 1)).toBeVisible()
  await expect(card(berry, tomorrow, 1)).toContainText('阿寶叫')
})

test('超過一箱顯示每箱價格；部分付款；取消不改資料；連按只記一次', async () => {
  await addOrder(bao, { ordered: yesterday, delivery: today, boxes: 2, price: 850 })
  const c = card(bao, today, 2)
  await expect(c).toContainText('1,700 元')
  await expect(c).toContainText('每箱 850 元')
  await expect(bao.getByLabel('未付摘要')).toContainText('1,700 元')

  // 取消：不登記
  await c.getByRole('button', { name: /未付款/ }).click()
  let dlg = bao.getByRole('dialog', { name: '確定付清嗎？' })
  await expect(dlg).toContainText('1,700 元')
  await expect(dlg.getByRole('button', { name: '阿寶' })).toHaveAttribute('aria-pressed', 'true')
  await expect(dlg.getByLabel('付款日期')).toHaveValue(today)
  await dlg.getByRole('button', { name: '取消' }).click()
  await expect(dlg).toBeHidden()
  expect(await sql('select * from public.payments')).toHaveLength(0)

  // 部分付款 1,000，並快速連按確認
  await c.getByRole('button', { name: /未付款/ }).click()
  dlg = bao.getByRole('dialog', { name: '確定付清嗎？' })
  await dlg.getByRole('button', { name: '只付一部分' }).click()
  await dlg.getByLabel('本次付款金額').fill('1000')
  await expect(bao.getByRole('dialog', { name: '確定付款嗎？' })).toContainText('付後尚欠 700 元')
  const confirm = bao.getByRole('dialog', { name: '確定付款嗎？' }).getByRole('button', { name: '確認付款' })
  await confirm.dblclick()
  await expect(c.getByRole('button', { name: /已付 1,000/ })).toContainText('尚欠 700 元')
  expect(await sql('select * from public.payments')).toHaveLength(1)
  await expect(bao.getByLabel('未付摘要')).toContainText('700 元')
})

test('點金額原地改價：重算差額但保留已付；多付明確顯示', async () => {
  await bao.getByRole('button', { name: /^全部/ }).click() // 多付會變成已結清，用「全部」看同一筆
  const c = card(bao, today, 2)
  await c.getByRole('button', { name: '修改價格' }).click()
  await c.getByLabel('每箱價格').fill('400')
  await c.getByRole('button', { name: '儲存' }).click()
  await expect(c).toContainText('800 元')
  await expect(c.getByRole('button', { name: /多付 200 元/ })).toContainText('已付 1,000')

  await c.getByRole('button', { name: '修改價格' }).click()
  await c.getByLabel('每箱價格').fill('850')
  await c.getByRole('button', { name: '儲存' }).click()
  await expect(c.getByRole('button', { name: /已付 1,000/ })).toContainText('尚欠 700 元')
  const [{ paid }] = await sql<{ paid: number }>('select sum(amount)::int as paid from public.payment_allocations')
  expect(paid).toBe(1000)
  await bao.getByRole('button', { name: /^未結清/ }).click()
})

test('付清後顯示付清日期與付款人，可以復原', async () => {
  const c = card(bao, today, 2)
  await c.getByRole('button', { name: /已付 1,000/ }).click()
  const dlg = bao.getByRole('dialog', { name: '確定付清嗎？' })
  await expect(dlg).toContainText('700 元')
  await dlg.getByRole('button', { name: '草莓' }).click()
  await dlg.getByRole('button', { name: '確認付款' }).click()
  // 首頁預設是未結清，付清後移到已結清
  await expect(c).toBeHidden()
  await bao.getByRole('button', { name: /^已結清/ }).click()
  await expect(c.getByRole('button', { name: /已付清/ })).toContainText(`${formatDay(today, today)} 草莓`)

  await bao.getByRole('status').getByRole('button', { name: '復原' }).click()
  await bao.getByRole('button', { name: /^未結清/ }).click()
  await expect(card(bao, today, 2).getByRole('button', { name: /已付 1,000/ })).toBeVisible()
  // 付款歷史保留（已復原那筆仍在）
  await expect(bao.getByText('已復原')).toBeVisible()
})

test('多筆結帳：部分付款按送蛋日期由舊到新分配，付款前顯示分配結果', async () => {
  await addOrder(bao, { ordered: prevMonthDay1, delivery: prevMonthDay1, boxes: 1, price: 900 })
  await bao.getByRole('button', { name: '多筆結帳' }).click()
  const sheet = bao.getByRole('dialog', { name: '多筆結帳' })
  // 預訂（價格未知）不能勾
  await expect(sheet.getByText('待補價格')).toBeVisible()
  await expect(sheet.getByLabel('本次付款金額', { exact: false })).toHaveValue('1600')
  await sheet.getByRole('textbox', { name: /本次付款金額/ }).fill('1000')
  const preview = sheet.getByLabel('分配結果')
  await expect(preview).toContainText(`${formatDay(prevMonthDay1, today)} 1 箱付 900，付清`)
  await expect(preview).toContainText(`${formatDay(today, today)} 2 箱付 100，仍欠 600`)
  await sheet.getByRole('button', { name: '下一步：確認付款' }).click()
  const dlg = bao.getByRole('dialog', { name: '確定付款嗎？' })
  await expect(dlg).toContainText('1,000 元')
  await dlg.getByRole('button', { name: '確認付款' }).click()
  await expect(dlg).toBeHidden()
  await expect(card(bao, today, 2).getByRole('button', { name: /已付 1,100/ })).toContainText('尚欠 600 元')
  await expect(card(bao, prevMonthDay1, 1)).toBeHidden() // 已結清，不在未結清列表
})

test('已結清確認後改回未付款，歷史保留', async () => {
  await bao.getByRole('button', { name: /^已結清/ }).click()
  const c = card(bao, prevMonthDay1, 1)
  await c.getByRole('button', { name: /已付清/ }).click()
  const dlg = bao.getByRole('dialog', { name: '改回未付款嗎？' })
  await dlg.getByRole('button', { name: '取消' }).click()
  await expect(c.getByRole('button', { name: /已付清/ })).toBeVisible()
  await c.getByRole('button', { name: /已付清/ }).click()
  await bao.getByRole('dialog', { name: '改回未付款嗎？' }).getByRole('button', { name: '改回未付款' }).click()
  await bao.getByRole('button', { name: /^未結清/ }).click()
  await expect(card(bao, prevMonthDay1, 1).getByRole('button', { name: /未付款/ })).toBeVisible()
  await expect(bao.getByText(/改回未付款，取消已付 900 元/)).toBeVisible()
})

test('更正付款日期與付款人', async () => {
  await bao.getByRole('button', { name: /阿寶付 1,000 元（1 筆叫蛋）/ }).click()
  const sheet = bao.getByRole('dialog', { name: '更正付款' })
  await sheet.getByLabel('付款日期').fill(yesterday)
  await sheet.getByRole('button', { name: '草莓' }).click()
  await sheet.getByRole('button', { name: '儲存更正' }).click()
  await expect(sheet).toBeHidden()
  await expect(bao.getByText(/更正付款：付款日期 .* → .*、付款人 阿寶 → 草莓/)).toBeVisible()
})

test('複製對帳：累積未結清與指定月份', async () => {
  await bao.getByRole('button', { name: '複製對帳' }).click()
  const sheet = bao.getByRole('dialog', { name: '複製對帳' })
  const text = sheet.getByLabel('對帳文字')
  await expect(text).toHaveValue(new RegExp(`${formatDay(prevMonthDay1, today).replace(/[()（）]/g, '.')} 1 箱 共 900 元`))
  await expect(text).toHaveValue(/2 箱 共 1,700 元｜已付 1,100 元，尚欠 600 元/)
  await expect(text).toHaveValue(/預訂 1 箱 價格待確認/)
  await expect(text).toHaveValue(/總箱數：4 箱\n已知未付合計：1,500 元\n待補價格：1 筆$/)
  await expect(text).not.toHaveValue(/麻煩|請送/)
  await sheet.getByRole('button', { name: '複製文字' }).click()
  await expect(sheet.getByRole('button', { name: '已複製，可以貼給廠商' })).toBeVisible()
  expect(await bao.evaluate(() => navigator.clipboard.readText())).toContain('叫蛋對帳（未結清）')

  await sheet.getByRole('button', { name: '指定月份' }).click()
  await sheet.getByLabel(/月份/).fill(prevMonth)
  await expect(text).toHaveValue(/依送蛋日期/)
  await expect(text).toHaveValue(/1 箱 共 900 元/)
  await expect(text).not.toHaveValue(/1,700/)
  await sheet.getByRole('button', { name: '關閉' }).click()
})

test('兩人同時修改同一筆：提示衝突、不覆蓋、保留輸入', async () => {
  await expect(card(berry, today, 2)).toBeVisible()
  await card(berry, today, 2).getByRole('button', { name: '修改箱數' }).click()
  const berrySheet = berry.getByRole('dialog', { name: '修改叫蛋' })
  await card(bao, today, 2).getByRole('button', { name: '修改箱數' }).click()
  const baoSheet = bao.getByRole('dialog', { name: '修改叫蛋' })

  await baoSheet.getByLabel('箱數').fill('3')
  await baoSheet.getByRole('button', { name: '儲存修改' }).click()
  await expect(baoSheet).toBeHidden()

  await berrySheet.getByLabel('箱數').fill('4')
  await berrySheet.getByRole('button', { name: '儲存修改' }).click()
  await expect(berrySheet.getByRole('alert')).toContainText('對方剛修改過')
  await expect(berrySheet.getByLabel('箱數')).toHaveValue('4')
  const [{ boxes }] = await sql<{ boxes: number }>(`select boxes from public.egg_orders where delivery_on = $1`, [today])
  expect(boxes).toBe(3)
  // 確認後再存一次才會套用
  await berrySheet.getByRole('button', { name: '儲存修改' }).click()
  await expect(berrySheet).toBeHidden()
  await expect(card(bao, today, 4)).toBeVisible()
})

test('儲存失敗保留輸入、不顯示成功', async () => {
  // 第一次送出時網路中斷
  let failed = false
  await bao.route('**/rest/v1/egg_orders*', (route) => {
    if (route.request().method() === 'POST' && !failed) {
      failed = true
      return route.abort('internetdisconnected')
    }
    return route.continue()
  })
  await bao.getByRole('button', { name: '記一筆叫蛋' }).click()
  const sheet = bao.getByRole('dialog', { name: '記一筆叫蛋' })
  await sheet.getByLabel('箱數').fill('5')
  await sheet.getByLabel(/每箱價格/).fill('777')
  await sheet.getByRole('button', { name: '記下這筆' }).click()
  await expect(sheet.getByRole('alert')).toContainText('資料沒有儲存')
  await expect(sheet.getByLabel('箱數')).toHaveValue('5')
  await expect(sheet.getByLabel(/每箱價格/)).toHaveValue('777')
  expect(await sql(`select * from public.egg_orders where price_per_box = 777`)).toHaveLength(0)
  await sheet.getByRole('button', { name: '記下這筆' }).click()
  await expect(sheet).toBeHidden()
  expect(await sql(`select * from public.egg_orders where price_per_box = 777`)).toHaveLength(1)
  await bao.unrouteAll()
})

test('離線時提示且不能儲存', async () => {
  await baoCtx.setOffline(true)
  await expect(bao.getByText('目前離線')).toBeVisible()
  await bao.getByRole('button', { name: '記一筆叫蛋' }).click()
  const sheet = bao.getByRole('dialog', { name: '記一筆叫蛋' })
  await expect(sheet.getByRole('button', { name: '記下這筆' })).toBeDisabled()
  await sheet.getByRole('button', { name: '關閉' }).click()
  await baoCtx.setOffline(false)
  await expect(bao.getByText('目前離線')).toBeHidden()
})

test('賣蛋：按顆數登記、再次儲存是修改不累加、未來日期不能登記', async () => {
  await berry.getByRole('navigation').getByRole('button', { name: '賣蛋', exact: true }).click()
  await berry.getByRole('button', { name: '登記當日賣出' }).click()
  let sheet = berry.getByRole('dialog', { name: `登記 ${formatDay(today, today)}` })
  await sheet.getByRole('button', { name: '填顆數' }).click()
  await sheet.getByLabel('賣出顆數').fill('100')
  await expect(sheet.getByLabel('這次每顆售價')).toHaveValue('15')
  await expect(sheet).toContainText('收入 1,500 元')
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(berry.getByLabel('今天')).toContainText('1,500 元')

  await berry.getByRole('button', { name: '修改今天的紀錄' }).click()
  sheet = berry.getByRole('dialog', { name: `修改 ${formatDay(today, today)}` })
  await expect(sheet).toContainText('儲存會修改它，不會重複累加')
  await sheet.getByRole('button', { name: '填收入' }).click()
  await sheet.getByLabel('當日收入（元）').fill('2000')
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(berry.getByLabel('今天')).toContainText('2,000 元')
  expect(await sql('select * from public.daily_sales')).toHaveLength(1)

  // 未來日期按鈕停用（若今天不是月底）
  const { d } = parseYmd(today)
  const last = new Date(Date.UTC(parseYmd(today).y, parseYmd(today).m, 0)).getUTCDate()
  if (d < last) {
    const [y, m] = monthOf(today).split('-').map(Number)
    await expect(berry.getByRole('button', { name: new RegExp(`^${formatDay(ymd(y, m, d + 1), today).replace(/[()（）]/g, '.')}`) })).toBeDisabled()
  }
})

test('賣蛋：補登上月、改預設售價不影響舊紀錄、只記收入不強迫顆數、休息', async () => {
  await berry.getByRole('button', { name: '上個月' }).click()
  await berry.getByRole('button', { name: new RegExp(`^${formatDay(prevMonthDay1, today).replace(/[()（）]/g, '.')}`) }).click()
  let sheet = berry.getByRole('dialog', { name: `登記 ${formatDay(prevMonthDay1, today)}` })
  await sheet.getByRole('button', { name: '填顆數' }).click()
  await sheet.getByLabel('賣出顆數').fill('10')
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet).toBeHidden()

  await berry.getByRole('button', { name: '修改', exact: true }).click()
  const dlg = berry.getByRole('dialog', { name: '預設每顆售價' })
  await dlg.getByLabel('每顆（元）').fill('16')
  await dlg.getByRole('button', { name: '儲存' }).click()
  await expect(berry.getByText('每顆 16 元 修改')).toBeVisible()
  const [{ income, unit_price }] = await sql<{ income: number; unit_price: number }>(
    `select income, unit_price from public.daily_sales where sale_date = $1`,
    [prevMonthDay1],
  )
  expect([income, unit_price]).toEqual([150, 15])

  const day2 = `${prevMonth}-02`
  await berry.getByRole('button', { name: new RegExp(`^${formatDay(day2, today).replace(/[()（）]/g, '.')}`) }).click()
  sheet = berry.getByRole('dialog', { name: `登記 ${formatDay(day2, today)}` })
  await sheet.getByRole('button', { name: '填顆數' }).click()
  await expect(sheet.getByLabel('這次每顆售價')).toHaveValue('16')
  await sheet.getByRole('button', { name: '填收入' }).click()
  await sheet.getByLabel('當日收入（元）').fill('1234')
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet).toBeHidden()

  const day3 = `${prevMonth}-03`
  await berry.getByRole('button', { name: new RegExp(`^${formatDay(day3, today).replace(/[()（）]/g, '.')}`) }).click()
  sheet = berry.getByRole('dialog', { name: `登記 ${formatDay(day3, today)}` })
  await sheet.getByRole('button', { name: '休息' }).click()
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet).toBeHidden()
  const rows = await sql<{ mode: string; egg_count: number | null }>(`select mode, egg_count from public.daily_sales where sale_date in ($1, $2) order by sale_date`, [day2, day3])
  expect(rows).toEqual([
    { mode: 'income', egg_count: null },
    { mode: 'rest', egg_count: null },
  ])
})

test('每月統計：進貨依送蛋日、收入依販售日；價格未齊不顯示差額', async () => {
  await berry.getByRole('navigation').getByRole('button', { name: '統計', exact: true }).click()
  await expect(berry.getByRole('heading', { name: '每月統計' })).toBeVisible()
  // 賣蛋頁剛切到上個月，統計共用月份
  await expect(berry.getByText(`${parseYmd(prevMonthDay1).y} 年 ${parseYmd(prevMonthDay1).m} 月`)).toBeVisible()
  await expect(berry.getByLabel('進貨')).toContainText('900 元')
  await expect(berry.getByLabel('賣蛋')).toContainText('1,384 元')
  await expect(berry.getByLabel('賣蛋')).toContainText('484 元') // 1,384 − 900
  await expect(berry.getByLabel('登記天數')).toContainText('3 天（含休息 1 天）')

  // 本月：今天送 4 箱 × 850；明天送的 5 箱是預訂，不計入進貨
  await berry.getByRole('button', { name: '下個月' }).click()
  const stats = berry.getByLabel('進貨')
  await expect(stats).toContainText('4 箱')
  await expect(stats).toContainText('3,400 元')
  if (monthOf(tomorrow) === monthOf(today)) await expect(stats).toContainText('未來預訂')
  await expect(berry.getByLabel('賣蛋')).toContainText('2,000 元')
  await expect(berry.getByLabel('賣蛋')).toContainText('−1,400 元')
  await expect(berry.getByText('不是淨利')).toBeVisible()

  // 價格未齊：補一筆今天送、沒價格的叫蛋，差額改為提示
  await berry.getByRole('navigation').getByRole('button', { name: '叫蛋', exact: true }).click()
  await addOrder(berry, { ordered: today, delivery: today, boxes: 1 })
  await berry.getByRole('navigation').getByRole('button', { name: '統計', exact: true }).click()
  await expect(berry.getByLabel('賣蛋')).toContainText('補齊 1 筆價格後顯示')
  await expect(berry.getByLabel('進貨')).toContainText('1 筆（未計入成本）')

  await berry.getByRole('button', { name: '上個月' }).click()
  await berry.getByRole('button', { name: '到日期表補登' }).click()
  await expect(berry.getByRole('heading', { name: '賣蛋紀錄' })).toBeVisible()
})

test('修改紀錄：操作人取自登入帳號、台灣時間', async () => {
  await berry.getByRole('navigation').getByRole('button', { name: '叫蛋', exact: true }).click()
  const audit = berry.locator('section[aria-labelledby="audit-h"]')
  await expect(audit).toContainText('草莓')
  await expect(audit).toContainText('阿寶')
  const actors = await sql<{ actor_name: string }>(`select distinct actor_name from public.audit_log where actor is not null order by 1`)
  expect(actors.map((a) => a.actor_name).sort()).toEqual(['草莓', '阿寶'].sort())
})

test('手機版面：不橫向捲動、按鈕與點擊區夠大、輸入字 16px', async () => {
  const page = bao
  await page.getByRole('navigation').getByRole('button', { name: '叫蛋', exact: true }).click()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const primary = await page.getByRole('button', { name: '記一筆叫蛋' }).boundingBox()
  expect(primary!.height).toBeGreaterThanOrEqual(50)
  for (const b of await page.locator('.status-btn, .amount-btn').all()) {
    const box = await b.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await page.getByRole('button', { name: '記一筆叫蛋' }).click()
  const sizes = await page.locator('.sheet input').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)))
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16)
  await page.screenshot({ path: 'test-results/form.png' })
  await page.getByRole('button', { name: '關閉' }).click()
  await page.screenshot({ path: 'test-results/home.png', fullPage: true })
  // 內容高度不鎖死
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  expect(h).toBeGreaterThan(852)
})
