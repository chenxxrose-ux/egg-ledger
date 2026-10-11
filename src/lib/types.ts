// 與資料庫欄位一致的型別。金額皆為新台幣整數元。

export type Member = { id: string; user_id: string; display_name: string; sort: number }

export type Ledger = { id: string; name: string; egg_unit_price: number; version: number }

export type EggOrder = {
  id: string
  ledger_id: string
  ordered_on: string // YYYY-MM-DD
  delivery_on: string
  boxes: number
  price_per_box: number | null
  ordered_by: string // member id
  voided_at: string | null
  version: number
  created_at: string
}

export type Payment = {
  id: string
  ledger_id: string
  paid_on: string
  payer: string
  voided_at: string | null
  version: number
  created_at: string
}

export type Allocation = {
  id: string
  payment_id: string
  order_id: string
  amount: number
  voided_at: string | null
  version: number
}

export type SaleMode = 'income' | 'count' | 'rest'

export type DailySale = {
  id: string
  ledger_id: string
  sale_date: string
  mode: SaleMode
  income: number | null
  egg_count: number | null
  unit_price: number | null
  recorded_by: string
  version: number
}

export type AuditEntry = {
  id: number
  at: string
  actor: string | null
  actor_name: string
  action: string
  entity: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}
