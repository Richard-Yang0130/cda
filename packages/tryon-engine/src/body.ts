/**
 * 参数化人体 —— 亮点2 的输入环节。
 *
 * 设计取舍（重要）：
 * 我们没有用 SMPL / SMPL-X / MHR 这类真实扫描人体模型，原因是
 *   1. SMPL 系列是**科研许可**，商用要付费，整个项目会被 License 卡死；
 *   2. MHR 虽是 Apache-2.0，但权重较大，且 demo 阶段没必要背这个包袱；
 *   3. 本机 huggingface.co 被网络阻断，下载模型不可靠。
 *
 * 因此这里用**程序化生成的风格化人偶**：躯干由若干横截面（椭圆环）放样而成，
 * 每个环的半宽/半深直接由用户的身高体重三围推导。
 *
 * 好处：零外部资源、秒级生成、身型参数改动人偶立刻变形 —— 恰好是
 * 「导入身型数据 → 生成人偶」这条链路最直观的演示。
 * 后续若接入真实模型，只需替换本文件的 buildMannequin 实现，接口不变。
 */
import * as THREE from 'three'
import type { BodyProfile } from '@cda/core'

/** 人体在归一化高度 t 处的一个横截面（t: 0=脚底, 1=头顶） */
export interface BodyRing {
  t: number
  /** 左右半宽，单位 cm */
  rx: number
  /** 前后半深，单位 cm */
  rz: number
}

/** 人体关键截面的归一化高度，按成年女性平均比例取值 */
export const BODY_LANDMARKS = {
  ankle: 0.04,
  knee: 0.28,
  crotch: 0.45,
  hip: 0.47,
  waist: 0.62,
  underBust: 0.68,
  bust: 0.72,
  shoulder: 0.82,
  neckBase: 0.86,
  chin: 0.875,
  headTop: 1.0,
} as const

/**
 * 由围度估算椭圆半轴。
 * 圆周长 C = 2πr，椭圆形需要修正；这里用一个经验系数近似，
 * 对风格化人偶来说精度足够（真实拟合误差本来就有 2–4cm）。
 */
function radiusFromCircumference(cm: number): number {
  return cm / 5.8
}

/**
 * 四肢参数。
 *
 * 抽成共享结构的意义：**人偶的手臂/腿 与 衣服的袖子/裤腿 必须严格对齐**。
 * 如果两边各自硬编码一套数值，改身型时就会立刻漂移（袖子穿不进手臂）。
 * 所以 body.ts 生成人偶、garment.ts 生成袖子，用的都是这里的同一份数据。
 */
export interface LimbSpec {
  side: -1 | 1
  /** 根部世界坐标（米） */
  origin: { x: number; y: number; z: number }
  /** 仅绕 Z 轴倾斜（弧度） */
  rotationZ: number
  /** 长度（米） */
  length: number
  /** 根部半径（米） */
  radiusTop: number
  /** 末端半径（米） */
  radiusBottom: number
}

/** 沿肢体方向、距根部 d 米处的中心点。d 可为负（向上延伸，用于裤腰） */
export function limbPointAt(limb: LimbSpec, d: number): { x: number; y: number; z: number } {
  const s = Math.sin(limb.rotationZ)
  const c = Math.cos(limb.rotationZ)
  // 局部坐标 (0, -d, 0) 绕 Z 轴旋转后再平移到 origin
  return {
    x: limb.origin.x + d * s,
    y: limb.origin.y - d * c,
    z: limb.origin.z,
  }
}

/** 肢体在距根部 d 米处的半径（线性收窄，d 超出范围时外推） */
export function limbRadiusAt(limb: LimbSpec, d: number): number {
  const t = d / limb.length
  return limb.radiusTop + (limb.radiusBottom - limb.radiusTop) * t
}

export function buildArmSpecs(p: BodyProfile): LimbSpec[] {
  const scale = 0.01
  const H = p.heightCm
  const bust = p.bustCm ?? p.weightKg * 1.55
  const shoulder = p.shoulderCm ?? bust * 0.42
  const radiusTop = (bust * 0.049) * scale

  return ([-1, 1] as const).map((side) => ({
    side,
    origin: {
      x: side * (shoulder / 2) * scale,
      y: BODY_LANDMARKS.shoulder * H * scale,
      z: 0,
    },
    rotationZ: side * 0.14,
    length: (BODY_LANDMARKS.shoulder - 0.36) * H * scale,
    radiusTop,
    radiusBottom: radiusTop * 0.72,
  }))
}

