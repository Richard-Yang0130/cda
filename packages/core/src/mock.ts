/**
 * 本地假数据 —— demo 阶段不接后端，先用这里的静态数据跑通交互。
 * 后续接入真实 API 时，只需把这里替换为请求层，上层组件不用改。
 */
import type { Product, WardrobeItem, BodyProfile, Gender } from './types'
import { buildProfileFromPreset } from './presets'

export const mockProducts: Product[] = [
  {
    id: 'p_white_shirt',
    title: '基础款棉质白衬衫',
    brand: 'CDA Basics',
    category: 'top',
    priceCents: 29900,
    flatImage: '/static/products/white-shirt.png',
    colors: [
      { id: 'white', name: '纯白', hex: '#FFFFFF' },
      { id: 'blue', name: '浅蓝', hex: '#A8C4E0' },
    ],
    dimensions: {
      // 棉质衬衫料很薄
      thicknessMm: 0.35,
      lengthCm: 68,
      shoulderCm: 40,
      chestCm: 100,
      hemCm: 102,
      sleeveCm: 58,
      cuffCm: 22,
      necklineCm: 38,
    },
    sizes: ['S', 'M', 'L', 'XL'],
  },
  {
    id: 'p_denim_jacket',
    title: '复古水洗牛仔外套',
    brand: 'CDA Basics',
    category: 'outerwear',
    priceCents: 59900,
    flatImage: '/static/products/denim-jacket.png',
    colors: [
      { id: 'lightblue', name: '浅水洗', hex: '#8FB4D9' },
      { id: 'darkblue', name: '深水洗', hex: '#2E4A6B' },
    ],
    dimensions: {
      // 牛仔厚实，是衬衫的三倍多 —— 叠穿时层间距靠它算
      thicknessMm: 1.2,
      lengthCm: 62,
      shoulderCm: 44,
      chestCm: 108,
      hemCm: 100,
      sleeveCm: 60,
      cuffCm: 24,
      necklineCm: 42,
    },
    sizes: ['S', 'M', 'L'],
  },
  {
    id: 'p_wide_trousers',
    title: '高腰阔腿西裤',
    brand: 'CDA Basics',
    category: 'bottom',
    priceCents: 39900,
    flatImage: '/static/products/wide-trousers.png',
    colors: [
      { id: 'black', name: '经典黑', hex: '#1A1A1A' },
      { id: 'beige', name: '燕麦色', hex: '#D9CDBB' },
    ],
    dimensions: {
      thicknessMm: 0.5,
      outseamCm: 100,
      inseamCm: 72,
      waistCm: 72,
      hipCm: 100,
      legOpeningCm: 52,
    },
    sizes: ['S', 'M', 'L'],
  },
  {
    id: 'p_knit_scarf',
    title: '羊毛混纺围巾',
    brand: 'CDA Basics',
    category: 'accessory',
    priceCents: 19900,
    flatImage: '/static/products/knit-scarf.png',
    colors: [
      { id: 'camel', name: '驼色', hex: '#C19A6B' },
      { id: 'grey', name: '烟灰', hex: '#8A8A8A' },
    ],
    dimensions: {
      // 羊毛混纺，很厚
      thicknessMm: 3.5,
      lengthCm: 180,
    },
    sizes: ['均码'],
  },
]

/**
 * 默认身型。
 *
 * 现在委托给「写实」预设 —— 比例由头身比统一推导，
 * 而不是散落的魔法数字。用户可在预设基础上微调。
 */
export function defaultBodyProfile(gender: Gender = 'female'): BodyProfile {
  return buildProfileFromPreset('realistic', gender)
}

/** 用户衣橱（演示用） */
export const mockWardrobe: WardrobeItem[] = [
  {
    id: 'w_1',
    productId: 'p_white_shirt',
    colorId: 'white',
    size: 'M',
    source: 'order',
    addedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 'w_2',
    productId: 'p_denim_jacket',
    colorId: 'lightblue',
    size: 'M',
    source: 'manual',
    addedAt: '2026-09-10T10:00:00.000Z',
  },
  {
    id: 'w_3',
    productId: 'p_wide_trousers',
    colorId: 'beige',
    size: 'M',
    source: 'photo',
    addedAt: '2026-09-18T10:00:00.000Z',
  },
  {
    id: 'w_4',
    productId: 'p_knit_scarf',
    colorId: 'camel',
    size: '均码',
    source: 'manual',
    addedAt: '2026-09-20T10:00:00.000Z',
  },
]

export function findProduct(id: string): Product | undefined {
  return mockProducts.find((p) => p.id === id)
}

/** 分 -> 元，用于展示 */
export function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}
