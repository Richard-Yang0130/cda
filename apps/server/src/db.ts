/**
 * 数据库：结构、迁移、密码与工具。
 *
 * 用 Node 24 内置的 node:sqlite —— **零 npm 依赖**。
 * 10 人规模用 SQLite 完全够；将来换 Postgres 只需替换这一层。
 *
 * ── 迁移机制 ──
 * 用 `PRAGMA user_version` 记录库结构版本，MIGRATIONS 里按版本号顺序执行。
 * 改动结构时**只能往数组尾部追加**，绝不修改已发布的条目 ——
 * 否则老库与新库会走成两个不同的形状。
 */
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export type DB = DatabaseSync

interface Migration {
  version: number
  desc: string
  up: (db: DB) => void
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    desc: '初始结构：账号 / 社区 / 社交 / 交易',
    up: (db) => {
      db.exec(`
        -- ── 账号 ──
        CREATE TABLE users (
          code          TEXT PRIMARY KEY,
          seq           INTEGER NOT NULL UNIQUE,
          phone         TEXT UNIQUE,
          email         TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          nickname      TEXT NOT NULL,
          gender        TEXT NOT NULL DEFAULT 'female',
          birthday      TEXT NOT NULL DEFAULT '',
          avatar_hex    TEXT NOT NULL DEFAULT '#c9b8a8',
          status        TEXT NOT NULL DEFAULT 'active',
          region        TEXT NOT NULL DEFAULT '中国',
          privacy       TEXT NOT NULL DEFAULT '{}',
          last_seen_at  TEXT NOT NULL DEFAULT '',
          is_online     INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL
        );

        CREATE TABLE sessions (
          token      TEXT PRIMARY KEY,
          code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX idx_sessions_code ON sessions(code);
        CREATE INDEX idx_sessions_expires ON sessions(expires_at);

        CREATE TABLE invites (
          code       TEXT PRIMARY KEY,
          note       TEXT NOT NULL DEFAULT '',
          used_by    TEXT REFERENCES users(code) ON DELETE SET NULL,
          used_at    TEXT,
          created_at TEXT NOT NULL
        );

        -- 登录频率限制：按「账号/IP」计数，防撞库
        CREATE TABLE login_attempts (
          key          TEXT PRIMARY KEY,
          count        INTEGER NOT NULL DEFAULT 0,
          first_at     TEXT NOT NULL,
          locked_until TEXT
        );

        -- ── 风格与品牌：分表，不再存 JSON ──
        -- 存 JSON 时无法查询（"找与我风格相似的人"只能全表捞出来在应用层算），
        -- 分表后才能 JOIN 与建索引。
        CREATE TABLE user_styles (
          code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          style_id   TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (code, style_id)
        );
        CREATE INDEX idx_user_styles_style ON user_styles(style_id);

        CREATE TABLE user_brands (
          code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          brand_id   TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (code, brand_id)
        );
        CREATE INDEX idx_user_brands_brand ON user_brands(brand_id);

        -- ── 社区 ──
        CREATE TABLE posts (
          id                TEXT PRIMARY KEY,
          author_code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          title             TEXT NOT NULL,
          cover_hex         TEXT NOT NULL DEFAULT '#dddddd',
          tags              TEXT NOT NULL DEFAULT '[]',
          likes             INTEGER NOT NULL DEFAULT 0,
          linked_product_id TEXT,
          ratio             REAL NOT NULL DEFAULT 1,
          created_at        TEXT NOT NULL
        );
        CREATE INDEX idx_posts_author ON posts(author_code);
        CREATE INDEX idx_posts_created ON posts(created_at DESC);

        -- 评论：此前 posts.comments 只是个没人维护的计数器，
        -- 点进去什么都没有。现在建成真表，计数由它推导。
        CREATE TABLE comments (
          id          TEXT PRIMARY KEY,
          post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          author_code TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          text        TEXT NOT NULL,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX idx_comments_post ON comments(post_id, created_at);

        CREATE TABLE post_likes (
          post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (post_id, code)
        );
        CREATE INDEX idx_post_likes_code ON post_likes(code);

        -- ── 社交 ──
        CREATE TABLE follows (
          follower   TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          followee   TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (follower, followee)
        );
        CREATE INDEX idx_follows_followee ON follows(followee);

        CREATE TABLE blocks (
          blocker    TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          blocked    TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (blocker, blocked)
        );

        -- user_a / user_b 存「排序后的两个用户码」，配合唯一约束，
        -- 保证一对人只有一条会话（否则 A→B 与 B→A 会各建一条，消息分裂）
        CREATE TABLE conversations (
          id         TEXT PRIMARY KEY,
          user_a     TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          user_b     TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          UNIQUE (user_a, user_b)
        );
        CREATE INDEX idx_conv_a ON conversations(user_a);
        CREATE INDEX idx_conv_b ON conversations(user_b);

        CREATE TABLE messages (
          id         TEXT PRIMARY KEY,
          conv_id    TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          from_code  TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          text       TEXT NOT NULL,
          read_at    TEXT,
          recalled_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_messages_conv ON messages(conv_id, created_at);

        -- ── 交易 ──
        CREATE TABLE addresses (
          id         TEXT PRIMARY KEY,
          code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          name       TEXT NOT NULL,
          phone      TEXT NOT NULL,
          province   TEXT NOT NULL,
          city       TEXT NOT NULL DEFAULT '',
          district   TEXT NOT NULL DEFAULT '',
          detail     TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          tag        TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_addresses_code ON addresses(code);

        CREATE TABLE wardrobe (
          id         TEXT PRIMARY KEY,
          code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          product_id TEXT NOT NULL,
          color_id   TEXT NOT NULL DEFAULT '',
          size       TEXT NOT NULL DEFAULT '',
          source     TEXT NOT NULL DEFAULT 'manual',
          note       TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          UNIQUE (code, product_id, color_id, size)
        );

        -- 收藏与浏览历史：**补上外键**，帖子删除后不留悬空记录
        CREATE TABLE favorites (
          code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          PRIMARY KEY (code, post_id)
        );
        CREATE INDEX idx_favorites_post ON favorites(post_id);

        CREATE TABLE history (
          code      TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
          post_id   TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          viewed_at TEXT NOT NULL,
          PRIMARY KEY (code, post_id)
        );
        CREATE INDEX idx_history_viewed ON history(code, viewed_at DESC);
      `)
    },
  },
]

