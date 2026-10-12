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
  const radiusTop = (bust * 0.052) * scale

  return ([-1, 1] as const).map((side) => ({
    side,
    origin: {
      x: side * (shoulder / 2) * scale,
      y: BODY_LANDMARKS.shoulder * H * scale,
      z: 0,
    },
    rotationZ: side * 0.13,
    // 手腕应落在胯部附近（约 0.47H）。原先算到 0.36H，手臂长过胯，
    // 视觉上像猿臂 —— 这也是袖子看起来拖沓的根因。
    length: (BODY_LANDMARKS.shoulder - 0.47) * H * scale,
    radiusTop,
    radiusBottom: radiusTop * 0.66,
  }))
}

export function buildLegSpecs(p: BodyProfile): LimbSpec[] {
  const scale = 0.01
  const H = p.heightCm
  const hipR = radiusFromCircumference(p.hipCm ?? p.weightKg * 1.62)
  const radiusTop = hipR * 0.43 * scale

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
    // 踝部太细会让人台显得发飘，5cm 左右比较稳
    radiusBottom: radiusTop * 0.5,
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
    // 骨盆到底裆要「渐进收窄」，不能一步台阶下到底：
    // 原来只有一环（0.45 -> 0.405 且半径陡降），白色材质下会露出一块方形台阶。
    // 现在分三环收，末端很窄，正好藏在两条大腿之间。
    { t: L.crotch - 0.085, rx: radiusFromCircumference(hip) * 0.42, rz: radiusFromCircumference(hip) * 0.34 },
    { t: L.crotch - 0.035, rx: radiusFromCircumference(hip) * 0.78, rz: radiusFromCircumference(hip) * 0.62 },
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

/**
 * 人台材质：白色哑光树脂（白模）。
 *
 * 为什么从拟真肤色改为白模：
 *   程序化几何做不出可信的人体细节（五官、肌肉、皮肤质感），
 *   而「肤色 + 无五官」会正好落进恐怖谷 —— 观众本能地拿它跟真人比，
 *   然后觉得丑且诡异。
 *   白模是展示业界的既定语言：服装店里的人台本来就不像人。
 *   它主动放弃拟真，因此不会被拿来跟真人比较，丑的问题从根上消失。
 *
 * clearcoat 给一点树脂光泽，让白色形体在棚灯下有层次，不至于死白一片。
 */
function mannequinMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    // 略偏灰而非纯白：纯白会和白衬衫（0xf2f2f0）糊成一片。
    // 真正区分两者的是质感 —— 人台是亮面树脂，衣服是哑光布料。
    color: 0xece8e3,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.4,
  })
}

/**
 * 头颈一体成型（LatheGeometry 旋转体）。
 *
 * 原来用「球 + 圆柱」拼，接缝在白色材质下会非常明显。
 * 旋转体可以画出一条连续、优雅的侧面轮廓 —— 这是人台最该做好的地方。
 */
function buildHeadAndNeck(profile: BodyProfile, mat: THREE.Material): THREE.Mesh {
  const unit = profile.heightCm * 0.01
  const k = unit / 1.68 // 以 1.68m 的人台为基准等比缩放
  // 剖面点：[半径(米), 相对颈根的高度(米)]
  const section: Array<[number, number]> = [
    [0.0, 0.0],
    [0.052, 0.0],
    [0.049, 0.018],
    [0.044, 0.04], // 颈部最细
    [0.048, 0.058],
    [0.061, 0.074], // 下颌
    [0.072, 0.098],
    [0.078, 0.13], // 最宽
    [0.074, 0.164],
    [0.06, 0.198],
    [0.035, 0.222],
    [0.0, 0.232], // 头顶
  ]
  const points = section.map(([r, y]) => new THREE.Vector2(r * k, y * k))
  const geometry = new THREE.LatheGeometry(points, 44)
  geometry.translate(0, BODY_LANDMARKS.neckBase * unit, 0)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.name = 'head'
  return mesh
}

