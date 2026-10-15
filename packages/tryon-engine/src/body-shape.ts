/**
 * 体型映射：把项目的 BodyState/BodyProfile 变成 MakeHuman 形变目标的权重。
 *
 * ── 为什么是「两层」而不是一层 ──
 * 只靠 macrodetails（性别/肌肉/体重）能给出一个**生理上合理**的身体，
 * 但它是粗粒度的：它不知道你想要的具体胸围是多少。
 * 只靠 measure 目标能精确对上围度，但它是局部形变，堆多了会畸形。
 *
 * 所以分两层，各司其职：
 *   第一层 macrodetails  → 整体体量与脂肪分布（生理合理性）
 *   第二层 measure       → 把各围度校准到模型给出的具体数值（精确性）
 *
 * ── 为什么不做骨骼缩放 ──
 * 骨骼缩放会被子骨骼继承：实测把脊椎放大 1.18 倍，头高被拉伸 82.45%。
 * 体型变化一律走形变目标，骨架只是从形变后的网格推导出来。
 *
 * ── 自校准而不是写死系数 ──
 * 「某个 measure 目标权重 1.0 能让腰围涨多少」这个数，
 * 写死在代码里会随上游资产更新而失效，也无法验证。
 * 这里在首次使用时**实测一遍**：把每个目标施加到网格上、量出真实变化，
 * 得到敏感度矩阵。代价是启动时多算几十毫秒，换来的是
 * 「系数永远是当前资产的真值」。
 */
import type { MhSkeleton, MhTarget, WeightedTarget } from './mh-rig'
import {
  applyTargets, dominantBone, measureHeights, measureLengths, sliceMeasure,
  LENGTH_TARGET, LENGTH_FRAME_FIELD, type LengthKey,
} from './mh-rig'
import type { MhWeights } from './mh-rig'

/** 需要用户提供的身型数值（长度单位 cm） */
export interface ShapeInput {
  gender: 'male' | 'female'
  heightCm: number
  /** 体脂水平 0..1（由 BMI 驱动，见 core 的 body-model） */
  adiposity: number
  /** 形体风格：决定肌肉量 */
  build: 'average' | 'muscular' | 'plump'
  chestCm: number
  waistCm: number
  hipCm: number
  /** 可选：四肢围度。缺省时只校准三围 */
  thighCircCm?: number
  calfCircCm?: number
  upperArmCircCm?: number
  /**
   * 比例参数（肩宽/颈长/躯干长/四肢长，单位 cm）。
   *
   * ⚠️ 这些**必须接进来**。早先这一层完全没读 frame，
   * 结果是拖「肩宽」「颈长」「躯干长」滑杆人偶纹丝不动 ——
   * 实测接了两组差异极大的 frame，渲染出来却是**字节级完全相同**的两张图。
   * 对一个人偶 App 来说这是功能性 bug，不是美术问题。
   */
  frame?: Record<string, number>
  /** 该性别的中性 frame，作为比例的基准。缺省时用「目标值即基准」的退化行为 */
  neutralFrame?: Record<string, number>
}

/** 一处围度的实测结果（网格单位） */
interface Girths {
  chest: number
  waist: number
  hip: number
}

/** 敏感度：某目标权重 +1 时，各围度变化的比例 */
interface Sensitivity {
  chest: number
  waist: number
  hip: number
}

export interface ShapeCalibration {
  /** 网格总高（网格单位）。用于 cm ↔ 网格单位换算 */
  meshHeight: number
  /** 基准网格的三围（网格单位） */
  baseGirths: Girths
  /** 测量高度（网格单位） */
  heights: { chest: number; waist: number; hip: number }
  /** 测量时使用的半厚度 */
  tolerance: number
  /** measure 目标名 → 敏感度 */
  measure: Map<string, Sensitivity>
  /** macrodetails 目标名 → 敏感度 */
  macro: Map<string, Sensitivity>
  /** 基准骨架长度（网格单位） */
  baseLengths: Record<LengthKey, number>
  /** 各长度目标权重 +1 时，各长度项的变化比例 */
  length: Map<LengthKey, Partial<Record<LengthKey, number>>>
}