export function openDb(path: string): DB {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function currentVersion(db: DB): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return row?.user_version ?? 0
}

/**
 * 按版本号逐步升级。
 * 每一步都在事务里 —— 中途失败不会留下半截结构。
 */
export function migrate(db: DB): void {
  const from = currentVersion(db)
  const todo = MIGRATIONS.filter((m) => m.version > from).sort((a, b) => a.version - b.version)
  if (!todo.length) return

  for (const m of todo) {
    db.exec('BEGIN')
    try {
      m.up(db)
      // user_version 不支持参数绑定，只能拼字符串；版本号来自代码常量，无注入风险
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
      console.log(`[CDA] 已应用迁移 v${m.version}：${m.desc}`)
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`迁移 v${m.version} 失败：${(e as Error).message}`)
    }
  }
}

// ── 密码 ──────────────────────────────────────────────
// scrypt 加盐慢哈希，不用 MD5/SHA —— 抗彩虹表与暴力破解

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const a = scryptSync(password, salt, 64)
  const b = Buffer.from(hash, 'hex')
  // 长度不等时 timingSafeEqual 会抛，先挡掉
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ── 登录频率限制 ──────────────────────────────────────

const MAX_ATTEMPTS = 5
const LOCK_MS = 10 * 60 * 1000 // 锁 10 分钟

export interface AttemptCheck {
  allowed: boolean
  retryAfterSec?: number
  remaining?: number
}

/** 是否允许尝试登录 */
export function checkAttempts(db: DB, key: string): AttemptCheck {
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key) as any
  if (!row) return { allowed: true, remaining: MAX_ATTEMPTS }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000),
    }
  }
  return { allowed: true, remaining: Math.max(0, MAX_ATTEMPTS - row.count) }
}

/** 记录一次失败；达到阈值即锁定 */
export function recordFailure(db: DB, key: string): void {
  const now = nowIso()
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key) as any
  if (!row) {
    db.prepare('INSERT INTO login_attempts (key, count, first_at) VALUES (?,?,?)').run(key, 1, now)
    return
  }
  const count = row.count + 1
  const locked = count >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MS).toISOString() : null
  db.prepare('UPDATE login_attempts SET count = ?, locked_until = ? WHERE key = ?').run(count, locked, key)
}

/** 登录成功后清零 */
export function clearFailures(db: DB, key: string): void {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key)
}

// ── 用户码 ────────────────────────────────────────────
// 由数据库自增 seq 分配并加唯一约束，保证不撞号（前端生成会撞）

export function formatUserCode(seq: number): string {
  return `CDA_${String(seq).padStart(8, '0')}`
}

export function nextUserSeq(db: DB): number {
  const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM users').get() as { m: number }
  return (row?.m ?? 0) + 1
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}
