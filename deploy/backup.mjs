/**
 * 每日备份。
 *
 * ⚠️ 不能直接 cp 数据库文件 —— SQLite 开着 WAL，运行时磁盘上的 .db
 * 可能只包含部分已提交的数据，拷出来的副本可能是坏的。
 * VACUUM INTO 会生成一个**一致且已整理**的新库，是官方推荐的在线备份方式。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const DB = '/opt/cda/data/cda.db'
const DIR = '/opt/cda/backups'
const KEEP_DAYS = 14

mkdirSync(DIR, { recursive: true })
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
const out = join(DIR, `cda-${stamp}.db`)

const db = new DatabaseSync(DB, { readOnly: true })
db.exec(`VACUUM INTO '${out}'`)
const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
const posts = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n
const msgs = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
db.close()

const size = (statSync(out).size / 1024).toFixed(0)
console.log(`[备份] ${out}  ${size}KB  用户 ${users} 帖子 ${posts} 消息 ${msgs}`)

// 清理过期备份
const cutoff = Date.now() - KEEP_DAYS * 864e5
let removed = 0
for (const f of readdirSync(DIR)) {
  if (!f.startsWith('cda-') || !f.endsWith('.db')) continue
  const p = join(DIR, f)
  if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); removed++ }
}
if (removed) console.log(`[备份] 已清理 ${removed} 个过期备份（保留 ${KEEP_DAYS} 天）`)