/**
 * 生成完整人台。
 *
 * 结构要点：四肢是圆柱，直接插进躯干会在白色材质下露出平截面接缝，
 * 所以在每个关节处补一颗球做过渡，并在肢体末端补手脚 ——
 * 这是把人台从「几根管子拼起来」变成「一件雕塑」的关键。
 */
export function buildMannequin(profile: BodyProfile): THREE.Group {
  const group = new THREE.Group()
  const scale = 0.01
  const H = profile.heightCm
  const rings = buildTrunkRings(profile)
  const mat = mannequinMaterial()

  // 躯干：径向分段提到 64，白色表面上分段不足会看出棱面
  const trunk = new THREE.Mesh(
    loftGeometry(rings, { totalHeightCm: H, scale, radialSegments: 64 }),
    mat,
  )
  trunk.name = 'trunk'
  group.add(trunk)

  // ── 腿 ──
  for (const leg of buildLegSpecs(profile)) {
    const geo = new THREE.CylinderGeometry(leg.radiusTop, leg.radiusBottom, leg.length, 32, 1, false)
    geo.translate(0, -leg.length / 2, 0)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(leg.origin.x, leg.origin.y, leg.origin.z)
    mesh.rotation.z = leg.rotationZ
    mesh.name = leg.side < 0 ? 'leg-left' : 'leg-right'
    group.add(mesh)

    // 髋关节球：把「圆柱硬插进躯干」变成自然过渡
    const hipBall = new THREE.Mesh(new THREE.SphereGeometry(leg.radiusTop * 1.12, 30, 22), mat)
    hipBall.position.set(leg.origin.x, leg.origin.y, 0)
    hipBall.name = `${mesh.name}-joint`
    group.add(hipBall)

    // 脚：向前(+Z)伸出的扁椭球，避免腿以平截面收尾
    const ankle = limbPointAt(leg, leg.length)
    const foot = new THREE.Mesh(new THREE.SphereGeometry(leg.radiusBottom * 1.5, 26, 18), mat)
    foot.scale.set(1.0, 0.5, 1.9)
    foot.position.set(ankle.x, ankle.y + leg.radiusBottom * 0.35, ankle.z + leg.radiusBottom * 1.15)
    foot.name = `${mesh.name}-foot`
    group.add(foot)
  }

  // ── 臂 ──
  for (const arm of buildArmSpecs(profile)) {
    const geo = new THREE.CylinderGeometry(arm.radiusTop, arm.radiusBottom, arm.length, 28, 1, false)
    geo.translate(0, -arm.length / 2, 0)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(arm.origin.x, arm.origin.y, arm.origin.z)
    mesh.rotation.z = arm.rotationZ
    mesh.name = arm.side < 0 ? 'arm-left' : 'arm-right'
    group.add(mesh)

    // 肩关节球：藏住圆柱顶端的平截面，做出圆润的肩头
    const shoulderBall = new THREE.Mesh(new THREE.SphereGeometry(arm.radiusTop * 1.28, 30, 22), mat)
    shoulderBall.position.set(arm.origin.x, arm.origin.y - arm.radiusTop * 0.15, 0)
    shoulderBall.name = `${mesh.name}-joint`
    group.add(shoulderBall)

    // 手：扁长的椭球，比平截面收尾自然得多
    const wrist = limbPointAt(arm, arm.length)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(arm.radiusBottom * 1.45, 26, 18), mat)
    hand.scale.set(0.85, 1.6, 0.6)
    hand.position.set(wrist.x, wrist.y - arm.radiusBottom * 0.9, wrist.z)
    hand.rotation.z = arm.rotationZ
    hand.name = `${mesh.name}-hand`
    group.add(hand)
  }

  // ── 头颈 ──
  group.add(buildHeadAndNeck(profile, mat))

  return group
}
