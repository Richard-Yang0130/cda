/**
 * 搭 · CDA 后端。
 *
 * 零 npm 依赖：node:http + node:sqlite + node:crypto。
 * 10 人内测规模，够用且没有安装/供应链风险。
 *
 * 启动：node --experimental-strip-types src/index.ts
 * 环境变量：
 *   CDA_PORT     监听端口（默认 8787）
 *   CDA_DB       数据库文件（默认 ./data/cda.db）
 *   CDA_INVITES  初始邀请码，逗号分隔（仅首次运行时写入）
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  openDb, hashPassword, verifyPassword, formatUserCode, nextUserSeq,
  nowIso, newId, newToken,
  checkAttempts, recordFailure, clearFailures,
  type DB,
} from './db.ts'

const PORT = Number(process.env.CDA_PORT ?? 8787)
const DB_PATH = process.env.CDA_DB ?? './data/cda.db'
mkdirSync(dirname(DB_PATH), { recursive: true })
const db: DB = openDb(DB_PATH)

seedInvites()

// ── 小工具 ────────────────────────────────────────────

type Req = IncomingMessage & { code?: string; params: Record<string, string>; query: URLSearchParams; body: any }
type Handler = (req: Req, res: ServerResponse) => void | Promise<void>

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function fail(res: ServerResponse, status: number, message: string): void {
  json(res, status, { ok: false, error: message })
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    // 限制体积，防止超大请求打爆内存
    if (size > 1_000_000) throw new Error('请求体过大')
    chunks.push(c as Buffer)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** 把 /api/users/:code 这样的模式编译成正则 */
function compile(pattern: string): { re: RegExp; keys: string[] } {
  const keys: string[] = []
  const re = new RegExp(
    '^' + pattern.replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$',
  )
  return { re, keys }
}

const routes: Array<{ method: string; pattern: string; re: RegExp; keys: string[]; auth: boolean; fn: Handler }> = []

function route(method: string, pattern: string, auth: boolean, fn: Handler): void {
  const { re, keys } = compile(pattern)
  routes.push({ method, pattern, re, keys, auth, fn })
}

// ── 风格 / 品牌：分表读写 ─────────────────────────────

function stylesOf(code: string): string[] {
  return (db.prepare('SELECT style_id FROM user_styles WHERE code = ? ORDER BY sort_order').all(code) as any[])
    .map((r) => r.style_id)
}
function brandsOf(code: string): string[] {
  return (db.prepare('SELECT brand_id FROM user_brands WHERE code = ? ORDER BY sort_order').all(code) as any[])
    .map((r) => r.brand_id)
}
/** 全量替换：先删后插，顺序即 sort_order（主页取前 5 个靠它） */
function setStyles(code: string, ids: string[]): void {
  db.prepare('DELETE FROM user_styles WHERE code = ?').run(code)
  const ins = db.prepare('INSERT OR IGNORE INTO user_styles (code, style_id, sort_order) VALUES (?,?,?)')
  ids.forEach((id, i) => ins.run(code, String(id), i))
}
function setBrands(code: string, ids: string[]): void {
  db.prepare('DELETE FROM user_brands WHERE code = ?').run(code)
  const ins = db.prepare('INSERT OR IGNORE INTO user_brands (code, brand_id, sort_order) VALUES (?,?,?)')
  ids.forEach((id, i) => ins.run(code, String(id), i))
}

// ── 分页 ──────────────────────────────────────────────
// 原来所有列表都是硬编码 LIMIT，翻页要改接口。统一收口到这里。

const MAX_LIMIT = 50
function page(req: Req): { limit: number; offset: number } {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.get('limit')) || 20))
  const offset = Math.max(0, Number(req.query.get('offset')) || 0)
  return { limit, offset }
}
function paged<T>(res: ServerResponse, key: string, rows: T[], limit: number, offset: number): void {
  json(res, 200, {
    ok: true,
    [key]: rows,
    // 多取一条来判断还有没有下一页，避免额外的 COUNT 查询
    hasMore: rows.length > limit,
    nextOffset: rows.length > limit ? offset + limit : null,
  })
}

// ── 在线状态：节流写入 ────────────────────────────────
// 原来每个请求都 UPDATE 一次，写放大明显。60 秒内只写一次。

