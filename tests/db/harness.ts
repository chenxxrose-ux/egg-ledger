import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// 用 PGlite 在記憶體中跑真的 Postgres，模擬 Supabase 的 auth 結構與角色，驗證 migration 的規則。
const BOOTSTRAP = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
`

export const USERS = {
  bao: '00000000-0000-0000-0000-00000000000a',
  berry: '00000000-0000-0000-0000-00000000000b',
  stranger: '00000000-0000-0000-0000-00000000000c',
}

export async function createDb() {
  const db = new PGlite()
  await db.exec(BOOTSTRAP)
  const dir = join(__dirname, '../../supabase/migrations')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users values ('${USERS.bao}', 'bao@example.com'), ('${USERS.berry}', 'berry@example.com'), ('${USERS.stranger}', 'x@example.com');
    insert into public.ledgers (id, name) values ('10000000-0000-0000-0000-000000000001', '叫蛋記帳');
    insert into public.ledger_members (id, ledger_id, user_id, display_name, sort) values
      ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', '${USERS.bao}', '阿寶', 1),
      ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', '${USERS.berry}', '草莓', 2);
  `)
  return db
}

export const LEDGER = '10000000-0000-0000-0000-000000000001'
export const MEMBER = { bao: '20000000-0000-0000-0000-00000000000a', berry: '20000000-0000-0000-0000-00000000000b' }

/** 以某位使用者身分（authenticated 角色）執行 */
export async function as<T = Record<string, unknown>>(
  db: PGlite,
  user: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`)
  try {
    const r = await db.query<T>(sql, params)
    return r.rows
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
