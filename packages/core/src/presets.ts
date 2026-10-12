/**
 * 形体风格预设。
 *
 * 定的是**形体语言**（肌肉感 vs 脂肪感），而不是具体尺寸 ——
 * 尺寸由用户的身型数据决定。两者分工明确：
 *   预设回答「这个人是偏肌肉还是偏脂肪」
 *   数据回答「这个人有多高、胸围多少」
 *
 * 早先做过一套「头身比」预设（写实/动漫/8 头身），已被移除 ——
 * 它更像是风格滤镜而不是建模依据，实际用起来很鸡肋。
 */
import type { BodyBuildId } from './types'

export interface BodyBuild {
  id: BodyBuildId
  name: string
  description: string
  /**
   * 肌肉隆起强度。
   * 1 = 基准；>1 肌腹更饱满分明；<1 肌肉被软组织覆盖、轮廓更柔。
   */
  muscleFactor: number
  /**
   * 脂肪堆积强度。
   * 主要堆在腹部、臀、大腿上段、上臂后侧 —— 这是真人脂肪的真实分布。
   */
  fatFactor: number
  /**
   * 形体圆润度 0..1。
   * 脂肪型肢体横截面更接近圆、过渡更糊；
   * 肌肉型横截面更扁、肌腹之间的分界更清楚。
   */
  softness: number
}

export const BODY_BUILDS: BodyBuild[] = [
  {
    id: 'average',
    name: '适中',
    description: '肌肉与脂肪都不过分，最通用的起始形体',
    muscleFactor: 1.0,
    fatFactor: 0.35,
    softness: 0.5,
  },
  {
    id: 'muscular',
    name: '肌肉',
    description: '肌腹饱满、线条分明，适合运动装与健身场景展示',
    muscleFactor: 1.85,
    fatFactor: 0.06,
    softness: 0.22,
  },
  {
    id: 'plump',
    name: '丰满',
    // 用户原话是「肥胖」，但产品里给用户贴这个标签不妥，改成中性表述
    description: '软组织丰满、轮廓圆润，腹部与臀腿体积明显',
    muscleFactor: 0.45,
    fatFactor: 1.65,
    softness: 0.85,
  },
]

export function findBuild(id: string): BodyBuild {
  return BODY_BUILDS.find((b) => b.id === id) ?? BODY_BUILDS[0]!
}