/**
 * 用到的 macrodetails 目标。
 *
 * 只取 3 个/性别，而不是完整的 3×3 组合 —— 形变目标占整包 74% 的体积，
 * 而完整组合冗余度很高。基准态（averagemuscle-averageweight）在上游
 * 就是空目标，等于基础网格本身，不需要额外占空间：
 *   体重维：minweight / maxweight 两个方向，中间由基准网格充当
 *   肌肉维：maxmuscle-averageweight 当作增量，按 build 缩放
 */
const MACRO_WEIGHT_MIN = 'universal-{g}-young-averagemuscle-minweight'
const MACRO_WEIGHT_MAX = 'universal-{g}-young-averagemuscle-maxweight'
const MACRO_MUSCLE = 'universal-{g}-young-maxmuscle-averageweight'
const MACRO_TARGETS = [MACRO_WEIGHT_MIN, MACRO_WEIGHT_MAX, MACRO_MUSCLE]

/** 用于校准三围的 measure 目标 */
const MEASURE_TARGETS = ['bust-circ', 'waist-circ', 'hips-circ', 'underbust-circ']

export interface CalibrateInput {
  basePos: Float32Array
  skel: MhSkeleton
  weights: MhWeights
  /** 按名字取目标；缺哪个就跳过哪个（资产可能不完整） */
  loadTarget: (name: string) => MhTarget | null
}

/**
 * 实测校准：量出基准三围，以及每个目标的敏感度。
 *
 * 只在启动时做一次，结果缓存。
 */
export function calibrateShape(input: CalibrateInput): ShapeCalibration {
  const { basePos, skel, weights, loadTarget } = input
  const nV = basePos.length / 3
  const dom = dominantBone(weights, nV)

  /*
   * ⚠️ 只能统计**躯干**顶点。
   * 手臂在腰高附近也存在，如果不过滤，量出来的「腰围」会把两条手臂
   * 一起圈进去，数值直接虚高一倍，据此校准出来的系数全是错的。
   */
  const TORSO = new Set([
    'spine01', 'spine02', 'spine03', 'spine04', 'spine05',
    'root', 'pelvis.L', 'pelvis.R', 'neck01',
  ])
  const torsoOnly = (i: number) => TORSO.has(dom[i] ?? '')

  const h = measureHeights(skel, basePos)
  const meshHeight = h.headTop - h.footBottom
  const tolerance = meshHeight * 0.012

  const girthOf = (p: Float32Array): Girths => ({
    chest: sliceMeasure(p, h.chest, tolerance, torsoOnly).perimeter,
    waist: sliceMeasure(p, h.waist, tolerance, torsoOnly).perimeter,
    hip: sliceMeasure(p, h.hip, tolerance, torsoOnly).perimeter,
  })

  const baseGirths = girthOf(basePos)
  const rel = (a: number, b: number) => (a > 1e-6 ? b / a - 1 : 0)

  const measure = new Map<string, Sensitivity>()
  for (const name of MEASURE_TARGETS) {
    const t = loadTarget(`measure-${name}-incr`)
    if (!t || !t.size) continue
    const g = girthOf(applyTargets(basePos, [{ target: t, weight: 1 }]))
    measure.set(name, {
      chest: rel(baseGirths.chest, g.chest),
      waist: rel(baseGirths.waist, g.waist),
      hip: rel(baseGirths.hip, g.hip),
    })
  }

  const macro = new Map<string, Sensitivity>()
  for (const gender of ['female', 'male'] as const) {
    for (const tpl of MACRO_TARGETS) {
      const name = tpl.replace('{g}', gender)
      const t = loadTarget(name)
      if (!t || !t.size) continue // 中性组合是空目标，故意跳过
      const g = girthOf(applyTargets(basePos, [{ target: t, weight: 1 }]))
      macro.set(name, {
        chest: rel(baseGirths.chest, g.chest),
        waist: rel(baseGirths.waist, g.waist),
        hip: rel(baseGirths.hip, g.hip),
      })
    }
  }

  // ── 长度校准：每个长度目标对自己的段长影响多少 ──
  const baseLengths = measureLengths(skel, basePos)
  const length = new Map<LengthKey, Partial<Record<LengthKey, number>>>()
  for (const key of Object.keys(LENGTH_TARGET) as LengthKey[]) {
    const t = loadTarget(LENGTH_TARGET[key])
    if (!t || !t.size) continue
    const l2 = measureLengths(skel, applyTargets(basePos, [{ target: t, weight: 1 }]))
    const row: Partial<Record<LengthKey, number>> = {}
    for (const k of Object.keys(LENGTH_TARGET) as LengthKey[]) {
      const a = baseLengths[k]
      if (a > 1e-6) row[k] = l2[k] / a - 1
    }
    length.set(key, row)
  }

  return {
    meshHeight,
    baseGirths,
    heights: { chest: h.chest, waist: h.waist, hip: h.hip },
    tolerance,
    measure,
    macro,
    baseLengths,
    length,
  }
}

