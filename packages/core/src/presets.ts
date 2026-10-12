/**
 * 角色比例预设。
 *
 * 为什么需要它：之前所有比例都由零散的身体数据推导，缺少一个**整体比例骨架**，
 * 结果就是「局部都对、整体不安逸」，只能靠反复盲调。
 *
 * 游戏捏人之所以好看，不是因为它能调，而是因为**默认值本身就按美学比例搭好了**
 * —— 用户只需要微调局部。这里就是把这套「起点」显式建模出来。
 *
 * 核心参数是**头身比（headCount）**：身高是头高的多少倍。
 * 它决定了整个人看上去是写实、纤长还是 Q 版，比任何单项围度都更能决定观感。
 */
import type { BodyProfile, Gender } from './types'

/** 各段长度，单位是「头高」。它们之和必须正好等于 headCount */
export interface PresetSegments {
  head: number
  neck: number
  torso: number
  thigh: number
  calf: number
  ankle: number
}

export interface BodyPreset {
  id: string
  name: string
  description: string
  /** 头身比：身高 ÷ 头高 */
  headCount: number
  segments: PresetSegments
  /** 头宽 ≈ 头高 × 该系数。动漫头更宽，写实头更窄长 */
  headWidthRatio: number
  /** 肩宽 = 多少个头宽 */
  shoulderHeadWidths: { female: number; male: number }
  /** 围度相对身高的系数：[胸围, 腰围, 臀围] */
  girth: { female: [number, number, number]; male: [number, number, number] }
  /** 四肢粗细系数（1 = 写实基准） */
  limbFactor: number
  /**
   * 肩到腕的长度 ÷ 身高。
   * 注意是**肩关节到手腕**，不含手掌。真人约 0.34 ——
   * 一开始写了 0.44，手臂长了 25%，人看起来像猿。
   */
  armSpanRatio: number
  /** 推导体重用的 BMI */
  bmi: { female: number; male: number }
  defaultHeight: { female: number; male: number }
}

export const BODY_PRESETS: BodyPreset[] = [
  {
    id: 'realistic',
    name: '写实',
    description: '7.5 头身。接近真人比例，适合做尺码参考',
    headCount: 7.5,
    segments: { head: 1, neck: 0.62, torso: 2.4, thigh: 1.83, calf: 1.3, ankle: 0.35 },
    headWidthRatio: 0.72,
    shoulderHeadWidths: { female: 2.46, male: 2.66 },
    girth: { female: [0.52, 0.405, 0.555], male: [0.545, 0.465, 0.54] },
    limbFactor: 1.0,
    armSpanRatio: 0.34,
    bmi: { female: 20, male: 22.5 },
    defaultHeight: { female: 165, male: 176 },
  },
  {
    id: 'fashion',
    name: '时装插画',
    description: '8.5 头身。腿长、纤细，时装画与走秀常见比例',
    headCount: 8.5,
    segments: { head: 1, neck: 0.7, torso: 2.6, thigh: 2.0, calf: 1.85, ankle: 0.35 },
    headWidthRatio: 0.68,
    shoulderHeadWidths: { female: 2.69, male: 2.94 },
    girth: { female: [0.5, 0.375, 0.545], male: [0.52, 0.44, 0.52] },
    limbFactor: 0.88,
    armSpanRatio: 0.35,
    bmi: { female: 18, male: 20 },
    defaultHeight: { female: 172, male: 183 },
  },
  {
    id: 'anime',
    name: '动漫',
    description: '7 头身。头略大、四肢纤细，二次元常见比例',
    headCount: 7.0,
    segments: { head: 1, neck: 0.45, torso: 2.15, thigh: 1.6, calf: 1.45, ankle: 0.35 },
    headWidthRatio: 0.86,
    shoulderHeadWidths: { female: 1.7, male: 1.91 },
    girth: { female: [0.48, 0.38, 0.52], male: [0.5, 0.43, 0.5] },
    limbFactor: 0.82,
    armSpanRatio: 0.32,
    bmi: { female: 17.5, male: 19.5 },
    defaultHeight: { female: 158, male: 170 },
  },
  {
    id: 'heroic',
    name: '游戏英雄',
    description: '8 头身。宽肩窄腰，动作游戏主角常见比例',
    headCount: 8.0,
    segments: { head: 1, neck: 0.55, torso: 2.45, thigh: 1.9, calf: 1.75, ankle: 0.35 },
    headWidthRatio: 0.72,
    shoulderHeadWidths: { female: 2.61, male: 2.93 },
    girth: { female: [0.5, 0.385, 0.545], male: [0.55, 0.45, 0.53] },
    limbFactor: 1.05,
    armSpanRatio: 0.36,
    bmi: { female: 19, male: 23 },
    defaultHeight: { female: 170, male: 182 },
  },
]

export function findPreset(id: string): BodyPreset {
  return BODY_PRESETS.find((p) => p.id === id) ?? BODY_PRESETS[0]!
}

/**
 * 由「预设 + 性别 + 身高」推出一整套身体数据。
 *
 * 注意各段之和恰好等于 headCount × 头高 = 身高，
 * 所以在引擎里不会再被归一化改动 —— 比例是稳的。
 */
export function buildProfileFromPreset(id: string, gender: Gender, heightCm?: number): BodyProfile {
  const preset = findPreset(id)
  const H = heightCm ?? preset.defaultHeight[gender]
  const headH = H / preset.headCount
  const s = preset.segments
  const seg = (n: number) => Math.round(n * headH * 10) / 10

  const [chest, waist, hip] = preset.girth[gender]
  // 肩宽：以头宽为基准（头宽 ≈ 头高 × 系数），这也是角色设计里的常用做法
  const headW = headH * preset.headWidthRatio
  const shoulderWidthCm = Math.round(preset.shoulderHeadWidths[gender] * headW * 10) / 10

  const chestCm = Math.round(H * chest * 10) / 10
  const hipCm = Math.round(H * hip * 10) / 10
  const armTotal = H * preset.armSpanRatio

  // 上臂/大腿围相对胸/臀推导，再乘四肢粗细系数
  const upperArmCircCm =
    Math.round(chestCm * (gender === 'male' ? 0.333 : 0.302) * preset.limbFactor * 10) / 10
  const thighCircCm =
    Math.round(hipCm * (gender === 'male' ? 0.589 : 0.565) * preset.limbFactor * 10) / 10

  return {
    gender,
    heightCm: H,
    weightKg: Math.round(((H / 100) ** 2 * preset.bmi[gender]) * 10) / 10,
    chestCm,
    waistCm: Math.round(H * waist * 10) / 10,
    hipCm,
    upperArmCircCm,
    thighCircCm,
    shoulderWidthCm,
    torsoLengthCm: seg(s.torso),
    neckLengthCm: seg(s.neck),
    // 上臂略长于小臂，接近真人
    upperArmCm: seg((armTotal / headH) * 0.55),
    forearmCm: seg((armTotal / headH) * 0.45),
    thighCm: seg(s.thigh),
    calfCm: seg(s.calf),
  }
}
