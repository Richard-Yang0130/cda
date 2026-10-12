/**
 * 应用级共享状态。
 *
 * 为什么用模块级 reactive 而不是 Pinia：
 *   1. demo 阶段状态很少（衣橱 + 身型 + 跨页传参），没必要引入依赖
 *   2. uni-app 页面之间是独立组件实例，模块级对象天然充当单例 store
 *   3. 后续要换成 Pinia 或接后端，只需把这几个函数改成 action，页面无需改
 */
import { reactive } from 'vue'
import { defaultBodyProfile, mockWardrobe, type BodyProfile, type WardrobeItem } from '@cda/core'

let seq = 0

export const store = reactive({
  /** 我的衣橱 */
  wardrobe: [...mockWardrobe] as WardrobeItem[],
  /** 身型数据，3D 试穿台与穿搭建议共用 */
  body: { ...defaultBodyProfile } as BodyProfile,
  /**
   * 从「穿搭建议」页点「在 3D 人偶上试穿」时写入，
   * 3D 试穿台 onShow 时读取并清空 —— 这是 uni-app 下最省事的跨页传参方式。
   */
  pendingOutfit: null as string[] | null,
})

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