const PRESENCE_THROTTLE_MS = 60_000
const lastPresence = new Map<string, number>()
function touchPresence(code: string, online = true): void {
  const now = Date.now()
  if (now - (lastPresence.get(code) ?? 0) < PRESENCE_THROTTLE_MS) return
  lastPresence.set(code, now)
  db.prepare('UPDATE users SET is_online = ?, last_seen_at = ? WHERE code = ?')
    .run(online ? 1 : 0, nowIso(), code)
}

// ── 鉴权 ──────────────────────────────────────────────

function currentUser(req: Req): any | null {
  const h = req.headers.authorization ?? ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) return null
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as any
  if (!s) return null
  if (new Date(s.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  return db.prepare('SELECT * FROM users WHERE code = ?').get(s.code) ?? null
}

/** 把数据库行转成前端要的形状（snake_case → camelCase，JSON 字段解析） */
function toUser(u: any, opts: { self?: boolean } = {}): any {
  if (!u) return null
  const privacy = JSON.parse(u.privacy || '{}')
  const hide = privacy.hideOnlineStatus
  return {
    code: u.code,
    nickname: u.nickname,
    gender: u.gender,
    birthday: u.birthday,
    avatarHex: u.avatar_hex,
    styles: stylesOf(u.code),
    brands: brandsOf(u.code),
    status: u.status,
    region: privacy.hideRegion ? '' : u.region,
    privacy,
    // 自己看得到自己的在线状态；别人看你时受隐私设置约束
    isOnline: opts.self ? true : !hide && !!u.is_online,
    lastSeenAt: opts.self || !hide ? u.last_seen_at : '',
    createdAt: u.created_at,
    ...(opts.self ? { phone: u.phone ?? '', email: u.email ?? '' } : {}),
  }
}

function issueToken(code: string): string {
  const token = newToken()
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token, code, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, code, nowIso(), new Date(now + 30 * 864e5).toISOString())
  return token
}

// ── 邀请码 ────────────────────────────────────────────

function seedInvites(): void {
  const raw = process.env.CDA_INVITES
  const row = db.prepare('SELECT COUNT(*) AS n FROM invites').get() as { n: number }
  if (row.n > 0) return
  const codes = (raw ? raw.split(',') : ['CDA-BETA-0001', 'CDA-BETA-0002', 'CDA-BETA-0003'])
    .map((s) => s.trim()).filter(Boolean)
  const ins = db.prepare('INSERT OR IGNORE INTO invites (code, note, created_at) VALUES (?,?,?)')
  for (const c of codes) ins.run(c, '初始邀请码', nowIso())
  console.log(`[CDA] 已写入 ${codes.length} 个邀请码：${codes.join(', ')}`)
}

// ── 路由：认证 ────────────────────────────────────────

