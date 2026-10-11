// 測試用的本機 Supabase 替身：真的 Postgres（PGlite）+ 專案的 migration，
// 提供網站用到的 Auth、REST、RPC 與即時同步通知。只用於自動化驗收，不會部署。
import http from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.MOCK_PORT ?? 54321)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PASSWORD = 'test-password'
const USERS = [
  { id: '00000000-0000-4000-8000-00000000000a', email: 'bao@test.local', name: '阿寶', sort: 1 },
  { id: '00000000-0000-4000-8000-00000000000b', email: 'berry@test.local', name: '草莓', sort: 2 },
]

const db = new PGlite({ parsers: { 1082: (v) => v } }) // date 欄位保持 YYYY-MM-DD 字串，與 PostgREST 相同
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
`)
const migDir = join(root, 'supabase/migrations')
for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migDir, f), 'utf8'))
}
const ledgerId = randomUUID()
await db.query(`insert into public.ledgers (id, name) values ($1, '叫蛋記帳')`, [ledgerId])
for (const u of USERS) {
  await db.query(`insert into auth.users values ($1, $2)`, [u.id, u.email])
  await db.query(`insert into public.ledger_members (ledger_id, user_id, display_name, sort) values ($1, $2, $3, $4)`, [
    ledgerId,
    u.id,
    u.name,
    u.sort,
  ])
}

// 單一連線：所有請求排隊執行
let queue = Promise.resolve()
const serial = (fn) => {
  const p = queue.then(fn, fn)
  queue = p.catch(() => {})
  return p
}

async function asUser(userId, fn) {
  return serial(async () => {
    await db.exec('begin')
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
      await db.exec('set local role authenticated')
      const r = await fn()
      await db.exec('commit')
      return r
    } catch (e) {
      await db.exec('rollback')
      throw e
    }
  })
}

// ───── JWT（只是格式正確，本機測試不驗簽） ─────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function tokenFor(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return { token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, role: 'authenticated', aud: 'authenticated', exp, email: u.email })}.sig`, exp }
}
function userFromAuth(req) {
  const h = req.headers.authorization ?? ''
  const t = h.replace(/^Bearer /, '').split('.')[1]
  if (!t) return null
  try {
    const p = JSON.parse(Buffer.from(t, 'base64url').toString())
    return USERS.find((u) => u.id === p.sub) ?? null
  } catch {
    return null
  }
}
const userJson = (u) => ({
  id: u.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: u.email,
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: 'email' },
  user_metadata: {},
  identities: [],
  created_at: new Date().toISOString(),
})
function session(u) {
  const { token, exp } = tokenFor(u)
  return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `r-${u.id}`, user: userJson(u) }
}

// ───── PostgREST 子集合 ─────
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { code: 'PGRST100' })
  return `"${s}"`
}

function parseQuery(url) {
  const where = []
  const params = []
  let select = '*'
  let order = ''
  let limit = ''
  for (const [k, v] of url.searchParams) {
    if (k === 'select') select = v === '*' ? '*' : v.split(',').map(ident).join(',')
    else if (k === 'order') {
      order = ' order by ' + v.split(',').map((p) => {
        const [col, dir] = p.split('.')
        return `${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}`
      }).join(',')
    } else if (k === 'limit') limit = ` limit ${Number(v)}`
    else if (k === 'columns') continue
    else {
      const m = v.match(/^(eq|neq|gt|gte|lt|lte|is)\.(.*)$/)
      if (!m) throw Object.assign(new Error(`unsupported filter ${k}=${v}`), { code: 'PGRST100' })
      const op = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[m[1]]
      if (m[1] === 'is') where.push(`${ident(k)} is ${m[2] === 'null' ? 'null' : 'not null'}`)
      else {
        params.push(m[2])
        where.push(`${ident(k)}::text ${op} $${params.length}`)
      }
    }
  }
  return { select, where: where.length ? ` where ${where.join(' and ')}` : '', params, order, limit }
}

const TABLES = new Set(['ledgers', 'ledger_members', 'egg_orders', 'payments', 'payment_allocations', 'daily_sales', 'audit_log'])
const RPCS = {
  record_payment: ['p_ledger', 'p_paid_on', 'p_payer', 'p_allocations', 'p_client_request_id'],
  void_payment: ['p_payment', 'p_expected_version'],
  revert_order_payments: ['p_order', 'p_expected_version'],
  void_order: ['p_order', 'p_expected_version'],
  restore_order: ['p_order'],
}

