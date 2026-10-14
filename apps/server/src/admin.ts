/**
 * 管理后台。
 *
 * 与用户体系**完全隔离**：独立表、独立 token、独立鉴权中间件。
 * 用户 token 换不到任何后台权限。
 *
 * 权限模型见 docs/管理后台设计.md：
 *   三级角色（owner / operator / viewer）+ 一张常量权限表。
 *   刻意不做细粒度 RBAC —— 我们 1~3 个人用，那样每加功能都要配权限。
 */
import type { ServerResponse } from 'node:http'
import type { DB } from './db.ts'
import {
  hashPassword, verifyPassword, nowIso, newId, newToken,
} from './db.ts'

export type AdminRole = 'owner' | 'operator' | 'viewer'

/**
 * 权限常量表。
 * 写死在代码里而不是进数据库：3 个角色 / 11 项权限，一眼看全；
 * 改权限走一次部署，有 Git 记录，比在界面上点更可追溯。
 */
export const ADMIN_PERMS: Record<AdminRole, readonly string[]> = {
  owner: [
    'admin.manage', 'invite.write', 'user.read', 'user.phone', 'user.disable',
    'user.delete', 'content.delete', 'report.handle', 'security.unlock',
    'audit.read', 'stats.read',
  ],
  operator: [
    'invite.write', 'user.read', 'user.phone', 'user.disable',
    'content.delete', 'report.handle', 'security.unlock', 'audit.read', 'stats.read',
  ],
  // 观察者只能看数据。手机号与审计日志对他完全不可见。
  viewer: ['user.read', 'stats.read'],
}

export function can(role: AdminRole, perm: string): boolean {
  return (ADMIN_PERMS[role] ?? []).includes(perm)
}

// ── 登录限流（比用户端更严：5 次锁 30 分钟）──
const MAX_ATTEMPTS = 5
const LOCK_MS = 30 * 60 * 1000

export function checkAdminAttempts(db: DB, key: string): { allowed: boolean; retryAfterSec?: number } {
  const row = db.prepare('SELECT * FROM admin_attempts WHERE key = ?').get(key) as any
  if (!row) return { allowed: true }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return { allowed: false, retryAfterSec: Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000) }
  }
  return { allowed: true }
}

export function recordAdminFailure(db: DB, key: string): void {
  const row = db.prepare('SELECT * FROM admin_attempts WHERE key = ?').get(key) as any
  if (!row) {
    db.prepare('INSERT INTO admin_attempts (key, count, first_at) VALUES (?,?,?)').run(key, 1, nowIso())
    return
  }
  const count = row.count + 1
  db.prepare('UPDATE admin_attempts SET count = ?, locked_until = ? WHERE key = ?')
    .run(count, count >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MS).toISOString() : null, key)
}

export function clearAdminFailures(db: DB, key: string): void {
  db.prepare('DELETE FROM admin_attempts WHERE key = ?').run(key)
}

// ── 会话 ──

export function issueAdminToken(db: DB, adminId: string, ip: string): string {
  const token = newToken()
  db.prepare('INSERT INTO admin_sessions (token, admin_id, ip, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(token, adminId, ip, nowIso(), new Date(Date.now() + 12 * 3600e3).toISOString()) // 后台会话 12 小时
  return token
}

/** 解析后台 token。用户 token 在这里一定解析不出来 —— 两张表是分开的 */
export function currentAdmin(db: DB, authHeader: string): any | null {
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return null
  const s = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(token) as any
  if (!s) return null
  if (new Date(s.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token)
    return null
  }
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(s.admin_id) as any
  if (!a || a.status !== 'active') return null
  return a
}

// ── 审计日志 ──

/**
 * 记一条审计日志。
 * **owner 也要记** —— 出事时「谁做的」必须查得到，不能有免审计的角色。
 */
export function audit(
  db: DB,
  admin: { id: string; username: string },
  action: string,
  target: string,
  detail: string,
  ip: string,
): void {
  db.prepare(`INSERT INTO admin_logs (id, admin_id, username, action, target, detail, ip, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    newId('log'), admin.id, admin.username, action, target, detail, ip, nowIso(),
  )
}

export function toAdmin(a: any): any {
  if (!a) return null
  return {
    id: a.id,
    username: a.username,
    displayName: a.display_name,
    role: a.role as AdminRole,
    status: a.status,
    lastLoginAt: a.last_login_at,
    createdAt: a.created_at,
    /** 前端据此显示/隐藏按钮。后端仍会独立校验，不信任前端 */
    perms: ADMIN_PERMS[a.role as AdminRole] ?? [],
  }
}

/** 初始化：没有任何管理员时，用环境变量创建第一个 owner */
export function seedOwner(db: DB): void {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM admins').get() as any).n
  if (n > 0) return
  const username = process.env.CDA_ADMIN_USER ?? 'admin'
  const password = process.env.CDA_ADMIN_PASS
  if (!password) {
    console.log('[CDA] 未设置 CDA_ADMIN_PASS，跳过创建初始管理员')
    return
  }
  if (password.length < 12) {
    console.log('[CDA] CDA_ADMIN_PASS 少于 12 位，拒绝创建（后台密码要求比用户端更严）')
    return
  }
  const { hash, salt } = hashPassword(password)
  db.prepare(`INSERT INTO admins (id, username, password_hash, password_salt, display_name, role, status, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    newId('adm'), username, hash, salt, '所有者', 'owner', 'active', nowIso(),
  )
  console.log(`[CDA] 已创建初始管理员：${username}（owner）`)
}

/** 统一的权限拒绝响应 */
export function deny(res: ServerResponse, perm: string): void {
  const body = JSON.stringify({ ok: false, error: `没有权限：${perm}` })
  res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}
