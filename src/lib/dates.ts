// 日期工具：一律以台灣時區判斷「今天」，日期以 YYYY-MM-DD 字串處理，避免時區位移。

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function taipeiToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return parts // en-CA 格式即 YYYY-MM-DD
}

/** 時間戳記在台灣是哪一天（YYYY-MM-DD） */
export function taipeiDateOf(iso: string): string {
  return taipeiToday(new Date(iso))
}

export function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function weekday(s: string): string {
  const { y, m, d } = parseYmd(s)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

export function addDays(s: string, n: number): string {
  const { y, m, d } = parseYmd(s)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** 10/12（一）；不是今年時加上年份：2025/12/30（二） */
export function formatDay(s: string, today: string): string {
  const { y, m, d } = parseYmd(s)
  const prefix = y === parseYmd(today).y ? '' : `${y}/`
  return `${prefix}${m}/${d}（${weekday(s)}）`
}

export function monthOf(s: string): string {
  return s.slice(0, 7)
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y} 年 ${m} 月`
}

/** 時間戳記以台灣時區顯示：2026/10/12 21:05 */
export function formatTaipeiTime(iso: string): string {
  const f = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return `${p.year}/${p.month}/${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}

/** 只取時:分（台灣時間），日期另外顯示時用 */
export function formatTaipeiClock(iso: string): string {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}
