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
/*
 * ⚠️ 教训：这个脚本原先**每天只跑一次**（04:00）。
 * 有一天在 04:00 之后误删了 3 个刚注册的用户，
 * 备份里根本没有他们，WAL 也已 checkpoint，**数据完全找不回来**。
 *
 * 所以现在分两档：
 *   - 每次运行都留一份，保留最近 48 份（配合小时级定时器 = 48 小时）
 *   - 每天 04:00 那份额外标记为 daily，保留 14 天
 * 高频备份 + 长周期备份并存，代价只是几十 MB 磁盘。
 */
const KEEP_RECENT = 48

mkdirSync(DIR, { recursive: true })
const now = new Date()
const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
// 每天 04:00 那一份标记为 daily，长期保留
const isDaily = now.getHours() === 4
const out = join(DIR, `cda-${isDaily ? 'daily-' : ''}${stamp}.db`)

const db = new DatabaseSync(DB, { readOnly: true })
db.exec(`VACUUM INTO '${out}'`)
const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
const posts = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n
const msgs = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
db.close()

const size = (statSync(out).size / 1024).toFixed(0)
console.log(`[备份] ${out}  ${size}KB  用户 ${users} 帖子 ${posts} 消息 ${msgs}`)

// 清理：hourly 只留最近 KEEP_RECENT 份，daily 留 KEEP_DAYS 天
const all = readdirSync(DIR).filter((f) => f.startsWith('cda-') && f.endsWith('.db'))
const hourly = all.filter((f) => !f.startsWith('cda-daily-')).sort().reverse()
const daily = all.filter((f) => f.startsWith('cda-daily-'))
let removed = 0
for (const f of hourly.slice(KEEP_RECENT)) { unlinkSync(join(DIR, f)); removed++ }
const cutoff = Date.now() - KEEP_DAYS * 864e5
for (const f of daily) {
  const p = join(DIR, f)
  if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); removed++ }
}
if (removed) console.log(`[备份] 已清理 ${removed} 个过期备份（近期保留 ${KEEP_RECENT} 份 / 每日保留 ${KEEP_DAYS} 天）`)