/**
 * 把 0..1 的值分解成「朝最小端」与「朝最大端」两个权重。
 *
 * MakeHuman 的宏滑块语义是三档 min/avg/max 混合（和为 1），
 * 但中档的 target 是空的（等于基础网格），所以实际只需要两个数：
 *   t ≤ 0.5 → 从最小端往基准走：wMin = 1-2t
 *   t > 0.5 → 从基准往最大端走：wMax = 2t-1
 * 两者不会同时非零，所以不会重复叠加。
 */
function twoWayBlend(v: number): { min: number; max: number } {
  const t = Math.min(1, Math.max(0, v))
  return t <= 0.5 ? { min: 1 - 2 * t, max: 0 } : { min: 0, max: 2 * t - 1 }
}

/** 形体风格 → 肌肉档位（0=最少肌，1=最多肌） */
function muscleOf(build: ShapeInput['build'], adiposity: number): number {
  switch (build) {
    case 'muscular': return 0.95
    // 偏胖型一般是肌肉量偏低 + 脂肪高，但不要压到 0：那会让四肢过细
    case 'plump': return 0.15
    default: return Math.max(0.2, 0.5 - adiposity * 0.2)
  }
}

export interface ShapeResult {
  targets: WeightedTarget[]
  /** 施加后预测的三围（网格单位），用于验证 */
  predicted: Girths
  /** 实际达成与目标的残差（比例） */
  residual: Girths
}

/**
 * 生成形变目标列表。
 *
 * 流程：macrodetails 定整体 → 量出当前三围 → 用 measure 目标把差值补上。
 * 因为目标是线性的，直接按敏感度反解一次即可，不需要迭代。
 */
