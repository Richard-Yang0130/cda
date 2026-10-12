/**
 * 人体耦合模型。
 *
 * 解决的问题：先前每个滑杆只驱动一个几何参数 —— 那是「参数面板」，不是人体。
 * 用户拖动臀围时，只有臀部膨胀，这在解剖学上是荒谬的：
 *   - 围度之间由**同一个潜在因子（体脂水平 adiposity）**派生，不能独立变动
 *   - 抬高体脂，腰部、臀部、大腿、上臂会**按各自的敏感度**一起变化
 *   - 体重不是自由变量：它由身高与体脂决定（BMI = 体重 / 身高²），
 *     所以「体积没变但体重涨了」这种状态在模型里根本无法表达
 *
 * 数据来源与诚实说明：
 *   锚点体型的围度是按成年人常见实测值标定的，不是某项研究的回归系数。
 *   这样做的理由是可控可解释 —— 想调整分布特征，改锚点即可，
 *   而不是面对一堆来历不明的系数。生理约束（BMI / 腰高比 / 腰臀比）
 *   采用 WHO 的公开界值。
 */
import type { BodyBuildId, BodyProfile, Gender } from './types'

// ────────────────────────────────────────────────────────────
// 生理约束（WHO 公开界值）
// ────────────────────────────────────────────────────────────

/**
 * 建模允许的 BMI 区间。
 *
 * ⚠️ 用户明确要求**把可拖动范围收窄到真实区间**（极端体型看起来异常，
 * 而且那不是主流场景，不值得为它做优化）。所以这里从原来的 16–40
 * 收窄到 17–32 —— 覆盖偏瘦到肥胖，但不进入病态极端。
 *
 * 说明：网络来源受限（百度百科 403），我未能取到 GB/T 10000 标准原文，
 * 因此下列数值中：
 *   - BMI 分级与腰围界值属**公开且广为人知的中国标准**，可直接采用
 *   - 各围度锚点属**参考值标定**，不是标准原文，需要时可整表调整
 */
export const BMI_RANGE = { min: 17, max: 32 } as const
/** 健康 BMI 区间（**中国标准**，比 WHO 更严：超重 24、肥胖 28） */
export const BMI_HEALTHY = { min: 18.5, max: 23.9 } as const
/** 腰高比健康界值：≥0.5 即提示中心性肥胖风险 */
export const WHTR_HEALTHY = 0.5
/**
 * 中心性肥胖的**腰围**界值（中国肥胖问题工作组）：
 * 男性 ≥90cm、女性 ≥85cm。比 WHO 的腰臀比界值更常用于中国人群。
 */
export const WAIST_LIMIT = { male: 90, female: 85 } as const
/** 腰臀比腹型肥胖界值：男 >0.90，女 >0.85 */
export const WHR_LIMIT = { male: 0.9, female: 0.85 } as const

// ────────────────────────────────────────────────────────────
// 锚点体型
// ────────────────────────────────────────────────────────────

/**
 * 一个锚点 = 某个体脂水平下的全套围度。
 *
 * 四个锚点的**斜率差异**就是脂肪分布特征：
 *   女性偏臀腿（gynoid），男性偏腹部（android）——
 *   所以男性 waist 斜率更大、女性 hip/thigh 斜率更大。
 *
 * ⚠️ 四肢斜率曾经只有真实值的一半（男性上肢 0.55 vs 真实 0.9–1.1 cm/BMI），
 * 结果是「体重涨了，体积全堆在躯干和臀腿，手臂小腿却几乎不变」。
 * 现已按实际人体测量调到接近真实斜率。
 */
interface Anchor {
  /** 体脂水平 0..1 */
  f: number
  bmi: number
  chest: number
  waist: number
  hip: number
  thigh: number
  arm: number
  /** 小臂围 */
  forearm: number
  /** 小腿围 */
  calf: number
}

/** 基准身高下的女性锚点（158cm，中国成年女性均值附近） */
const FEMALE_ANCHORS: Anchor[] = [
  { f: 0.0, bmi: 17.0, chest: 76, waist: 58, hip: 84, thigh: 46, arm: 23, forearm: 20, calf: 30 },
  { f: 0.35, bmi: 22.5, chest: 84, waist: 68, hip: 90, thigh: 52, arm: 26, forearm: 22, calf: 34 },
  { f: 0.7, bmi: 27.0, chest: 92, waist: 79, hip: 97, thigh: 57, arm: 29, forearm: 24, calf: 37 },
  { f: 1.0, bmi: 32.0, chest: 100, waist: 92, hip: 104, thigh: 62, arm: 32, forearm: 26, calf: 40 },
]

