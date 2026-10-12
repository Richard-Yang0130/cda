/**
 * 穿搭建议引擎 —— 亮点1 的实现。
 *
 * 策略：**先用可解释的规则，不上深度学习**。
 * 理由：
 *   - demo 阶段没有真实用户行为数据，训练不出有意义的模型
 *   - 「为什么推荐这套」对用户比"更准"更重要，规则天然可解释
 *   - 后续接入真实数据后，规则结果可作为召回层，再叠加排序模型
 *
 * 评分由三部分组成：
 *   1. 色彩和谐度（权重最高）—— 决定一套搭配"顺不顺眼"
 *   2. 品类完整度 —— 有上装+下装（或连衣裙）才算一套
 *   3. 层次丰富度 —— 外套、配饰的加成
 */
import type { Category, OutfitSuggestion, Product, WardrobeItem } from '../types'

export interface OutfitEngineInput {
  wardrobe: WardrobeItem[]
  products: Product[]
  /** 最多返回几套，默认 5 */
  limit?: number
}

/** 品类在搭配中的角色 */
type Role = 'top' | 'bottom' | 'dress' | 'outerwear' | 'accessory'

const CATEGORY_ROLE: Record<Category, Role | null> = {
  top: 'top',
  bottom: 'bottom',
  dress: 'dress',
  outerwear: 'outerwear',
  accessory: 'accessory',
  bag: 'accessory',
  hat: 'accessory',
  shoes: null, // 鞋子不参与本次建议，避免组合爆炸
}

// ────────────────────────────────────────────────────────────
// 色彩工具
// ────────────────────────────────────────────────────────────

interface Hsl {
  h: number
  s: number
  l: number
}

/** #RRGGBB -> HSL（h: 0-360, s/l: 0-1） */
export function hexToHsl(hex: string): Hsl {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min

  if (d === 0) return { h: 0, s: 0, l }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60

  return { h, s, l }
}

/**
 * 两个颜色的和谐度 0..1。
 * 规则参考基础配色理论：无彩色万能，邻近色最稳，对比色有张力，冲突色扣分。
 */
export function colorHarmony(hexA: string, hexB: string): number {
  const a = hexToHsl(hexA)
  const b = hexToHsl(hexB)

  // 低饱和（黑白灰驼）与任何颜色都搭
  if (a.s < 0.16 || b.s < 0.16) return 0.85
  // 明度差过大时略降，避免"上白下黑"这类极端对比显得割裂
  const lightGap = Math.abs(a.l - b.l)

  const raw = Math.abs(a.h - b.h)
  const diff = Math.min(raw, 360 - raw)

  let base: number
  if (diff < 25) base = 0.62        // 同色系，安全但平淡
  else if (diff < 70) base = 0.95   // 邻近色，最讨喜
  else if (diff < 130) base = 0.6   // 中性，略跳
  else if (diff < 215) base = 0.9   // 对比色，有张力
  else base = 0.5                   // 其余，容易冲突

  // 明度差过大扣一点分
  return Math.max(0, Math.min(1, base - Math.max(0, lightGap - 0.55) * 0.5))
}

// ────────────────────────────────────────────────────────────
// 建议生成
// ────────────────────────────────────────────────────────────

interface Piece {
  item: WardrobeItem
  product: Product
  colorHex: string
  role: Role
}

function resolvePieces(wardrobe: WardrobeItem[], products: Product[]): Piece[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  const out: Piece[] = []

  for (const item of wardrobe) {
    const product = byId.get(item.productId)
    if (!product) continue
    const role = CATEGORY_ROLE[product.category]
    if (!role) continue
    const colorHex = product.colors.find((c) => c.id === item.colorId)?.hex ?? product.colors[0]?.hex ?? '#cccccc'
    out.push({ item, product, colorHex, role })
  }
  return out
}

