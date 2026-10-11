export function formatMoney(n: number): string {
  return `${n.toLocaleString('en-US')} 元`
}

/** 解析使用者輸入的整數金額；空白回傳 null，不合法回傳 undefined */
export function parseAmount(input: string): number | null | undefined {
  const t = input.replace(/[,\s元]/g, '')
  if (t === '') return null
  if (!/^\d+$/.test(t)) return undefined
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : undefined
}
