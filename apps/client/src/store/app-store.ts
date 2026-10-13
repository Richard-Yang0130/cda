/**
 * 应用级共享状态。
 *
 * 为什么用模块级 reactive 而不是 Pinia：
 *   1. demo 阶段状态很少（衣橱 + 身型 + 跨页传参），没必要引入依赖
 *   2. uni-app 页面之间是独立组件实例，模块级对象天然充当单例 store
 *   3. 后续要换成 Pinia 或接后端，只需把这几个函数改成 action，页面无需改
 */
import { reactive } from 'vue'
import {
  createBodyState, deriveProfile, defaultBodyProfile, mockWardrobe,
  formatUserCode, DEFAULT_PRIVACY,
  type Address, type BodyState, type Gender, type UserProfile, type WardrobeItem,
} from '@cda/core'
import { api, getToken, setToken } from '@/api/client'

let seq = 0

export const store = reactive({
  /** 我的衣橱 */
  wardrobe: [...mockWardrobe] as WardrobeItem[],
  /** 身型数据（派生结果），3D 试穿台与穿搭建议共用 */
  body: defaultBodyProfile('female'),
  /**
   * 身型**可编辑状态**（体脂因子 + 骨骼参数）。
   *
   * 身型编辑已从试穿页搬到「个人主页 → 我的人偶」，
   * 而 uni-app 的页面是独立实例，所以状态必须放在这里才能跨页共享。
   * 用户不会频繁改身型，所以编辑是低频入口，但状态要一直带着。
   */
  bodyState: createBodyState('female') as BodyState,
  /** 是否已完成过首次创建（决定「我的人偶」显示"创建"还是"修改"） */
  personaCreated: false,

  /**
   * 当前登录用户。null = 未注册/未登录。
   * 注册流程走完第 6 步后写入，并落盘。
   */
  user: null as UserProfile | null,
  /** 收货地址（P0：开源商城系统全都有，我们此前缺失） */
  addresses: [] as Address[],
  /**
   * 从「穿搭建议」页点「在 3D 人偶上试穿」时写入，
   * 3D 试穿台 onShow 时读取并清空 —— 这是 uni-app 下最省事的跨页传参方式。
   */
  pendingOutfit: null as string[] | null,
})

const STORAGE_KEY = 'cda.bodyState.v1'

/** 把身型状态同步到派生档案，并落盘 */
export function commitBodyState(next: BodyState): void {
  store.bodyState = next
  Object.assign(store.body, deriveProfile(next))
  store.personaCreated = true
  try {
    uni.setStorageSync(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 存储不可用（隐私模式等）不应影响使用，静默降级
  }
}

/** 启动时恢复上次保存的身型 */
export function restoreBodyState(): void {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw as string) as BodyState
    if (parsed && parsed.frame && typeof parsed.adiposity === 'number') {
      store.bodyState = parsed
      Object.assign(store.body, deriveProfile(parsed))
      store.personaCreated = true
    }
  } catch {
    // 解析失败就用默认值
  }
}

export function addWardrobeItem(input: {
  productId: string
  colorId: string
  size: string
  source: WardrobeItem['source']
  note?: string
}): WardrobeItem {
  const item: WardrobeItem = {
    id: `w_${Date.now().toString(36)}_${seq++}`,
    addedAt: new Date().toISOString(),
    ...input,
  }
  store.wardrobe.push(item)
  return item
}

export function removeWardrobeItem(id: string): void {
  const index = store.wardrobe.findIndex((w) => w.id === id)
  if (index >= 0) store.wardrobe.splice(index, 1)
}

/** 同一件商品是否已在衣橱里（避免重复添加） */
export function hasProduct(productId: string): boolean {
  return store.wardrobe.some((w) => w.productId === productId)
}

const USER_KEY = 'cda.user.v1'

/**
 * 用后端返回的用户对象覆盖本地状态。
 * 后端字段与前端保持一致（都在 core 的 UserProfile 里定义），
 * 所以这里不做字段映射，只补默认值。
 */
