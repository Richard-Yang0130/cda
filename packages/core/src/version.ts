/**
 * 版本与更新日志。
 *
 * 目的：用户升级后要**感知到改了什么** —— 打开 App 弹一次更新说明。
 *
 * 规则：
 *   - 只弹一次（记住用户已读到的版本号）
 *   - 首次安装不弹（没有「升级」这回事）
 *   - 跳版本升级时，把中间所有版本的说明一起展示
 */

export const APP_VERSION = '1.0.0-beta'
export const APP_NAME = '搭 · CDA'

export interface ReleaseNote {
  version: string
  date: string
  /** 本次更新要点，面向用户表述（不是 commit message） */
  highlights: string[]
  /** 是否为重要更新，展示时加重 */
  major?: boolean
}

/**
 * 更新日志（新版本加在最前面）。
 *
 * ⚠️ 发版流程：改 APP_VERSION，并在数组头部加一条同版本的记录。
 * 两者不一致时 shouldShowRelease 不会弹窗 —— 这是有意的，
 * 避免出现「版本变了但没写说明」的静默升级。
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.0.0-beta',
    date: '2025-01-01',
    major: true,
    highlights: [
      '首个内测版本，面向合伙人开放',
      '6 步注册：登录方式、资料、身型、风格、品牌、头像',
      '风格与品牌推荐：8 种风格、150+ 品牌，可按名称搜索',
      '穿搭社区：浏览帖子、发布动态、看中即可试穿或购买',
      '消息：会话列表、私聊、历史消息、用户搜索',
      '个人主页：我的收藏、关注、浏览历史、收货地址',
      '隐私设置：不被搜索到、隐藏在线状态与地区',
    ],
  },
]

export const VERSION_STORAGE_KEY = 'cda.lastSeenVersion'

export function findNote(version: string): ReleaseNote | undefined {
  return RELEASE_NOTES.find((n) => n.version === version)
}

/** 版本号比较：a 是否比 b 新（支持 1.2.3 / 1.2.3-beta 形式） */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.split('-')[0]!.split('.').map((x) => parseInt(x, 10) || 0)
  const [A, B] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0
    const y = B[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export interface ReleaseCheck {
  /** 需要展示的更新说明（可能多条，跨版本升级时） */
  notes: ReleaseNote[]
  /** 是否应该弹窗 */
  show: boolean
}

/**
 * 判断是否需要展示更新说明。
 * @param lastSeen 用户上次看过的版本号；null 表示首次安装
 */
export function checkRelease(lastSeen: string | null): ReleaseCheck {
  // 首次安装：没有升级可言，不弹
  if (!lastSeen) return { notes: [], show: false }
  // 版本没变：不弹
  if (lastSeen === APP_VERSION) return { notes: [], show: false }
  // 用户看过的版本比当前还新（降级/异常）：不弹，避免困惑
  if (isNewer(lastSeen, APP_VERSION)) return { notes: [], show: false }

  // 跨版本升级：把 lastSeen 之后的所有版本说明都拿出来
  const idx = RELEASE_NOTES.findIndex((n) => n.version === lastSeen)
  const notes = idx >= 0 ? RELEASE_NOTES.slice(0, idx) : RELEASE_NOTES.slice(0, 1)
  return { notes, show: notes.length > 0 }
}