route('POST', '/api/auth/register', false, (req, res) => {
  const b = req.body
  const needed = ['password', 'nickname']
  for (const k of needed) if (!b[k]) return fail(res, 400, `缺少字段 ${k}`)
  if (String(b.password).length < 6) return fail(res, 400, '密码至少 6 位')
  if (!b.phone && !b.email) return fail(res, 400, '请提供手机号或邮箱')
  // 格式校验放在服务端 —— 前端的校验可以被绕过，服务端才是最后一道
  if (b.phone && !/^1[3-9]\d{9}$/.test(String(b.phone))) {
    return fail(res, 400, '手机号格式不正确')
  }
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email))) {
    return fail(res, 400, '邮箱格式不正确')
  }
  if (b.nickname && (String(b.nickname).trim().length < 2 || String(b.nickname).length > 16)) {
    return fail(res, 400, '昵称需 2–16 个字')
  }

  // 邀请码校验 —— 没有短信资质，用它控制注册入口
  if (b.inviteCode) {
    const inv = db.prepare('SELECT * FROM invites WHERE code = ?').get(String(b.inviteCode)) as any
    if (!inv) return fail(res, 403, '邀请码无效')
    if (inv.used_by) return fail(res, 403, '邀请码已被使用')
  }

  const dup = b.phone
    ? db.prepare('SELECT code FROM users WHERE phone = ?').get(String(b.phone))
    : db.prepare('SELECT code FROM users WHERE email = ?').get(String(b.email))
  if (dup) return fail(res, 409, '该手机号或邮箱已注册')

  const seq = nextUserSeq(db)
  const code = formatUserCode(seq)
  const { hash, salt } = hashPassword(String(b.password))
  db.prepare(`INSERT INTO users
    (code, seq, phone, email, password_hash, password_salt, nickname, gender, birthday,
     avatar_hex, region, privacy, last_seen_at, is_online, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    code, seq, b.phone ?? null, b.email ?? null, hash, salt,
    String(b.nickname), b.gender ?? 'female', b.birthday ?? '',
    b.avatarHex ?? '#c9b8a8',
    b.region ?? '中国', JSON.stringify(b.privacy ?? {}), nowIso(), 1, nowIso(),
  )
  setStyles(code, Array.isArray(b.styles) ? b.styles : [])
  setBrands(code, Array.isArray(b.brands) ? b.brands : [])
  if (b.inviteCode) {
    db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(code, nowIso(), String(b.inviteCode))
  }
  const u = db.prepare('SELECT * FROM users WHERE code = ?').get(code)
  json(res, 200, { ok: true, token: issueToken(code), user: toUser(u, { self: true }) })
})

route('POST', '/api/auth/login', false, (req, res) => {
  const b = req.body
  const account = String(b.account ?? '').trim()
  if (!account || !b.password) return fail(res, 400, '请输入账号与密码')

  // 频率限制：防撞库。按「账号 + 来源 IP」计数，任一维度都可能被换，
  // 两个一起记能同时挡住「撞一个账号」和「用一个 IP 撞很多账号」。
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0]!.trim()
  const keys = [`acct:${account}`, `ip:${ip}`]
  for (const k of keys) {
    const c = checkAttempts(db, k)
    if (!c.allowed) {
      res.setHeader('retry-after', String(c.retryAfterSec ?? 600))
      return fail(res, 429, `尝试过于频繁，请 ${Math.ceil((c.retryAfterSec ?? 600) / 60)} 分钟后再试`)
    }
  }
  const u = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ? OR code = ?')
    .get(account, account, account) as any
  // 账号不存在与密码错误返回同一句话，避免暴露账号是否注册过
  if (!u || !verifyPassword(String(b.password), u.password_hash, u.password_salt)) {
    for (const k of keys) recordFailure(db, k)
    return fail(res, 401, '账号或密码不正确')
  }
  if (u.status === 'disabled') return fail(res, 403, '账号已被禁用')
  for (const k of keys) clearFailures(db, k)
  db.prepare('UPDATE users SET is_online = 1, last_seen_at = ? WHERE code = ?').run(nowIso(), u.code)
  json(res, 200, { ok: true, token: issueToken(u.code), user: toUser(u, { self: true }) })
})

route('POST', '/api/auth/logout', true, (req, res) => {
  const h = req.headers.authorization ?? ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  lastPresence.delete(req.code!)
  db.prepare('UPDATE users SET is_online = 0, last_seen_at = ? WHERE code = ?').run(nowIso(), req.code!)
  json(res, 200, { ok: true })
})

// ── 路由：我 ──────────────────────────────────────────

route('GET', '/api/me', true, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE code = ?').get(req.code!)
  json(res, 200, { ok: true, user: toUser(u, { self: true }) })
})

route('PATCH', '/api/me', true, (req, res) => {
  const b = req.body ?? {}
  const map: Record<string, string> = {
    nickname: 'nickname', gender: 'gender', birthday: 'birthday', avatarHex: 'avatar_hex',
    region: 'region', status: 'status',
  }
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) { sets.push(`${col} = ?`); vals.push(b[k]) }
  }
  if (b.privacy !== undefined) { sets.push('privacy = ?'); vals.push(JSON.stringify(b.privacy)) }
  if (sets.length) {
    vals.push(req.code!)
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE code = ?`).run(...(vals as any[]))
  }
  // 风格与品牌走分表，顺序即优先级
  if (Array.isArray(b.styles)) setStyles(req.code!, b.styles)
  if (Array.isArray(b.brands)) setBrands(req.code!, b.brands)
  const u = db.prepare('SELECT * FROM users WHERE code = ?').get(req.code!)
  json(res, 200, { ok: true, user: toUser(u, { self: true }) })
})

// ── 路由：用户 ────────────────────────────────────────

route('GET', '/api/users', true, (req, res) => {
  const q = (req.query.get('q') ?? '').trim()
  if (!q) return json(res, 200, { ok: true, users: [] })
  const like = `%${q}%`
  const { limit, offset } = page(req)
  const rows = db.prepare(
    'SELECT * FROM users WHERE (nickname LIKE ? OR code LIKE ?) AND code != ? LIMIT ? OFFSET ?',
  ).all(like, like, req.code!, limit + 1, offset) as any[]
  // 尊重对方的「不被搜索到」隐私设置
  const users = rows.filter((u) => !JSON.parse(u.privacy || '{}').hideFromSearch).map((u) => toUser(u))
  paged(res, 'users', users, limit, offset)
})

