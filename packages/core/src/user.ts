import type { Gender } from './types'

/**
 * 用户与账号模型。
 *
 * P0-2 的基础：用户码、登录方式、隐私设置、在线状态。
 * 这里先把**数据结构与规则**定住，接后端时只换数据源。
 */

export type LoginMethod = 'phone' | 'wechat' | 'qq' | 'email'

export const LOGIN_LABEL: Record<LoginMethod, string> = {
  phone: '手机号',
  wechat: '微信',
  qq: 'QQ',
  email: '邮箱',
}

/** 隐私设置（P0-2 设置页） */
export interface PrivacySettings {
  /** 不被其他用户搜索到 */
  hideFromSearch: boolean
  /** 隐藏在线状态与上次在线时间 */
  hideOnlineStatus: boolean
  /** 隐藏所在地区 */
  hideRegion: boolean
  /** 是否允许陌生人私聊 */
  allowStrangerMessage: boolean
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  hideFromSearch: false,
  hideOnlineStatus: false,
  hideRegion: false,
  allowStrangerMessage: true,
}

export interface UserProfile {
  /** 用户码，形如 CDA_00000001 */
  code: string
  nickname: string
  gender: Gender
  /** 生日 ISO 日期（YYYY-MM-DD）；年龄由它实时算出，不单独存 */
  birthday: string
  /** 头像：demo 用纯色，接入上传后换 URL */
  avatarHex: string
  avatarUrl?: string
  /** 已选风格 id（fashion.ts） */
  styles: string[]
  /** 已选品牌 id，**有序**，最多 MAX_FAVORITE_BRANDS 个 */
  brands: string[]
  loginMethod: LoginMethod
  createdAt: string
  privacy: PrivacySettings
  /** 国家与地区 */
  region: string
  /** 上次在线时间（ISO）；配合 isOnline 展示在线状态 */
  lastSeenAt: string
  isOnline: boolean
}

/** 用户码前缀与位数 */
export const USER_CODE_PREFIX = 'CDA_'
const USER_CODE_DIGITS = 8

/**
 * 生成用户码：CDA_00000001。
 *
 * ⚠️ 真实实现必须由**后端**分配并保证唯一（数据库自增或发号器），
 * 前端生成只用于 demo —— 多端并发时会撞号。
 */
export function formatUserCode(seq: number): string {
  return `${USER_CODE_PREFIX}${String(seq).padStart(USER_CODE_DIGITS, '0')}`
}

/** 由生日算年龄；生日为空返回 null */
export function ageFromBirthday(birthday: string, now = new Date()): number | null {
  if (!birthday) return null
  const b = new Date(birthday)
  if (Number.isNaN(b.getTime())) return null
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}

/** 在线状态文案（P0-2 要求展示在线或上次在线时间） */
export function presenceText(u: Pick<UserProfile, 'isOnline' | 'lastSeenAt' | 'privacy'>, now = new Date()): string {
  if (u.privacy.hideOnlineStatus) return ''
  if (u.isOnline) return '在线'
  if (!u.lastSeenAt) return ''
  const t = new Date(u.lastSeenAt)
  const diffMin = Math.floor((now.getTime() - t.getTime()) / 60000)
  if (diffMin < 1) return '刚刚在线'
  if (diffMin < 60) return `${diffMin} 分钟前在线`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h} 小时前在线`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前在线`
  return '很久未上线'
}

// ────────────────────────────────────────────────────────────
// 注册流程
// ────────────────────────────────────────────────────────────

export interface RegisterStep {
  id: number
  title: string
  /** 步骤副标题，告诉用户这一步在做什么 */
  hint: string
}

/** 6 步注册流程（P0-1） */
export const REGISTER_STEPS: RegisterStep[] = [
  { id: 1, title: '选择登录方式', hint: '用于创建账号与找回' },
  { id: 2, title: '昵称与性别', hint: '其他用户看到的就是这些' },
  { id: 3, title: '基础信息', hint: '生日与身型，用于尺码推荐' },
  { id: 4, title: '选择风格', hint: '可多选，用于推荐品牌与商品' },
  { id: 5, title: '选择品牌', hint: '最多 15 个，可搜索' },
  { id: 6, title: '上传头像', hint: '完成注册' },
]

/** 注册过程的草稿状态 */
export interface RegisterDraft {
  loginMethod: LoginMethod | null
  nickname: string
  gender: Gender | null
  birthday: string
  heightCm: number
  weightKg: number
  chestCm: number
  waistCm: number
  hipCm: number
  styles: string[]
  brands: string[]
  avatarHex: string
}

export function emptyDraft(): RegisterDraft {
  return {
    loginMethod: null,
    nickname: '',
    gender: null,
    birthday: '',
    heightCm: 165,
    weightKg: 55,
    chestCm: 86,
    waistCm: 68,
    hipCm: 92,
    styles: [],
    brands: [],
    avatarHex: '#c9b8a8',
  }
}

/** 每步是否可进入下一步 —— 集中在这里，避免 UI 各写一套校验 */
export function canAdvance(step: number, d: RegisterDraft, maxBrands: number): { ok: boolean; reason?: string } {
  switch (step) {
    case 1:
      return d.loginMethod ? { ok: true } : { ok: false, reason: '请选择一种登录方式' }
    case 2:
      if (!d.nickname.trim()) return { ok: false, reason: '请填写昵称' }
      if (d.nickname.trim().length < 2) return { ok: false, reason: '昵称至少 2 个字' }
      if (!d.gender) return { ok: false, reason: '请选择性别' }
      return { ok: true }
    case 3:
      if (!d.birthday) return { ok: false, reason: '请选择生日' }
      return { ok: true }
    case 4:
      return d.styles.length ? { ok: true } : { ok: false, reason: '至少选择一个风格' }
    case 5:
      if (!d.brands.length) return { ok: false, reason: '至少选择一个品牌' }
      if (d.brands.length > maxBrands) return { ok: false, reason: `最多选择 ${maxBrands} 个品牌` }
      return { ok: true }
    default:
      return { ok: true }
  }
}
