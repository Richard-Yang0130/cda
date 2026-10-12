/**
 * 参数化人体 —— 由身型数据生成连续肉体。
 *
 * 范式（参考逆水寒 / 燕云十六声那类角色创建器）：
 *   1. 身型数据 → **骨架**（各段长度、关节位置）
 *   2. 骨架 → **肉块列表**（变径胶囊链，中段半径隆起 = 肌肉）
 *   3. 肉块平滑并集 → **SDF**
 *   4. SDF → **Surface Nets 多边形化** → 网格
 *
 * 为什么不用显式的「躯干放样 + 圆柱四肢 + 球关节」：
 *   拼装件之间必然有接缝与硬过渡，而且圆柱半径沿轴线性变化，
 *   做不出肱二头肌那种中段鼓起的轮廓 —— 所以怎么调都像积木。
 *   SDF 的平滑并集让肉块真正「长在一起」，肌肉线条是自然涌现的。
 *
 * 关于私密部位：**刻意不做**。性别差异通过肩宽、腰臀比、胸廓、骨盆、
 * 四肢粗细这些体块轮廓来表达，不用生殖器 —— 这既是合规与观感考虑，
 * 也是服装展示人台的行业惯例。
 */
import * as THREE from 'three'
import type { BodyProfile, Gender } from '@cda/core'
import { polygonize } from './surface-nets'
import { blobsBounds, compileSdf, type SdfBlob, type Vec3 } from './sdf'

// ────────────────────────────────────────────────────────────
// 几何辅助
// ────────────────────────────────────────────────────────────

/** 椭圆周长（Ramanujan 近似） */
function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

/**
 * 由围度反解椭圆半轴。
 * 围度是用户最容易量的数据，但它对应的是周长，需要解出横/纵半轴才能建模。
 * 给定深度比（b/a）后做一次二分即可。
 */
function semiAxes(C: number, depthRatio: number): { w: number; d: number } {
  let lo = (C / (2 * Math.PI)) * 0.6
  let hi = (C / (2 * Math.PI)) * 1.4
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2
    if (ellipsePerimeter(mid, mid * depthRatio) < C) lo = mid
    else hi = mid
  }
  const a = (lo + hi) / 2
  return { w: a, d: a * depthRatio }
}

// ────────────────────────────────────────────────────────────
// 骨架
// ────────────────────────────────────────────────────────────

export interface LimbChain {
  side: -1 | 1
  /** 根部（肩 / 胯） */
  root: Vec3
  /** 中关节（肘 / 膝） */
  mid: Vec3
  /** 末端（腕 / 踝） */
  end: Vec3
  /** 根部半径 */
  rRoot: number
  /** 中关节半径 */
  rMid: number
  /** 末端半径 */
  rEnd: number
  /** 肌肉隆起处的半径（肱二头肌 / 小腿肚） */
  rBulge: number
}

export interface BodySkeleton {
  gender: Gender
  /** 身高（米） */
  height: number
  /** 关键高度（米，y 从脚底起算） */
  ankleY: number
  kneeY: number
  hipY: number
  waistY: number
  chestY: number
  shoulderY: number
  chinY: number
  headTopY: number

  /** 胸腔半宽/半深 */
  chest: { w: number; d: number }
  /** 腰部 */
  waist: { w: number; d: number }
  /** 骨盆 */
  hip: { w: number; d: number }
  /** 肩半宽 */
  shoulderHalf: number

  arms: LimbChain[]
  legs: LimbChain[]

  /** 头大小 */
  head: { w: number; h: number; d: number }
  /** 颈半径 */
  neckR: number
  /** 脚踝半径 */
  ankleR: number
}

