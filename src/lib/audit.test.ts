import { expect, test } from 'vitest'
import { describeAudit } from './audit'
import type { AuditEntry, Member } from './types'

const members: Member[] = [
  { id: 'm1', user_id: 'u1', display_name: '阿寶', sort: 1 },
  { id: 'm2', user_id: 'u2', display_name: '草莓', sort: 2 },
]
const base = { id: 1, at: '2026-10-12T12:00:00Z', actor: 'u1', actor_name: '阿寶', entity_id: 'x' }

test('改價紀錄顯示前後', () => {
  const e: AuditEntry = {
    ...base, action: 'update', entity: 'egg_orders',
    before: { delivery_on: '2026-10-12', boxes: 2, price_per_box: null, ordered_by: 'm2', ordered_on: '2026-10-11' },
    after: { delivery_on: '2026-10-12', boxes: 2, price_per_box: 850, ordered_by: 'm2', ordered_on: '2026-10-11' },
  }
  expect(describeAudit(e, members, '2026-10-12')).toBe('修改叫蛋（10/12（一）送）：每箱價格 待補 → 850 元')
})

test('付款紀錄', () => {
  const e: AuditEntry = {
    ...base, action: 'pay', entity: 'payments', before: null,
    after: { paid_on: '2026-10-12', payer: 'm1', total: 1700, allocations: [{}, {}] },
  }
  expect(describeAudit(e, members, '2026-10-12')).toBe('登記付款 1,700 元（2 筆叫蛋），付款人阿寶，10/12（一）')
})