export function applyServerUser(u: Partial<UserProfile> | null): void {
  if (!u) return
  store.user = { ...DEFAULT_PRIVACY_USER(), ...u } as UserProfile
  try {
    uni.setStorageSync(USER_KEY, JSON.stringify(store.user))
  } catch {
    /* 忽略 */
  }
}

function DEFAULT_PRIVACY_USER(): Partial<UserProfile> {
  return { privacy: { ...DEFAULT_PRIVACY }, status: 'active' }
}

/** 注册完成：写入用户并落盘 */
export function commitUser(u: UserProfile): void {
  store.user = u
  try {
    uni.setStorageSync(USER_KEY, JSON.stringify(u))
  } catch {
    // 存储不可用时静默降级
  }
}

export function restoreUser(): void {
  try {
    const raw = uni.getStorageSync(USER_KEY)
    if (!raw) return
    const u = JSON.parse(raw as string) as UserProfile
    if (u && u.code && u.nickname) {
      store.user = { ...u, privacy: { ...DEFAULT_PRIVACY, ...u.privacy } }
    }
  } catch {
    // 解析失败当作未登录
  }
}

// ── 收货地址 ──
const ADDR_KEY = 'cda.addresses.v1'

function persistAddresses(): void {
  try {
    uni.setStorageSync(ADDR_KEY, JSON.stringify(store.addresses))
  } catch {
    /* 存储不可用时静默降级 */
  }
}

export function restoreAddresses(): void {
  try {
    const raw = uni.getStorageSync(ADDR_KEY)
    if (raw) store.addresses = JSON.parse(raw as string) as Address[]
  } catch {
    /* 忽略 */
  }
}

/** 新增或更新地址；设为默认时自动取消其它默认 */
export function upsertAddress(a: Address): void {
  const i = store.addresses.findIndex((x) => x.id === a.id)
  if (a.isDefault) store.addresses.forEach((x) => (x.isDefault = false))
  if (i >= 0) store.addresses.splice(i, 1, a)
  else store.addresses.push(a)
  // 若一个默认都没有，把第一条设为默认
  if (!store.addresses.some((x) => x.isDefault) && store.addresses.length) {
    store.addresses[0]!.isDefault = true
  }
  persistAddresses()
}

export function removeAddress(id: string): void {
  const i = store.addresses.findIndex((x) => x.id === id)
  if (i < 0) return
  const wasDefault = store.addresses[i]!.isDefault
  store.addresses.splice(i, 1)
  if (wasDefault && store.addresses.length) store.addresses[0]!.isDefault = true
  persistAddresses()
}

export function setDefaultAddress(id: string): void {
  store.addresses.forEach((x) => (x.isDefault = x.id === id))
  persistAddresses()
}

export function defaultAddress(): Address | undefined {
  return store.addresses.find((a) => a.isDefault) ?? store.addresses[0]
}

/**
 * 登出。
 * 先通知后端作废 token，再清本地 —— 顺序反了的话，
 * 本地 token 已丢，后端那条 session 就永远留在库里了。
 */
export async function logoutAndClear(): Promise<void> {
  try {
    if (getToken()) await api.logout()
  } catch {
    // 网络失败也照常清本地，不能让用户卡在登录态
  }
  setToken('')
  store.user = null
  try {
    uni.removeStorageSync(USER_KEY)
  } catch {
    /* 忽略 */
  }
}

export function logout(): void {
  store.user = null
  setToken('')
  try {
    uni.removeStorageSync(USER_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 获取下一个用户码（demo 用；真实实现必须由后端发号） */
export function nextUserCode(): string {
  let seq = 1
  try {
    const raw = uni.getStorageSync('cda.userSeq')
    seq = (raw ? parseInt(String(raw), 10) : 0) + 1
    if (!Number.isFinite(seq) || seq < 1) seq = 1
    uni.setStorageSync('cda.userSeq', String(seq))
  } catch {
    seq = Math.floor(Math.random() * 9999) + 1
  }
  return formatUserCode(seq)
}

/** 当前身型对应的性别（供按性别取网格用） */
export function currentGender(): Gender {
  return store.bodyState.gender
}