route('GET', '/api/users/:code', true, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE code = ?').get(req.params.code!)
  if (!u) return fail(res, 404, '用户不存在')
  const followers = (db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee = ?').get(req.params.code!) as any).n
  const following = (db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower = ?').get(req.params.code!) as any).n
  const isFollowing = !!db.prepare('SELECT 1 FROM follows WHERE follower = ? AND followee = ?')
    .get(req.code!, req.params.code!)
  const posts = db.prepare('SELECT * FROM posts WHERE author_code = ? ORDER BY created_at DESC LIMIT 30')
    .all(req.params.code!) as any[]
  json(res, 200, {
    ok: true, user: toUser(u), followers, following, isFollowing,
    posts: posts.map(toPost),
  })
})

/** 关注 / 取消关注 / 拉黑 —— 统一在这里，避免重复写 */
for (const [path, action] of [
  ['/api/users/:code/follow', 'follow'],
  ['/api/users/:code/unfollow', 'unfollow'],
  ['/api/users/:code/block', 'block'],
  ['/api/users/:code/unblock', 'unblock'],
] as const) {
  route('POST', path, true, (req, res) => {
    const me = req.code!
    const peer = req.params.code!
    if (peer === me) return fail(res, 400, '不能对自己操作')
    if (action === 'follow') {
      // 被对方拉黑时不允许关注
      const blocked = db.prepare('SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?').get(peer, me)
      if (blocked) return fail(res, 403, '对方已将你加入黑名单')
      db.prepare('INSERT OR IGNORE INTO follows (follower, followee, created_at) VALUES (?,?,?)').run(me, peer, nowIso())
    } else if (action === 'unfollow') {
      db.prepare('DELETE FROM follows WHERE follower = ? AND followee = ?').run(me, peer)
    } else if (action === 'block') {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker, blocked, created_at) VALUES (?,?,?)').run(me, peer, nowIso())
      // 拉黑同时解除互相关注
      db.prepare('DELETE FROM follows WHERE (follower = ? AND followee = ?) OR (follower = ? AND followee = ?)').run(me, peer, peer, me)
    } else {
      db.prepare('DELETE FROM blocks WHERE blocker = ? AND blocked = ?').run(me, peer)
    }
    json(res, 200, { ok: true })
  })
}

route('GET', '/api/me/following', true, (req, res) => {
  const rows = db.prepare(
    'SELECT u.* FROM follows f JOIN users u ON u.code = f.followee WHERE f.follower = ? ORDER BY f.created_at DESC',
  ).all(req.code!) as any[]
  json(res, 200, { ok: true, users: rows.map((u) => toUser(u)) })
})

route('GET', '/api/me/favorites', true, (req, res) => {
  const rows = db.prepare(
    'SELECT p.* FROM favorites f JOIN posts p ON p.id = f.post_id WHERE f.code = ? ORDER BY f.created_at DESC',
  ).all(req.code!) as any[]
  json(res, 200, { ok: true, posts: rows.map(toPost) })
})

route('GET', '/api/me/history', true, (req, res) => {
  const rows = db.prepare(
    'SELECT p.* FROM history h JOIN posts p ON p.id = h.post_id WHERE h.code = ? ORDER BY h.viewed_at DESC LIMIT 50',
  ).all(req.code!) as any[]
  json(res, 200, { ok: true, posts: rows.map(toPost) })
})

// ── 路由：帖子 ────────────────────────────────────────

function toPost(p: any, likedByMe = false): any {
  if (!p) return null
  return {
    id: p.id,
    authorCode: p.author_code,
    author: p.author_nickname ?? undefined,
    avatarHex: p.author_avatar ?? undefined,
    title: p.title,
    coverHex: p.cover_hex,
    tags: JSON.parse(p.tags || '[]'),
    likes: p.likes,
    comments: p.comment_count ?? 0,
    ratio: p.ratio,
    linkedProductId: p.linked_product_id ?? undefined,
    createdAt: p.created_at,
    likedByMe,
  }
}