export function buildSkeleton(profile: BodyProfile): BodySkeleton {
  const male = profile.gender === 'male'
  const H = profile.heightCm / 100

  // ── 纵向分段先归一化，保证各段之和恰好等于身高 ──
  // 用户给的数据常常不自洽（比如各段加起来不等于身高），
  // 直接照用会让人偶比例崩掉。这里统一按比例缩放，既不丢失用户意图，
  // 又保证模型一定站得完整。
  const rawAnkle = 0.045 * H
  const rawHead = 0.13 * H
  const rawCalf = profile.calfCm / 100
  const rawThigh = profile.thighCm / 100
  const rawTorso = profile.torsoLengthCm / 100
  const rawNeck = profile.neckLengthCm / 100
  const total = rawAnkle + rawCalf + rawThigh + rawTorso + rawNeck + rawHead
  const k = total > 0 ? H / total : 1

  const ankleY = rawAnkle * k
  const kneeY = ankleY + rawCalf * k
  const hipY = kneeY + rawThigh * k
  const shoulderY = hipY + rawTorso * k
  const chinY = shoulderY + rawNeck * k
  const headTopY = chinY + rawHead * k

  // ── 横断面 ──
  const chest = semiAxes(profile.chestCm / 100, male ? 0.8 : 0.74)
  const waist = semiAxes(profile.waistCm / 100, male ? 0.82 : 0.78)
  const hip = semiAxes(profile.hipCm / 100, male ? 0.78 : 0.76)
  const shoulderHalf = profile.shoulderWidthCm / 200

  const waistY = hipY + (shoulderY - hipY) * 0.26
  const chestY = hipY + (shoulderY - hipY) * 0.74

  // ── 四肢 ──
  const upperArmR = semiAxes(profile.upperArmCircCm / 100, 0.94).w
  const thighR = semiAxes(profile.thighCircCm / 100, 0.95).w
  const armTilt = male ? 0.17 : 0.14
  const upperLen = profile.upperArmCm / 100
  const foreLen = profile.forearmCm / 100
  const thighLen = profile.thighCm / 100
  const calfLen = profile.calfCm / 100

  const arms: LimbChain[] = ([-1, 1] as const).map((side) => {
    const rootX = side * shoulderHalf * 0.86
    const root: Vec3 = [rootX, shoulderY - 0.012, 0]
    const elbowX = rootX + side * Math.sin(armTilt) * upperLen
    const elbow: Vec3 = [elbowX, root[1] - Math.cos(armTilt) * upperLen, 0.012 * upperLen]
    const wristX = elbowX + side * Math.sin(armTilt * 0.7) * foreLen
    const wrist: Vec3 = [wristX, elbow[1] - Math.cos(armTilt * 0.7) * foreLen, elbow[2] + 0.01]
    const rMid = upperArmR * 0.82
    return {
      side, root, mid: elbow, end: wrist,
      rRoot: upperArmR * 0.92,
      rMid,
      rEnd: upperArmR * 0.6,
      // 肱二头肌：比中关节略粗，平滑并集后形成中段隆起
      rBulge: upperArmR * 1.06,
    }
  })

  const legs: LimbChain[] = ([-1, 1] as const).map((side) => {
    const rootX = side * hip.w * 0.48
    const root: Vec3 = [rootX, hipY, 0]
    const kneeX = side * hip.w * 0.44
    const knee: Vec3 = [kneeX, hipY - thighLen, 0.008]
    const ankleX = side * hip.w * 0.4
    const ankle: Vec3 = [ankleX, knee[1] - calfLen, 0]
    return {
      side, root, mid: knee, end: ankle,
      rRoot: thighR * 1.0,
      // 膝盖直径约 10cm，取 0.6 倍大腿半径；取太小腿会显得细弱
      rMid: thighR * 0.6,
      rEnd: thighR * 0.34,
      // 小腿肚：偏上位置隆起
      rBulge: thighR * 0.68,
    }
  })

  return {
    gender: profile.gender,
    height: H,
    ankleY, kneeY, hipY, waistY, chestY, shoulderY, chinY, headTopY,
    chest, waist, hip, shoulderHalf,
    arms, legs,
    head: { w: 0.092 * H, h: 0.134 * H, d: 0.108 * H },
    neckR: Math.max(0.042, chest.w * 0.3),
    ankleR: legs[0]!.rEnd,
  }
}

// ────────────────────────────────────────────────────────────
// 肉块
// ────────────────────────────────────────────────────────────

/**
 * 由骨架生成肉块。
 *
 * 肌肉的做法：每个肢体段先放一根**变径胶囊**作为核心，
 * 再在肌肉隆起处加一颗球 —— 平滑并集会自动把它揉成一个鼓包，
 * 于是肱二头肌与小腿肚就出来了，不需要手工雕网格。
 */
