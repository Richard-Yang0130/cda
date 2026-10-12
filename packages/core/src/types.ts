/**
 * 「搭」CDA 领域模型
 *
 * 设计要点：把产品的三个差异化亮点直接建模进类型系统，
 * 而不是后期再补：
 *   亮点1 穿搭建议   -> WardrobeItem / OutfitSuggestion
 *   亮点2 3D 穿搭    -> BodyProfile / LayerState / WearMode / fastenerClosed
 *   亮点3 小饰品     -> Category 中的 accessory 系列 + bodySlot: 'neck' | 'waist' | 'head'
 */

/** 商品品类 */
export type Category =
  | 'top'        // 上装
  | 'bottom'     // 下装
  | 'outerwear'  // 外套
  | 'dress'      // 连衣裙
  | 'shoes'      // 鞋
  | 'bag'        // 包
  | 'hat'        // 帽子
  | 'accessory'  // 其他配饰

/** 3D 人偶上可挂载的部位 */
export type BodySlot = 'upper' | 'lower' | 'outer' | 'neck' | 'waist' | 'head'

/**
 * 品类中文名。
 * 抽成公共常量而不是各页面各写一份 —— 之前就因为漏翻译，
 * 界面上出现过「同为accessory，细节存在差异」这种中英混排的文案。
 */
export const CATEGORY_LABEL: Record<Category, string> = {
  top: '上装',
  bottom: '下装',
  outerwear: '外套',
  dress: '连衣裙',
  shoes: '鞋',
  bag: '包',
  hat: '帽子',
  accessory: '配饰',
}

/**
 * 穿法 —— 这是亮点2 Step2 的核心枚举。
 *
 * 注意：业界目前没有工程化方案能真实模拟这些状态（详见项目计划）。
 * 原型阶段用 morph target 预设姿态来表现，而非布料物理。
 */
export type WearMode =
  | 'worn'      // 正常穿进去
  | 'draped'    // 披在身上
  | 'wrapped'   // 围在脖子上
  | 'tied'      // 系在腰上
  | 'open'      // 敞开

/** 颜色选项 */
export interface ColorOption {
  id: string
  name: string
  hex: string
}

/** 商品 */
export interface Product {
  id: string
  title: string
  brand?: string
  category: Category
  /** 单位：分。避免浮点误差 */
  priceCents: number
  /** 平铺图（用于识别匹配与试穿输入） */
  flatImage: string
  /** 模特上身图（可选，用于效果对比） */
  modelImage?: string
  colors: ColorOption[]
  sizes: string[]
}

/** 性别。只影响体块轮廓（肩宽/腰臀比/胸廓/骨盆/四肢粗细），不做私密部位 */
export type Gender = 'male' | 'female'

/** 用户身型数据 —— 亮点2 的输入 */
export interface BodyProfile {
  gender: Gender

  // ── 基础 ──
  heightCm: number
  weightKg: number

  // ── 围度 ──
  /** 胸围 */
  chestCm: number
  waistCm: number
  hipCm: number
  /** 大臂围（放松状态） */
  upperArmCircCm: number
  /** 大腿围（根部最粗处） */
  thighCircCm: number

  // ── 长度与宽度 ──
  /** 肩宽：左右肩峰之间的距离 */
  shoulderWidthCm: number
  /** 上身长：肩线到胯 */
  torsoLengthCm: number
  /** 颈长：肩线到下巴 */
  neckLengthCm: number
  /** 大臂长：肩到肘 */
  upperArmCm: number
  /** 小臂长：肘到腕 */
  forearmCm: number
  /** 大腿长：胯到膝 */
  thighCm: number
  /** 小腿长：膝到踝 */
  calfCm: number
}

/** 用户拥有的一件单品 —— 亮点1 的数据基础 */
export interface WardrobeItem {
  id: string
  productId: string
  colorId: string
  size: string
  /** 来源：手工搜索 / 拍照识别 / 订单自动导入 */
  source: 'manual' | 'photo' | 'order'
  addedAt: string
  /** 用户对这件单品的备注，例如「袖口有点紧」 */
  note?: string
}

/** 人偶身上的一层穿搭 —— 亮点2 Step1/Step2 的状态 */
export interface OutfitLayer {
  /** 对应 WardrobeItem.id */
  wardrobeItemId: string
  bodySlot: BodySlot
  wearMode: WearMode
  /** 扣了几颗扣子；undefined 表示该单品无扣件 */
  fastenerClosed?: number
  /** 该单品总扣数，用于渲染扣子 UI */
  fastenerTotal?: number
  /** 图层顺序，值越大越靠外 */
  zIndex: number
}

/** 一套完整穿搭 */
export interface Outfit {
  id: string
  name: string
  layers: OutfitLayer[]
  createdAt: string
}

/** 穿搭建议 —— 亮点1 的输出 */
export interface OutfitSuggestion {
  id: string
  /** 参与建议的单品，对应 WardrobeItem.id */
  wardrobeItemIds: string[]
  /** 推荐理由，展示给用户 */
  reason: string
  /** 匹配度 0-1 */
  score: number
  /** 风格标签，例如「通勤」「休闲」 */
  styleTag?: string
}