route('GET', '/api/posts', true, (req, res) => {
  const { limit, offset } = page(req)
  // 评论数由评论表推导，不再依赖 posts 上那个没人维护的计数器
  const rows = db.prepare(`
    SELECT p.*, u.nickname AS author_nickname, u.avatar_hex AS author_avatar,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p JOIN users u ON u.code = p.author_code
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(limit + 1, offset) as any[]
  const liked = new Set(
    (db.prepare('SELECT post_id FROM post_likes WHERE code = ?').all(req.code!) as any[]).map((r) => r.post_id),
  )
  paged(res, 'posts', rows.map((p) => toPost(p, liked.has(p.id))), limit, offset)
})

// ── 评论 ──

route('GET', '/api/posts/:id/comments', true, (req, res) => {
  const { limit, offset } = page(req)
  const rows = db.prepare(`
    SELECT c.*, u.nickname AS author_nickname, u.avatar_hex AS author_avatar
    FROM comments c JOIN users u ON u.code = c.author_code
    WHERE c.post_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`)
    .all(req.params.id!, limit + 1, offset) as any[]
  paged(res, 'comments', rows.map((c) => ({
    id: c.id, postId: c.post_id, text: c.text,
    authorCode: c.author_code, author: c.author_nickname, avatarHex: c.author_avatar,
    createdAt: c.created_at,
  })), limit, offset)
})

route('POST', '/api/posts/:id/comments', true, (req, res) => {
  const text = String(req.body?.text ?? '').trim()
  if (!text) return fail(res, 400, '评论不能为空')
  if (text.length > 500) return fail(res, 400, '评论过长')
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id!)) {
    return fail(res, 404, '帖子不存在')
  }
  const id = newId('cm')
  db.prepare('INSERT INTO comments (id, post_id, author_code, text, created_at) VALUES (?,?,?,?,?)')
    .run(id, req.params.id!, req.code!, text, nowIso())
  const u = db.prepare('SELECT nickname, avatar_hex FROM users WHERE code = ?').get(req.code!) as any
  const n = (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?').get(req.params.id!) as any).n
  json(res, 200, {
    ok: true, commentCount: n,
    comment: { id, postId: req.params.id!, text, authorCode: req.code!, author: u.nickname, avatarHex: u.avatar_hex, createdAt: nowIso() },
  })
})

route('DELETE', '/api/comments/:id', true, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id!) as any
  if (!c) return fail(res, 404, '评论不存在')
  // 只有作者本人能删自己的评论
  if (c.author_code !== req.code!) return fail(res, 403, '只能删除自己的评论')
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id!)
  json(res, 200, { ok: true })
})

route('GET', '/api/posts/:id', true, (req, res) => {
  const p = db.prepare(`
    SELECT p.*, u.nickname AS author_nickname, u.avatar_hex AS author_avatar,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p JOIN users u ON u.code = p.author_code WHERE p.id = ?`).get(req.params.id!) as any
  if (!p) return fail(res, 404, '帖子不存在')
  // 记录浏览历史
  db.prepare('INSERT OR REPLACE INTO history (code, post_id, viewed_at) VALUES (?,?,?)')
    .run(req.code!, p.id, nowIso())
  const liked = !!db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND code = ?').get(p.id, req.code!)
  json(res, 200, { ok: true, post: toPost(p, liked) })
})

route('POST', '/api/posts', true, (req, res) => {
  const b = req.body ?? {}
  if (!String(b.title ?? '').trim()) return fail(res, 400, '请填写内容')
  const id = newId('post')
  db.prepare(`INSERT INTO posts (id, author_code, title, cover_hex, tags, ratio, linked_product_id, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    id, req.code!, String(b.title), b.coverHex ?? '#dddddd',
    JSON.stringify(b.tags ?? []), Number(b.ratio) || 1, b.linkedProductId ?? null, nowIso(),
  )
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
  json(res, 200, { ok: true, post: toPost(p) })
})

route('POST', '/api/posts/:id/like', true, (req, res) => {
  const id = req.params.id!
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
  if (!p) return fail(res, 404, '帖子不存在')
  const has = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND code = ?').get(id, req.code!)
  if (has) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND code = ?').run(id, req.code!)
    db.prepare('UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?').run(id)
  } else {
    db.prepare('INSERT INTO post_likes (post_id, code, created_at) VALUES (?,?,?)').run(id, req.code!, nowIso())
    db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(id)
  }
  const after = db.prepare('SELECT likes FROM posts WHERE id = ?').get(id) as any
  json(res, 200, { ok: true, likes: after.likes, liked: !has })
})