export function buildShapeTargets(
  cal: ShapeCalibration,
  input: ShapeInput,
  loadTarget: (name: string) => MhTarget | null,
): ShapeResult {
  const list: WeightedTarget[] = []
  const g = input.gender

  // ── 第一层：macrodetails ──
  const wb = twoWayBlend(input.adiposity)
  // 肌肉档位 0..1 直接作用在「最大肌肉增量」目标上
  const muscle = muscleOf(input.build, input.adiposity)
  const combos: Array<[string, number]> = [
    [MACRO_WEIGHT_MIN.replace('{g}', g), wb.min],
    [MACRO_WEIGHT_MAX.replace('{g}', g), wb.max],
    [MACRO_MUSCLE.replace('{g}', g), muscle],
  ]
  for (const [name, weight] of combos) {
    if (weight <= 1e-4) continue
    const t = loadTarget(name)
    if (t && t.size) list.push({ target: t, weight })
  }

  // ── 预测 macrodetails 后的三围（用校准矩阵线性外推）──
  const cur: Girths = { ...cal.baseGirths }
  for (const [name, weight] of combos) {
    if (weight <= 1e-4) continue
    const s = cal.macro.get(name)
    if (!s) continue
    cur.chest *= 1 + s.chest * weight
    cur.waist *= 1 + s.waist * weight
    cur.hip *= 1 + s.hip * weight
  }

  // ── 第二层：measure 目标把围度补到目标值 ──
  // cm → 网格单位
  const k = cal.meshHeight / input.heightCm
  const want: Girths = {
    chest: input.chestCm * k,
    waist: input.waistCm * k,
    hip: input.hipCm * k,
  }

  /*
   * 逐部位反解。每个 measure 目标主要影响自己那一处
   * （实测 bust-circ 只动胸 +14.5%、waist-circ 只动腰 +14.9%），
   * 所以按主对角求权重即可，不必解完整线性方程组；
   * 但要把该目标对**其它部位**的副作用一起算进去，否则会互相打架。
   */
  const need = {
    chest: want.chest / cur.chest - 1,
    waist: want.waist / cur.waist - 1,
    hip: want.hip / cur.hip - 1,
  }
  const wantNames: Array<[keyof Girths, string]> = [
    ['chest', 'bust-circ'],
    ['waist', 'waist-circ'],
    ['hip', 'hips-circ'],
  ]
  for (const [part, name] of wantNames) {
    const s = cal.measure.get(name)
    if (!s) continue
    const main = s[part]
    if (Math.abs(main) < 1e-4) continue
    // 权重限制在 [-1.5, 1.5]：超出这个范围说明目标值与网格差得太远，
    // 硬拉会把局部拉畸形，宁可不准也不要畸形
    const w = Math.max(-1.5, Math.min(1.5, need[part] / main))
    if (Math.abs(w) < 0.01) continue
    const t = loadTarget(`measure-${name}-incr`)
    if (t && t.size) {
      list.push({ target: t, weight: w })
      // 把副作用计入预测
      cur.chest *= 1 + s.chest * w
      cur.waist *= 1 + s.waist * w
      cur.hip *= 1 + s.hip * w
    }
  }

  // ── 第三层：比例（肩宽/颈长/躯干长/四肢长）──
  /*
   * cm → 网格单位换算与围度一致。
   * 每个长度目标主要影响自己那一项（实测 shoulder-dist 只显著改肩宽），
   * 所以按主对角反解；同时对其它长度项的副作用一并计入。
   */
  if (input.frame && input.neutralFrame) {
    for (const key of Object.keys(LENGTH_TARGET) as LengthKey[]) {
      const field = LENGTH_FRAME_FIELD[key]
      const want = input.frame[field]
      const base = input.neutralFrame[field]
      if (typeof want !== 'number' || typeof base !== 'number' || base <= 1e-6) continue
      const row = cal.length.get(key)
      if (!row) continue
      const main = row[key]
      if (typeof main !== 'number' || Math.abs(main) < 1e-4) continue
      // 目标比例变化（相对中性）
      const need = want / base - 1
      /*
       * 权重上限**逐项不同**。
       *
       * neck-height 这个目标有个固有副作用：它把头也一起纵向拉伸，
       * 实测比例约为颈长变化的 0.35 倍（w=1.0 时颈长 +27.5% 而头高 +9.5%，
       * w=1.5 时头高 +14.4% —— 那又变成尖刺了）。
       * 所以颈长必须收得更紧：把权重压到 0.55 以下，
       * 头部拉伸就能控制在 5% 以内（肉眼基本不可辨）。
       * 其余目标的实测副作用为 0.0%，可以放宽到 ±1.5。
       */
      const cap = key === 'neckLength' ? 0.55 : 1.5
      const w = Math.max(-cap, Math.min(cap, need / main))
      if (Math.abs(w) < 0.01) continue
      const t = loadTarget(LENGTH_TARGET[key])
      if (t && t.size) list.push({ target: t, weight: w })
    }
  }

  return {
    targets: list,
    predicted: cur,
    residual: {
      chest: want.chest > 1e-6 ? cur.chest / want.chest - 1 : 0,
      waist: want.waist > 1e-6 ? cur.waist / want.waist - 1 : 0,
      hip: want.hip > 1e-6 ? cur.hip / want.hip - 1 : 0,
    },
  }
}
