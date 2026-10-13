/**
 * 数据库：结构与迁移。
 *
 * 用 Node 24 内置的 node:sqlite —— **零 npm 依赖**。
 * 10 人规模用 SQLite 完全够；将来换 Postgres 只需替换这一层的实现，
 * 上层路由不感知。
 */
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export type DB = DatabaseSync

export function openDb(path: string): DB {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      code          TEXT PRIMARY KEY,
      seq           INTEGER UNIQUE,
      phone         TEXT UNIQUE,
      email         TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      nickname      TEXT NOT NULL,
      gender        TEXT NOT NULL DEFAULT 'female',
      birthday      TEXT NOT NULL DEFAULT '',
      avatar_hex    TEXT NOT NULL DEFAULT '#c9b8a8',
      styles        TEXT NOT NULL DEFAULT '[]',
      brands        TEXT NOT NULL DEFAULT '[]',
      status        TEXT NOT NULL DEFAULT 'active',
      region        TEXT NOT NULL DEFAULT '中国',
      privacy       TEXT NOT NULL DEFAULT '{}',
      last_seen_at  TEXT NOT NULL DEFAULT '',
      is_online     INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);

    -- 邀请码：没有短信资质，用邀请码控制注册
    CREATE TABLE IF NOT EXISTS invites (
      code       TEXT PRIMARY KEY,
      note       TEXT NOT NULL DEFAULT '',
      used_by    TEXT,
      used_at    TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id                TEXT PRIMARY KEY,
      author_code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
      title             TEXT NOT NULL,
      cover_hex         TEXT NOT NULL DEFAULT '#dddddd',
      tags              TEXT NOT NULL DEFAULT '[]',
      likes             INTEGER NOT NULL DEFAULT 0,
      comments          INTEGER NOT NULL DEFAULT 0,
      linked_product_id TEXT,
      ratio             REAL NOT NULL DEFAULT 1,
      created_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_code);

    CREATE TABLE IF NOT EXISTS post_likes (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      code    TEXT NOT NULL,
      PRIMARY KEY (post_id, code)
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower   TEXT NOT NULL,
      followee   TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower, followee)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      blocker    TEXT NOT NULL,
      blocked    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (blocker, blocked)
    );

    -- 会话表用有序的两个用户码做唯一键，避免同一对人出现两条会话
    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      user_a     TEXT NOT NULL,
      user_b     TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      conv_id    TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      from_code  TEXT NOT NULL,
      text       TEXT NOT NULL,
      read_at    TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_id, created_at);

    CREATE TABLE IF NOT EXISTS addresses (
      id         TEXT PRIMARY KEY,
      code       TEXT NOT NULL REFERENCES users(code) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      province   TEXT NOT NULL,
      city       TEXT NOT NULL,
      district   TEXT NOT NULL,
      detail     TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      tag        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_addresses_code ON addresses(code);

    CREATE TABLE IF NOT EXISTS wardrobe (
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

    CREATE TABLE IF NOT EXISTS favorites (
      code       TEXT NOT NULL,
      post_id    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (code, post_id)
    );

    CREATE TABLE IF NOT EXISTS history (
      code      TEXT NOT NULL,
      post_id   TEXT NOT NULL,
      viewed_at TEXT NOT NULL,
      PRIMARY KEY (code, post_id)
    );
  `)
}

// ── 密码 ──────────────────────────────────────────────
// 用 scrypt，不用 MD5/SHA —— 加盐 + 慢哈希，抗彩虹表与暴力破解

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

// ── 用户码 ────────────────────────────────────────────
// 由数据库自增 seq 分配，保证唯一（前端生成会撞号）

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