route('POST', '/api/posts/:id/favorite', true, (req, res) => {
  const id = req.params.id!
  const has = db.prepare('SELECT 1 FROM favorites WHERE code = ? AND post_id = ?').get(req.code!, id)
  if (has) db.prepare('DELETE FROM favorites WHERE code = ? AND post_id = ?').run(req.code!, id)
  else db.prepare('INSERT INTO favorites (code, post_id, created_at) VALUES (?,?,?)').run(req.code!, id, nowIso())
  json(res, 200, { ok: true, favorited: !has })
})

// ── 路由：消息 ────────────────────────────────────────

/** 会话按用户码排序后存 user_a/user_b，保证同一对人只有一条会话 */
function convOf(me: string, peer: string): string {
  const [a, b] = [me, peer].sort()
  const found = db.prepare('SELECT id FROM conversations WHERE user_a = ? AND user_b = ?').get(a!, b!) as any
  if (found) return found.id
  const id = newId('conv')
  db.prepare('INSERT INTO conversations (id, user_a, user_b, updated_at) VALUES (?,?,?,?)').run(id, a!, b!, nowIso())
  return id
}

route('GET', '/api/conversations', true, (req, res) => {
  const me = req.code!
  const rows = db.prepare(
    'SELECT * FROM conversations WHERE user_a = ? OR user_b = ? ORDER BY updated_at DESC',
  ).all(me, me) as any[]
  const list = rows.map((c) => {
    const peerCode = c.user_a === me ? c.user_b : c.user_a
    const peer = db.prepare('SELECT * FROM users WHERE code = ?').get(peerCode) as any
    const last = db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY created_at DESC LIMIT 1').get(c.id) as any
    const unread = (db.prepare(
      'SELECT COUNT(*) AS n FROM messages WHERE conv_id = ? AND from_code != ? AND read_at IS NULL',
    ).get(c.id, me) as any).n
    return {
      id: c.id,
      peer: toUser(peer),
      lastMessage: last ? { text: last.text, fromMe: last.from_code === me, createdAt: last.created_at } : null,
      unread,
      updatedAt: c.updated_at,
    }
  })
  json(res, 200, { ok: true, conversations: list })
})

route('GET', '/api/conversations/:peer/messages', true, (req, res) => {
  const me = req.code!
  const peer = req.params.peer!
  const convId = convOf(me, peer)
  // 历史消息按时间正序分页；前端默认拉最新的一页
  const { limit, offset } = page(req)
  const rows = db.prepare('SELECT * FROM messages WHERE conv_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?')
    .all(convId, limit, offset) as any[]
  // 读过的标记为已读
  db.prepare('UPDATE messages SET read_at = ? WHERE conv_id = ? AND from_code != ? AND read_at IS NULL')
    .run(nowIso(), convId, me)
  json(res, 200, {
    ok: true,
    messages: rows.map((m) => ({
      id: m.id, text: m.text, fromMe: m.from_code === me, createdAt: m.created_at,
    })),
  })
})

route('POST', '/api/conversations/:peer/messages', true, (req, res) => {
  const me = req.code!
  const peer = req.params.peer!
  const text = String(req.body?.text ?? '').trim()
  if (!text) return fail(res, 400, '消息不能为空')
  if (text.length > 1000) return fail(res, 400, '消息过长')
  const target = db.prepare('SELECT * FROM users WHERE code = ?').get(peer) as any
  if (!target) return fail(res, 404, '用户不存在')
  // 被拉黑则不能发
  if (db.prepare('SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?').get(peer, me)) {
    return fail(res, 403, '对方已将你加入黑名单')
  }
  const convId = convOf(me, peer)
  const id = newId('msg')
  db.prepare('INSERT INTO messages (id, conv_id, from_code, text, created_at) VALUES (?,?,?,?,?)')
    .run(id, convId, me, text, nowIso())
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), convId)
  json(res, 200, { ok: true, message: { id, text, fromMe: true, createdAt: nowIso() } })
})

// ── 路由：收货地址 ────────────────────────────────────

route('GET', '/api/addresses', true, (req, res) => {
  const rows = db.prepare('SELECT * FROM addresses WHERE code = ? ORDER BY is_default DESC, rowid DESC')
    .all(req.code!) as any[]
  json(res, 200, { ok: true, addresses: rows.map(toAddress) })
})