export function buildLegSpecs(p: BodyProfile): LimbSpec[] {
  const scale = 0.01
  const H = p.heightCm
  const hipR = radiusFromCircumference(p.hipCm ?? p.weightKg * 1.62)
  const radiusTop = hipR * 0.38 * scale

  return ([-1, 1] as const).map((side) => ({
    side,
    origin: {
      x: side * hipR * 0.46 * scale,
      y: BODY_LANDMARKS.hip * H * scale,
      z: 0,
    },
    rotationZ: side * -0.02,
    length: (BODY_LANDMARKS.hip - BODY_LANDMARKS.ankle) * H * scale,
    radiusTop,
    radiusBottom: radiusTop * 0.42,
  }))
}

/**
 * 生成躯干截面。
 * 从胯部到颈部，胸/腰/胯三处直接由用户三围驱动 —— 这是「身型影响人偶」的核心。
 */
export function buildTrunkRings(p: BodyProfile): BodyRing[] {
  const bust = p.bustCm ?? p.weightKg * 1.55
  const waist = p.waistCm ?? p.weightKg * 1.22
  const hip = p.hipCm ?? p.weightKg * 1.62
  const shoulder = p.shoulderCm ?? bust * 0.42

  const L = BODY_LANDMARKS

  return [
    { t: L.crotch, rx: radiusFromCircumference(hip) * 1.0, rz: radiusFromCircumference(hip) * 0.78 },
    { t: L.hip, rx: radiusFromCircumference(hip), rz: radiusFromCircumference(hip) * 0.76 },
    { t: (L.hip + L.waist) / 2, rx: radiusFromCircumference((hip + waist) / 2) * 0.96, rz: radiusFromCircumference(waist) * 0.79 },
    { t: L.waist, rx: radiusFromCircumference(waist), rz: radiusFromCircumference(waist) * 0.80 },
    { t: L.underBust, rx: radiusFromCircumference((waist + bust) / 2) * 1.02, rz: radiusFromCircumference(bust) * 0.74 },
    { t: L.bust, rx: radiusFromCircumference(bust), rz: radiusFromCircumference(bust) * 0.72 },
    { t: 0.78, rx: radiusFromCircumference(bust) * 1.05, rz: radiusFromCircumference(bust) * 0.79 },
    { t: L.shoulder, rx: shoulder / 2, rz: radiusFromCircumference(bust) * 0.84 },
    { t: L.neckBase, rx: (shoulder / 2) * 0.52, rz: 6.0 },
    { t: L.chin, rx: 5.0, rz: 4.8 },
  ]
}

/** 在任意归一化高度上线性插值出截面，供服装壳层采样使用 */
export function sampleBodyRing(rings: BodyRing[], t: number): { rx: number; rz: number } {
  if (t <= rings[0]!.t) return { rx: rings[0]!.rx, rz: rings[0]!.rz }
  const last = rings[rings.length - 1]!
  if (t >= last.t) return { rx: last.rx, rz: last.rz }

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i]!
    const b = rings[i + 1]!
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1)
      return { rx: a.rx + (b.rx - a.rx) * k, rz: a.rz + (b.rz - a.rz) * k }
    }
  }
  return { rx: last.rx, rz: last.rz }
}

/**
 * 把一组截面放样成三维网格。
 * 这是人偶躯干与所有服装壳层共用的基础几何构造器 ——
 * 服装壳层 = 同一组截面 + 径向偏移，因此天然贴合身体（分层刚性贴合策略）。
 */