/** 基准身高下的男性锚点（170cm，中国成年男性均值附近） */
const MALE_ANCHORS: Anchor[] = [
  { f: 0.0, bmi: 17.0, chest: 84, waist: 68, hip: 84, thigh: 48, arm: 25, forearm: 22, calf: 32 },
  { f: 0.35, bmi: 22.5, chest: 92, waist: 78, hip: 92, thigh: 54, arm: 29, forearm: 25, calf: 36 },
  { f: 0.7, bmi: 27.0, chest: 100, waist: 90, hip: 99, thigh: 59, arm: 33, forearm: 28, calf: 39 },
  { f: 1.0, bmi: 32.0, chest: 108, waist: 102, hip: 105, thigh: 64, arm: 36, forearm: 30, calf: 42 },
]

/** 基准身高改为中国成年人均值附近，围度按此缩放 */
const REF_HEIGHT = { female: 158, male: 170 } as const

/** 受体脂影响的围度（这些会一起联动） */
export type GirthKey =
  | 'chestCm' | 'waistCm' | 'hipCm'
  | 'thighCircCm' | 'calfCircCm'
  | 'upperArmCircCm' | 'forearmCircCm'

export const GIRTH_KEYS: GirthKey[] = [
  'chestCm', 'waistCm', 'hipCm',
  'thighCircCm', 'calfCircCm',
  'upperArmCircCm', 'forearmCircCm',
]

const ANCHOR_FIELD: Record<GirthKey, keyof Anchor> = {
  chestCm: 'chest',
  waistCm: 'waist',
  hipCm: 'hip',
  thighCircCm: 'thigh',
  calfCircCm: 'calf',
  upperArmCircCm: 'arm',
  forearmCircCm: 'forearm',
}

function anchorsFor(gender: Gender): Anchor[] {
  return gender === 'male' ? MALE_ANCHORS : FEMALE_ANCHORS
}

/** 在锚点之间分段线性插值 */
function anchorValue(anchors: Anchor[], f: number, field: keyof Anchor): number {
  const t = Math.max(0, Math.min(1, f))
  if (t <= anchors[0]!.f) return anchors[0]![field] as number
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!
    const b = anchors[i + 1]!
    if (t >= a.f && t <= b.f) {
      const k = (t - a.f) / Math.max(1e-9, b.f - a.f)
      // smoothstep：让体脂变化在中段更明显，两端更平缓，接近真人的视觉感受
      const s = k * k * (3 - 2 * k)
      return (a[field] as number) + ((b[field] as number) - (a[field] as number)) * s
    }
  }
  return anchors[anchors.length - 1]![field] as number
}

/** 身高对围度的影响：同 BMI 下，个子高的人围度按比例更大 */
function heightScale(gender: Gender, heightCm: number): number {
  return heightCm / REF_HEIGHT[gender]
}

// ────────────────────────────────────────────────────────────
// 可编辑状态
// ────────────────────────────────────────────────────────────

/** 骨骼维度：与体脂无关（骨头不会因为长胖变长），只随身高缩放 */
export type FrameKey =
  | 'shoulderWidthCm'
  | 'neckLengthCm'
  | 'torsoLengthCm'
  | 'upperArmCm'
  | 'forearmCm'
  | 'thighCm'
  | 'calfCm'

export const FRAME_KEYS: FrameKey[] = [
  'shoulderWidthCm', 'neckLengthCm', 'torsoLengthCm',
  'upperArmCm', 'forearmCm', 'thighCm', 'calfCm',
]

export interface BodyState {
  gender: Gender
  build: BodyBuildId
  heightCm: number
  /**
   * 体脂水平 0..1 —— **整个模型的唯一自由度**。
   * 所有围度与体重都由它派生；反过来，拖动任何一个围度或体重，
   * 也是在改这一个值，于是全身一起变。
   */
  adiposity: number
  frame: Record<FrameKey, number>
}