function toAddress(a: any): any {
  return {
    id: a.id, name: a.name, phone: a.phone, province: a.province, city: a.city,
    district: a.district, detail: a.detail, isDefault: !!a.is_default, tag: a.tag,
  }
}

route('POST', '/api/addresses', true, (req, res) => {
  const b = req.body ?? {}
  if (!b.name || !b.phone || !b.province || !b.detail) return fail(res, 400, '地址信息不完整')
  if (!/^1[3-9]\d{9}$/.test(String(b.phone))) return fail(res, 400, '手机号格式不正确')
  const id = b.id && db.prepare('SELECT 1 FROM addresses WHERE id = ? AND code = ?').get(b.id, req.code!)
    ? b.id : newId('addr')
  if (b.isDefault) db.prepare('UPDATE addresses SET is_default = 0 WHERE code = ?').run(req.code!)
  db.prepare(`INSERT OR REPLACE INTO addresses
    (id, code, name, phone, province, city, district, detail, is_default, tag, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.code!, String(b.name), String(b.phone), String(b.province),
    String(b.city ?? ''), String(b.district ?? ''), String(b.detail),
    b.isDefault ? 1 : 0, String(b.tag ?? ''), nowIso(),
  )
  const rows = db.prepare('SELECT * FROM addresses WHERE code = ? ORDER BY is_default DESC, rowid DESC').all(req.code!) as any[]
  json(res, 200, { ok: true, addresses: rows.map(toAddress) })
})

route('DELETE', '/api/addresses/:id', true, (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id = ? AND code = ?').run(req.params.id!, req.code!)
  const rows = db.prepare('SELECT * FROM addresses WHERE code = ? ORDER BY is_default DESC, rowid DESC').all(req.code!) as any[]
  json(res, 200, { ok: true, addresses: rows.map(toAddress) })
})

// ── 路由：衣橱 ────────────────────────────────────────

route('GET', '/api/wardrobe', true, (req, res) => {
  const rows = db.prepare('SELECT * FROM wardrobe WHERE code = ? ORDER BY created_at DESC').all(req.code!) as any[]
  json(res, 200, {
    ok: true,
    items: rows.map((w) => ({
      id: w.id, productId: w.product_id, colorId: w.color_id, size: w.size,
      source: w.source, note: w.note, createdAt: w.created_at,
    })),
  })
})

route('POST', '/api/wardrobe', true, (req, res) => {
  const b = req.body ?? {}
  if (!b.productId) return fail(res, 400, '缺少 productId')
  const id = newId('w')
  db.prepare(`INSERT OR IGNORE INTO wardrobe (id, code, product_id, color_id, size, source, note, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    id, req.code!, String(b.productId), String(b.colorId ?? ''), String(b.size ?? ''),
    String(b.source ?? 'manual'), String(b.note ?? ''), nowIso(),
  )
  json(res, 200, { ok: true })
})

route('DELETE', '/api/wardrobe/:id', true, (req, res) => {
  db.prepare('DELETE FROM wardrobe WHERE id = ? AND code = ?').run(req.params.id!, req.code!)
  json(res, 200, { ok: true })
})

// ── 服务 ──────────────────────────────────────────────

const server = createServer(async (rawReq, res) => {
  const req = rawReq as Req
  // 开发期内测：允许任意来源，方便隧道与手机访问
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type, authorization')
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url ?? '/', 'http://localhost')
  req.query = url.searchParams
  req.params = {}

  if (url.pathname === '/api/health') return json(res, 200, { ok: true, ts: nowIso() })

  const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname))
  if (!match) return fail(res, 404, `无此接口：${req.method} ${url.pathname}`)

  const m = match.re.exec(url.pathname)!
  match.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1]!)))

  try {
    req.body = req.method === 'GET' ? {} : await readBody(req)
  } catch (e) {
    return fail(res, 400, (e as Error).message)
  }

  if (match.auth) {
    const u = currentUser(req)
    if (!u) return fail(res, 401, '未登录或登录已过期')
    req.code = u.code
    touchPresence(u.code)
  }

  try {
    await match.fn(req, res)
  } catch (e) {
    console.error('[CDA] 接口异常', match.pattern, e)
    if (!res.headersSent) fail(res, 500, '服务器内部错误')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[CDA] 后端已启动 http://0.0.0.0:${PORT}  数据库 ${DB_PATH}`)
})