export function loftGeometry(
  rings: BodyRing[],
  opts: {
    totalHeightCm: number
    scale?: number
    radialSegments?: number
    radialOffsetCm?: number
    capBottom?: boolean
    capTop?: boolean
  },
): THREE.BufferGeometry {
  const {
    totalHeightCm,
    scale = 0.01,
    radialSegments = 48,
    radialOffsetCm = 0,
    capBottom = true,
    capTop = true,
  } = opts

  const rows = rings.length
  const cols = radialSegments + 1 // 首尾重复一列，方便 UV 与法线
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let r = 0; r < rows; r++) {
    const ring = rings[r]!
    const y = ring.t * totalHeightCm * scale
    for (let c = 0; c < cols; c++) {
      const theta = (c / radialSegments) * Math.PI * 2
      const rx = ring.rx + radialOffsetCm
      const rz = ring.rz + radialOffsetCm
      positions.push(Math.cos(theta) * rx * scale, y, Math.sin(theta) * rz * scale)
      uvs.push(c / radialSegments, r / (rows - 1))
    }
  }

  const rowIndex = (r: number, c: number) => r * cols + c

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < radialSegments; c++) {
      const a = rowIndex(r, c)
      const b = rowIndex(r, c + 1)
      const cc = rowIndex(r + 1, c + 1)
      const d = rowIndex(r + 1, c)
      indices.push(a, d, b, b, d, cc)
    }
  }

  // 端盖
  const addCap = (ringIdx: number, flip: boolean) => {
    const ring = rings[ringIdx]!
    const y = ring.t * totalHeightCm * scale
    const centerIdx = positions.length / 3
    positions.push(0, y, 0)
    uvs.push(0.5, 0.5)
    for (let c = 0; c < radialSegments; c++) {
      const a = rowIndex(ringIdx, c)
      const b = rowIndex(ringIdx, c + 1)
      if (flip) indices.push(centerIdx, b, a)
      else indices.push(centerIdx, a, b)
    }
  }
  if (capBottom) addCap(0, false)
  if (capTop) addCap(rows - 1, true)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** 人偶材质：柔和的哑光肤色。刻意比白色衣服暗一档，让浅色单品有对比 */
function mannequinMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xd8cec4,
    roughness: 0.6,
    metalness: 0.0,
  })
}

/**
 * 生成完整人偶。
 * 躯干由身型驱动；四肢与头部为风格化常量（后续可同样参数化）。
 */
export function buildMannequin(profile: BodyProfile): THREE.Group {
  const group = new THREE.Group()
  const scale = 0.01
  const H = profile.heightCm
  const rings = buildTrunkRings(profile)
  const mat = mannequinMaterial()
  const L = BODY_LANDMARKS

  // 躯干
  const trunk = new THREE.Mesh(
    loftGeometry(rings, { totalHeightCm: H, scale, radialSegments: 48 }),
    mat,
  )
  trunk.name = 'trunk'
  group.add(trunk)

  // 四肢：统一由 limb specs 驱动，保证与服装的袖子/裤腿严格对齐
  for (const leg of buildLegSpecs(profile)) {
    const geo = new THREE.CylinderGeometry(leg.radiusTop, leg.radiusBottom, leg.length, 24, 1, false)
    geo.translate(0, -leg.length / 2, 0)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(leg.origin.x, leg.origin.y, leg.origin.z)
    mesh.rotation.z = leg.rotationZ
    mesh.name = leg.side < 0 ? 'leg-left' : 'leg-right'
    group.add(mesh)
  }

  for (const arm of buildArmSpecs(profile)) {
    const geo = new THREE.CylinderGeometry(arm.radiusTop, arm.radiusBottom, arm.length, 20, 1, false)
    geo.translate(0, -arm.length / 2, 0)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(arm.origin.x, arm.origin.y, arm.origin.z)
    mesh.rotation.z = arm.rotationZ
    mesh.name = arm.side < 0 ? 'arm-left' : 'arm-right'
    group.add(mesh)
  }

  // 颈 + 头
  const neckGeo = new THREE.CylinderGeometry(4.8 * scale, 5.6 * scale, (L.chin - L.neckBase) * H * scale, 20)
  const neck = new THREE.Mesh(neckGeo, mat)
  neck.position.set(0, ((L.neckBase + L.chin) / 2) * H * scale, 0)
  neck.name = 'neck'
  group.add(neck)

  // 头部：横向半径约 7.6cm（宽 ~15cm）、纵向放大后高约 19cm，接近真人比例
  const headRadius = H * 0.0455 * scale
  const headGeo = new THREE.SphereGeometry(headRadius, 32, 24)
  headGeo.scale(1, 1.22, 1.06)
  const head = new THREE.Mesh(headGeo, mat)
  head.position.set(0, (L.chin + 0.05) * H * scale, 0)
  head.name = 'head'
  group.add(head)

  group.position.y = 0
  return group
}
