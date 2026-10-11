// 把各種錯誤整理成使用者看得懂的中文，並標出是否為「同時修改」衝突

export class AppError extends Error {
  constructor(
    message: string,
    readonly kind: 'conflict' | 'network' | 'permission' | 'validation' | 'unknown' = 'unknown',
  ) {
    super(message)
  }
}

export class ConflictError extends AppError {
  constructor(message = '對方剛修改過這筆資料，畫面已更新為最新內容。你的輸入還在，請確認後再儲存。') {
    super(message, 'conflict')
  }
}

type PgLike = { code?: string; message?: string; hint?: string; details?: string }

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (!navigator.onLine) return new AppError('目前離線，資料沒有儲存。恢復連線後再試一次。', 'network')
  const e = (err ?? {}) as PgLike
  const msg = e.message ?? String(err)
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) {
    return new AppError('連不上伺服器，資料沒有儲存。請確認網路後再試一次。', 'network')
  }
  if (e.hint === 'conflict') return new ConflictError(msg)
  if (e.code === '23505') return new ConflictError('這筆資料剛被對方登記過，畫面已更新。請確認後再儲存。')
  if (e.code === '42501') return new AppError(/[一-龥]/.test(msg) ? msg : '沒有權限進行這個操作。', 'permission')
  if (e.code === 'PGRST301' || /JWT/i.test(msg)) return new AppError('登入已過期，請重新登入。', 'permission')
  if (e.code === '23514' || e.code === 'P0001') return new AppError(msg, 'validation')
  return new AppError(`儲存失敗：${msg}`, 'unknown')
}