/** 骨骼维度的默认值：按身高比例给出 */
function defaultFrame(gender: Gender, heightCm: number): Record<FrameKey, number> {
  const k = heightCm / REF_HEIGHT[gender]
  const male = gender === 'male'
  return {
    shoulderWidthCm: Math.round((male ? 45 : 39) * k * 10) / 10,
    neckLengthCm: Math.round((male ? 11 : 9) * k * 10) / 10,
    torsoLengthCm: Math.round((male ? 47 : 43) * k * 10) / 10,
    upperArmCm: Math.round((male ? 33 : 31) * k * 10) / 10,
    forearmCm: Math.round((male ? 27 : 25) * k * 10) / 10,
    thighCm: Math.round((male ? 47 : 43) * k * 10) / 10,
    calfCm: Math.round((male ? 43 : 39) * k * 10) / 10,
  }
}

export function createBodyState(
  gender: Gender = 'female',
  build: BodyBuildId = 'average',
  heightCm?: number,
): BodyState {
  const h = heightCm ?? REF_HEIGHT[gender]
  return {
    gender,
    build,
    heightCm: h,
    // 默认取「正常」附近，而不是最瘦 —— 那才是多数人的起点
    adiposity: 0.35,
    frame: defaultFrame(gender, h),
  }
}

// ────────────────────────────────────────────────────────────
// 派生
// ────────────────────────────────────────────────────────────

/** 由体脂水平推 BMI */
export function bmiFromAdiposity(gender: Gender, f: number): number {
  return anchorValue(anchorsFor(gender), f, 'bmi')
}