function averageHarmony(pieces: Piece[]): number {
  if (pieces.length < 2) return 0.7
  let sum = 0
  let n = 0
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      sum += colorHarmony(pieces[i]!.colorHex, pieces[j]!.colorHex)
      n++
    }
  }
  return n ? sum / n : 0.7
}

function styleTagOf(pieces: Piece[]): string {
  const hasOuter = pieces.some((p) => p.role === 'outerwear')
  const avgSat =
    pieces.reduce((acc, p) => acc + hexToHsl(p.colorHex).s, 0) / Math.max(1, pieces.length)
  if (hasOuter && avgSat < 0.3) return '通勤'
  if (avgSat >= 0.45) return '亮眼'
  if (pieces.some((p) => p.role === 'accessory')) return '有细节'
  return '日常'
}

function describe(pieces: Piece[], harmony: number): string {
  const names = pieces.map((p) => p.product.title)
  const head = names.length > 1 ? `${names.slice(0, -1).join(' + ')} + ${names[names.length - 1]}` : names[0]

  let colorComment: string
  if (harmony >= 0.88) colorComment = '色彩关系非常协调'
  else if (harmony >= 0.75) colorComment = '配色稳妥耐看'
  else if (harmony >= 0.65) colorComment = '配色偏安全，可在配饰上做亮点'
  else colorComment = '对比强烈，适合想突出个性的场合'

  const accessory = pieces.find((p) => p.role === 'accessory')
  const tail = accessory ? `；用「${accessory.product.title}」收个尾` : ''

  return `${head}，${colorComment}${tail}。`
}

/**
 * 生成穿搭建议。
 * 组合方式：连衣裙单穿，或上装×下装；再各自叠加外套与配饰。
 */
export function suggestOutfits(input: OutfitEngineInput): OutfitSuggestion[] {
  const { wardrobe, products, limit = 5 } = input
  const pieces = resolvePieces(wardrobe, products)

  const pick = (role: Role) => pieces.filter((p) => p.role === role)
  const tops = pick('top')
  const bottoms = pick('bottom')
  const dresses = pick('dress')
  const outers = pick('outerwear')
  const accessories = pick('accessory')

  const bases: Piece[][] = []
  for (const d of dresses) bases.push([d])
  for (const t of tops) for (const b of bottoms) bases.push([t, b])

  const suggestions: OutfitSuggestion[] = []
  let seq = 0

  const MAX_COMBOS = 240
  for (const base of bases) {
    // 外套可选：不穿 / 穿其中一件
    const outerOptions: (Piece | null)[] = [null, ...outers]
    for (const outer of outerOptions) {
      // 配饰可选：不带 / 带其中一件
      const accOptions: (Piece | null)[] = [null, ...accessories]
      for (const acc of accOptions) {
        if (suggestions.length > MAX_COMBOS) break
        const combo = [...base, ...(outer ? [outer] : []), ...(acc ? [acc] : [])]

        const harmony = averageHarmony(combo)
        // 完整度：有上装+下装 或 连衣裙 = 1.0
        const completeness = base.length >= 2 || base[0]?.role === 'dress' ? 1 : 0.5
        // 层次：外套 +0.1，配饰 +0.06
        const layering = Math.min(1, 0.8 + (outer ? 0.12 : 0) + (acc ? 0.08 : 0))

        const score = harmony * 0.62 + completeness * 0.24 + layering * 0.14

        suggestions.push({
          id: `sug_${seq++}`,
          wardrobeItemIds: combo.map((c) => c.item.id),
          reason: describe(combo, harmony),
          score: Math.round(score * 100) / 100,
          styleTag: styleTagOf(combo),
        })
      }
    }
  }

  // 去重（同一个单品集合只留最高分），并按分数降序
  const best = new Map<string, OutfitSuggestion>()
  for (const s of suggestions) {
    const key = [...s.wardrobeItemIds].sort().join('|')
    const prev = best.get(key)
    if (!prev || s.score > prev.score) best.set(key, s)
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}