function buildBlobs(s: BodySkeleton): SdfBlob[] {
  const blobs: SdfBlob[] = []
  const male = s.gender === 'male'
  const span = s.shoulderY - s.hipY

  // ── 躯干：沿脊柱扫掠的变截面体 ──
  // 一个图元搞定，截面在 胯 → 腰 → 胸 → 肩 之间**连续**变化。
  // 早先用三个独立椭球拼，竖向不重叠，中间塌出了夸张的蜂腰。
  blobs.push({
    kind: 'loft',
    stations: [
      // 骨盆到底裆必须缓缓收：收得急就会在胯下留一圈「裙边」
      { y: s.hipY - span * 0.2, w: s.hip.w * 0.3, d: s.hip.d * 0.3 },
      { y: s.hipY - span * 0.12, w: s.hip.w * 0.62, d: s.hip.d * 0.58 },
      { y: s.hipY - span * 0.05, w: s.hip.w * 0.92, d: s.hip.d * 0.88 },
      { y: s.hipY, w: s.hip.w, d: s.hip.d },
      { y: s.waistY, w: s.waist.w, d: s.waist.d },
      {
        y: s.chestY,
        // 男性：胸廓更宽、更平；女性：胸量用「更饱满的截面深度」表达。
        // 刻意不加两颗球 —— 那会变成两个突兀的疙瘩，作为人台很不体面。
        w: s.chest.w * (male ? 1.08 : 0.98),
        d: s.chest.d * (male ? 1.0 : 1.24),
      },
      // 肩部要一直保持够宽，让手臂根部落在它里面 ——
      // 否则肩头会鼓出一个独立的包，像扛了两颗球
      { y: s.shoulderY - span * 0.02, w: s.shoulderHalf * 0.95, d: s.chest.d * 0.9 },
      // 斜方肌收口，让颈部平滑接上肩
      { y: s.shoulderY + span * 0.05, w: s.neckR * 1.5, d: s.neckR * 1.4 },
    ],
  })

  // ── 臀：向后隆起，女性更明显 ──
  const buttR = s.hip.w * (male ? 0.4 : 0.44)
  for (const side of [-1, 1] as const) {
    blobs.push({
      kind: 'sphere',
      c: [side * s.hip.w * 0.38, s.hipY - span * 0.03, -s.hip.d * (male ? 0.58 : 0.64)],
      r: buttR,
    })
  }

  // ── 颈 ──
  const neckTop = s.chinY
  blobs.push({
    kind: 'capsule',
    a: [0, s.shoulderY - 0.01, 0],
    b: [0, neckTop, 0.006],
    r: s.neckR,
  })

  // ── 头：颅 + 下颌两段椭球，平滑并集后形成蛋形人台头 ──
  const headC = s.chinY + s.head.h * 0.52
  blobs.push({
    kind: 'ellipsoid',
    c: [0, headC + s.head.h * 0.1, 0],
    r: [s.head.w * 0.52, s.head.h * 0.44, s.head.d * 0.55],
  })
  blobs.push({
    kind: 'ellipsoid',
    c: [0, s.chinY + s.head.h * 0.2, s.head.d * 0.06],
    r: [s.head.w * 0.42, s.head.h * 0.26, s.head.d * 0.46],
  })

  // ── 四肢 ──
  for (const arm of s.arms) {
    blobs.push({ kind: 'roundcone', a: arm.root, b: arm.mid, r1: arm.rRoot, r2: arm.rMid })
    blobs.push({ kind: 'roundcone', a: arm.mid, b: arm.end, r1: arm.rMid, r2: arm.rEnd })
    // 肱二头肌
    const bx = arm.root[0] + (arm.mid[0] - arm.root[0]) * 0.45
    const by = arm.root[1] + (arm.mid[1] - arm.root[1]) * 0.45
    const bz = arm.root[2] + (arm.mid[2] - arm.root[2]) * 0.45
    blobs.push({ kind: 'sphere', c: [bx, by, bz], r: arm.rBulge })
    // 手
    blobs.push({
      kind: 'ellipsoid',
      c: [arm.end[0], arm.end[1] - arm.rEnd * 1.5, arm.end[2]],
      r: [arm.rEnd * 1.15, arm.rEnd * 2.1, arm.rEnd * 0.72],
    })
  }

  for (const leg of s.legs) {
    blobs.push({ kind: 'roundcone', a: leg.root, b: leg.mid, r1: leg.rRoot, r2: leg.rMid })
    blobs.push({ kind: 'roundcone', a: leg.mid, b: leg.end, r1: leg.rMid, r2: leg.rEnd })
    // 小腿肚：偏上
    const cx2 = leg.mid[0] + (leg.end[0] - leg.mid[0]) * 0.28
    const cy2 = leg.mid[1] + (leg.end[1] - leg.mid[1]) * 0.28
    const cz2 = leg.mid[2] + (leg.end[2] - leg.mid[2]) * 0.28 - leg.rBulge * 0.25
    blobs.push({ kind: 'sphere', c: [cx2, cy2, cz2], r: leg.rBulge })
    // 脚：沿 +Z 伸出的圆棒，底面落在 y=0 附近，读起来像鞋楦
    const soleR = s.ankleR * 0.95
    blobs.push({
      kind: 'capsule',
      a: [leg.end[0], soleR, leg.end[2] - soleR * 0.6],
      b: [leg.end[0], soleR, leg.end[2] + s.height * 0.11],
      r: soleR,
    })
  }

  return blobs
}