async function handleRest(req, res, url, body, user) {
  const path = url.pathname.replace('/rest/v1/', '')
  if (path.startsWith('rpc/')) {
    const fn = path.slice(4)
    const args = RPCS[fn]
    if (!args) return send(res, 404, { code: 'PGRST202', message: `function ${fn} not found` })
    const values = args.map((a) => (a === 'p_allocations' ? JSON.stringify(body[a]) : body[a] ?? null))
    const sql = `select public.${fn}(${args.map((a, i) => `${a} => $${i + 1}`).join(', ')}) as r`
    const r = await asUser(user?.id, () => db.query(sql, values))
    notify()
    const v = r.rows[0]?.r
    return v === undefined || v === null || v === '' ? send(res, 200, null) : send(res, 200, v)
  }
  if (!TABLES.has(path)) return send(res, 404, { code: '42P01', message: 'not found' })
  const q = parseQuery(url)
  const t = `public.${ident(path)}`
  const wantObject = (req.headers.accept ?? '').includes('vnd.pgrst.object')
  const returning = url.searchParams.get('select') ? q.select : '*'
  const representation = (req.headers.prefer ?? '').includes('return=representation')

  if (req.method === 'GET') {
    const r = await asUser(user?.id, () => db.query(`select ${q.select} from ${t}${q.where}${q.order}${q.limit}`, q.params))
    if (wantObject) {
      if (r.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${r.rows.length} rows` })
      return send(res, 200, r.rows[0])
    }
    return send(res, 200, r.rows)
  }
  if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body]
    const out = await asUser(user?.id, async () => {
      const all = []
      for (const row of rows) {
        const cols = Object.keys(row)
        const r = await db.query(
          `insert into ${t} (${cols.map(ident).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning ${returning}`,
          cols.map((c) => row[c]),
        )
        all.push(...r.rows)
      }
      return all
    })
    notify()
    return representation ? send(res, 201, out) : send(res, 201, '')
  }
  if (req.method === 'PATCH') {
    const cols = Object.keys(body)
    const offset = q.params.length
    const where = q.where.replace(/\$(\d+)/g, (_, n) => `$${Number(n)}`)
    const r = await asUser(user?.id, () =>
      db.query(
        `update ${t} set ${cols.map((c, i) => `${ident(c)} = $${offset + i + 1}`).join(', ')}${where} returning ${returning}`,
        [...q.params, ...cols.map((c) => body[c])],
      ),
    )
    notify()
    return representation ? send(res, 200, r.rows) : send(res, 204, '')
  }
  if (req.method === 'DELETE') {
    const r = await asUser(user?.id, () => db.query(`delete from ${t}${q.where} returning *`, q.params))
    notify()
    return send(res, 200, r.rows)
  }
  return send(res, 405, { message: 'method not allowed' })
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', ...cors })
  res.end(data === '' ? '' : JSON.stringify(data))
}
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }
  const url = new URL(req.url, `http://localhost:${PORT}`)
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : {}
  try {
    if (url.pathname === '/__test/sql') {
      const r = await serial(() => db.query(body.sql, body.params ?? []))
      return send(res, 200, r.rows)
    }
    if (url.pathname === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'password') {
        const u = USERS.find((x) => x.email === body.email)
        if (!u || body.password !== PASSWORD) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' })
        return send(res, 200, session(u))
      }
      if (grant === 'refresh_token') {
        const u = USERS.find((x) => `r-${x.id}` === body.refresh_token)
        return u ? send(res, 200, session(u)) : send(res, 400, { error: 'invalid_grant' })
      }
    }
    if (url.pathname === '/auth/v1/user') {
      const u = userFromAuth(req)
      return u ? send(res, 200, userJson(u)) : send(res, 401, { message: 'invalid token' })
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204, '')
    if (url.pathname.startsWith('/rest/v1/')) {
      return await handleRest(req, res, url, body, userFromAuth(req))
    }
    send(res, 404, { message: 'not found' })
  } catch (e) {
    const status = e.code === '23505' ? 409 : e.code === '42501' ? 403 : 400
    send(res, status, { code: e.code ?? 'XX000', message: e.message, details: e.detail ?? null, hint: e.hint ?? null })
  }
})

// ───── 即時同步（Phoenix 通道協定的最小實作） ─────
const sockets = new Set()
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/realtime/v1/websocket')) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
})
wss.on('connection', (ws) => {
  const conn = { ws, channels: new Map() }
  sockets.add(conn)
  ws.on('close', () => sockets.delete(conn))
  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    const [joinRef, ref, topic, event, payload] = msg
    const reply = (response) => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]))
    if (event === 'phx_join') {
      const changes = (payload?.config?.postgres_changes ?? []).map((c, i) => ({ ...c, id: i + 1 }))
      conn.channels.set(topic, { joinRef, changes })
      reply({ postgres_changes: changes })
    } else if (event === 'phx_leave') {
      conn.channels.delete(topic)
      reply({})
    } else {
      reply({})
    }
  })
})

function notify() {
  setTimeout(() => {
    for (const conn of sockets) {
      for (const [topic, ch] of conn.channels) {
        if (ch.changes.length === 0) continue
        const c = ch.changes[0]
        conn.ws.send(
          JSON.stringify([
            ch.joinRef,
            null,
            topic,
            'postgres_changes',
            {
              ids: [c.id],
              data: { schema: 'public', table: c.table, commit_timestamp: new Date().toISOString(), type: 'UPDATE', record: {}, old_record: {}, columns: [], errors: null },
            },
          ]),
        )
      }
    }
  }, 50)
}

server.listen(PORT, () => console.log(`mock supabase on http://localhost:${PORT}`))