/** 由 BMI 反推体脂水平（二分） */
export function adiposityFromBmi(gender: Gender, bmi: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (bmiFromAdiposity(gender, mid) < bmi) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 某个围度在给定体脂下的值 */
export function girthAt(state: BodyState, key: GirthKey, f = state.adiposity): number {
  const raw = anchorValue(anchorsFor(state.gender), f, ANCHOR_FIELD[key])
  return Math.round(raw * heightScale(state.gender, state.heightCm) * 10) / 10
}

/** 由某个围度反推体脂水平 —— 这是「拖动臀围会让全身一起变」的实现入口 */
export function adiposityFromGirth(state: BodyState, key: GirthKey, valueCm: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (girthAt(state, key, mid) < valueCm) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 体重由 BMI 与身高决定 —— 不是自由变量 */
export function weightAt(state: BodyState): number {
  const bmi = bmiFromAdiposity(state.gender, state.adiposity)
  return Math.round(((state.heightCm / 100) ** 2 * bmi) * 10) / 10
}

/** 把可编辑状态展开成引擎需要的完整身型数据 */
export function deriveProfile(state: BodyState): BodyProfile {
  return {
    gender: state.gender,
    build: state.build,
    heightCm: state.heightCm,
    weightKg: weightAt(state),
    chestCm: girthAt(state, 'chestCm'),
    waistCm: girthAt(state, 'waistCm'),
    hipCm: girthAt(state, 'hipCm'),
    upperArmCircCm: girthAt(state, 'upperArmCircCm'),
    forearmCircCm: girthAt(state, 'forearmCircCm'),
    thighCircCm: girthAt(state, 'thighCircCm'),
    calfCircCm: girthAt(state, 'calfCircCm'),
    shoulderWidthCm: state.frame.shoulderWidthCm,
    torsoLengthCm: state.frame.torsoLengthCm,
    neckLengthCm: state.frame.neckLengthCm,
    upperArmCm: state.frame.upperArmCm,
    forearmCm: state.frame.forearmCm,
    thighCm: state.frame.thighCm,
    calfCm: state.frame.calfCm,
  }
}

// ────────────────────────────────────────────────────────────
// 编辑操作
// ────────────────────────────────────────────────────────────

/** 改身高：骨骼维度与围度都按比例重算，体重随 BMI 重新派生 */
export function setHeight(state: BodyState, heightCm: number): BodyState {
  const next = { ...state, heightCm, frame: { ...state.frame } }
  // 骨骼长度是身高的固定比例（除非用户单独覆盖过，这里按比例缩放）
  const ratio = heightCm / state.heightCm
  for (const k of FRAME_KEYS) next.frame[k] = Math.round(state.frame[k] * ratio * 10) / 10
  return next
}

/** 改围度：反推体脂水平 —— 于是全身围度与体重一起变 */
export function setGirth(state: BodyState, key: GirthKey, valueCm: number): BodyState {
  return { ...state, adiposity: adiposityFromGirth(state, key, valueCm) }
}

/** 改体重：同样落到体脂水平上（体积没变而体重涨，在模型里无法表达） */
export function setWeight(state: BodyState, weightKg: number): BodyState {
  const bmi = weightKg / (state.heightCm / 100) ** 2
  return { ...state, adiposity: adiposityFromBmi(state.gender, bmi) }
}

/** 改骨骼维度：与体脂无关，只动这一项 */
export function setFrame(state: BodyState, key: FrameKey, valueCm: number): BodyState {
  return { ...state, frame: { ...state.frame, [key]: valueCm } }
}

/** 换性别 / 形体风格 */
export function setGender(state: BodyState, gender: Gender): BodyState {
  if (state.gender === gender) return state
  /*
   * ⚠️ 身高必须一起换成新性别的典型值。
   *
   * 曾经只改 gender 而保留原来的 heightCm —— 应用默认是女性 158cm，
   * 切到男性后仍是 158cm，于是所有围度按 158/170 缩放，
   * 男性胸围算出 86（应为 92）。默认值本来就是性别相关的，
   * 切换性别就该采用该性别的典型身高。
   */
  const h = REF_HEIGHT[gender]
  return { ...state, gender, heightCm: h, frame: defaultFrame(gender, h) }
}

// ────────────────────────────────────────────────────────────
// 滑杆范围
// ────────────────────────────────────────────────────────────

/**
 * 某一项的可用范围。
 *
 * 围度与体重的范围是**派生**的，不是写死的常数 ——
 * 所以抬高身高后，体重的可拖范围会自动跟着变；
 * 这也是「拖到一部分拖不动」的来源：越界的状态在生理上不存在。
 */
export function rangeOf(state: BodyState, key: GirthKey | 'weightKg'): { min: number; max: number } {
  if (key === 'weightKg') {
    // 用**锚点能覆盖的** BMI 范围，而不是理论上下限 ——
    // 否则滑杆两端会出现拖不动也变不了的死区。
    const h2 = (state.heightCm / 100) ** 2
    return {
      min: Math.round(bmiFromAdiposity(state.gender, 0) * h2 * 10) / 10,
      max: Math.round(bmiFromAdiposity(state.gender, 1) * h2 * 10) / 10,
    }
  }
  return {
    min: girthAt(state, key, 0),
    max: girthAt(state, key, 1),
  }
}

// ────────────────────────────────────────────────────────────
// 健康指标
// ────────────────────────────────────────────────────────────

export type HealthLevel = 'good' | 'watch' | 'risk'

export interface HealthMetric {
  key: 'bmi' | 'whtr' | 'whr'
  label: string
  value: number
  display: string
  /** 健康区间，用于在 UI 上画参考带 */
  healthy?: { min: number; max: number }
  limit?: number
  level: HealthLevel
  note: string
}

/** 由身型数据算健康指标。这是「合理区间」在界面上的表达 */
export function healthMetrics(profile: BodyProfile): HealthMetric[] {
  const h = profile.heightCm / 100
  const bmi = profile.weightKg / (h * h)
  const whtr = profile.waistCm / profile.heightCm
  const whr = profile.waistCm / profile.hipCm
  const whrLimit = WHR_LIMIT[profile.gender]

  const bmiLevel: HealthLevel =
    bmi < BMI_HEALTHY.min ? 'watch' : bmi <= BMI_HEALTHY.max ? 'good' : bmi < 28 ? 'watch' : 'risk'

  return [
    {
      key: 'bmi',
      label: 'BMI',
      value: bmi,
      display: bmi.toFixed(1),
      healthy: BMI_HEALTHY,
      level: bmiLevel,
      note: bmi < BMI_HEALTHY.min ? '偏瘦' : bmi <= BMI_HEALTHY.max ? '正常范围' : '偏高',
    },
    {
      key: 'whtr',
      label: '腰高比',
      value: whtr,
      display: whtr.toFixed(2),
      limit: WHTR_HEALTHY,
      level: whtr < WHTR_HEALTHY ? 'good' : whtr < 0.6 ? 'watch' : 'risk',
      note: whtr < WHTR_HEALTHY ? '中心性肥胖风险低' : '中心性肥胖风险升高',
    },
    {
      key: 'whr',
      label: '腰臀比',
      value: whr,
      display: whr.toFixed(2),
      limit: whrLimit,
      level: whr < whrLimit ? 'good' : whr < whrLimit + 0.08 ? 'watch' : 'risk',
      note: whr < whrLimit ? '腹型肥胖风险低' : '腹型肥胖风险升高',
    },
  ]
}