// ────────────────────────────────────────────────────────────
// 身体模型
// ────────────────────────────────────────────────────────────

export interface BodyModel {
  profile: BodyProfile
  skeleton: BodySkeleton
  blobs: SdfBlob[]
  /** 隐式曲面求值 */
  sdf: (x: number, y: number, z: number) => number
  /**
   * 从体内一点沿方向找到表面距离（米）。
   * 超出 maxDist 仍未命中则返回 null —— 调用方据此回退到解析半径。
   * 这是服装贴合肉体的关键：不再假设身体是椭圆环，而是直接问 SDF。
   */
  surfaceRadius(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
  ): number | null
  bounds: { min: Vec3; max: Vec3 }
}

export function createBodyModel(profile: BodyProfile): BodyModel {
  const skeleton = buildSkeleton(profile)
  const blobs = buildBlobs(skeleton)
  // 平滑系数：偏小则肉块交界处会露出硬棱，偏大则会把交界「吹胖」——
  // 胯部那圈裙边感就是吹胖造成的，所以取偏小的 0.02。
  const sdf = compileSdf(blobs, 0.02)

  const surfaceRadius: BodyModel['surfaceRadius'] = (ox, oy, oz, dx, dy, dz, maxDist) => {
    if (sdf(ox, oy, oz) > 0) return null // 起点已在体外，无法内往外找
    const steps = 56
    const dt = maxDist / steps
    let prevT = 0
    for (let i = 1; i <= steps; i++) {
      const t = i * dt
      if (sdf(ox + dx * t, oy + dy * t, oz + dz * t) >= 0) {
        // 命中，二分细化到亚毫米
        let lo = prevT
        let hi = t
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2
          if (sdf(ox + dx * mid, oy + dy * mid, oz + dz * mid) < 0) lo = mid
          else hi = mid
        }
        return (lo + hi) / 2
      }
      prevT = t
    }
    return null
  }

  return { profile, skeleton, blobs, sdf, surfaceRadius, bounds: blobsBounds(blobs) }
}

// ────────────────────────────────────────────────────────────
// 网格
// ────────────────────────────────────────────────────────────

function mannequinMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xece8e3,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.4,
  })
}

export type MannequinQuality = 'preview' | 'final'

/**
 * 生成人台网格。
 * preview 用更粗的体素 —— 拖滑杆时实时重建靠它，
 * 松手后再用 final 精度重算。
 */
export function buildMannequin(model: BodyModel, quality: MannequinQuality = 'final'): THREE.Group {
  const group = new THREE.Group()
  const { bounds } = model
  const margin = 0.03
  const voxel = (model.skeleton.height / 152) * (quality === 'preview' ? 2.2 : 1)

  const geometry = polygonize(model.sdf, {
    bounds: {
      min: [bounds.min[0] - margin, bounds.min[1] - margin, bounds.min[2] - margin],
      max: [bounds.max[0] + margin, bounds.max[1] + margin, bounds.max[2] + margin],
    },
    voxel,
  })

  const mesh = new THREE.Mesh(geometry, mannequinMaterial())
  mesh.name = 'body'
  group.add(mesh)
  return group
}

// ────────────────────────────────────────────────────────────
// 肢体描述（供服装使用）
// ────────────────────────────────────────────────────────────

/**
 * 肢体参数。
 * 服装的袖子/裤腿沿用它定位轴向，再向 SDF 求表面半径做贴合。
 *
 * 注意存的是**分段路径长度**（root→mid、mid→end），不是直线距离 ——
 * 手臂有肘部转折，用直线距离做插值会让袖子在中段跑偏。
 */
export interface LimbSpec {
  side: -1 | 1
  origin: { x: number; y: number; z: number }
  mid: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
  /** root -> mid 的长度 */
  segLen1: number
  /** mid -> end 的长度 */
  segLen2: number
  /** 路径总长 */
  length: number
  radiusTop: number
  radiusMid: number
  radiusBottom: number
}

function vec(v: Vec3): { x: number; y: number; z: number } {
  return { x: v[0], y: v[1], z: v[2] }
}

function segLength(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function makeLimbSpec(chain: LimbChain, rotationZ: number): LimbSpec {
  const origin = vec(chain.root)
  const mid = vec(chain.mid)
  const end = vec(chain.end)
  const segLen1 = segLength(origin, mid)
  const segLen2 = segLength(mid, end)
  return {
    side: chain.side,
    origin, mid, end,
    segLen1,
    segLen2,
    length: segLen1 + segLen2,
    // 表面半径取略大于骨架半径：SDF 平滑并集会把形体略微「鼓」出来，
    // 取小了袖子会切进手臂
    radiusTop: chain.rRoot * 1.06,
    radiusMid: chain.rMid * 1.1,
    radiusBottom: chain.rEnd * 1.08,
  }
}

export function buildArmSpecs(model: BodyModel): LimbSpec[] {
  return model.skeleton.arms.map((arm) => makeLimbSpec(arm, arm.side * 0.06))
}

export function buildLegSpecs(model: BodyModel): LimbSpec[] {
  return model.skeleton.legs.map((leg) => makeLimbSpec(leg, 0))
}

/**
 * 沿肢体路径、距根部 d 米处的中心点。
 * d 允许为负或超过总长 —— 用于裤腰向上外推、袖口略微超出腕部。
 */
export function limbPointAt(limb: LimbSpec, d: number): { x: number; y: number; z: number } {
  if (d <= limb.segLen1) {
    const t = limb.segLen1 > 1e-9 ? d / limb.segLen1 : 0
    return {
      x: limb.origin.x + (limb.mid.x - limb.origin.x) * t,
      y: limb.origin.y + (limb.mid.y - limb.origin.y) * t,
      z: limb.origin.z + (limb.mid.z - limb.origin.z) * t,
    }
  }
  const t = limb.segLen2 > 1e-9 ? (d - limb.segLen1) / limb.segLen2 : 0
  return {
    x: limb.mid.x + (limb.end.x - limb.mid.x) * t,
    y: limb.mid.y + (limb.end.y - limb.mid.y) * t,
    z: limb.mid.z + (limb.end.z - limb.mid.z) * t,
  }
}

/** 沿肢体路径的半径（分段线性，含中关节） */
export function limbRadiusAt(limb: LimbSpec, d: number): number {
  if (d <= limb.segLen1) {
    const t = limb.segLen1 > 1e-9 ? d / limb.segLen1 : 0
    return limb.radiusTop + (limb.radiusMid - limb.radiusTop) * t
  }
  const t = limb.segLen2 > 1e-9 ? (d - limb.segLen1) / limb.segLen2 : 0
  return limb.radiusMid + (limb.radiusBottom - limb.radiusMid) * t
}

