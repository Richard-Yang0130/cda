/**
 * 服装壳层 + 精细穿法 —— 亮点2 Step1/Step2 的实现。
 *
 * 核心策略（对应项目计划里的「降级方案」）：
 *   ❌ 不做真实布料物理 —— 手机端 60fps 做不到，业界也无工程化方案
 *   ✅ 分层刚性贴合 —— 服装 = 身体截面 + 径向偏移，天然贴合、永不穿模
 *   ✅ 顶点解析变形 —— 「扣几颗扣子 / 披 / 围 / 系」用解析位移表达
 *
 * 为什么用「直接顶点变形」而不是 Three.js 的 morph target：
 *   morph target 适合离散的、数量固定的姿态；而「扣子扣几颗」是**连续量**
 *   （0..N 颗），做成 N 个 morph 会爆炸。直接按状态重算顶点更简单也更灵活。
 *   服装壳层只有几百个顶点，每次重算的开销可以忽略。
 */
import * as THREE from 'three'
import type { BodyProfile, BodySlot, WearMode } from '@cda/core'
import { BODY_LANDMARKS, buildArmSpecs, buildLegSpecs, buildTrunkRings, limbPointAt, limbRadiusAt, sampleBodyRing } from './body'

/** 一件单品在 3D 人偶上的挂载描述 */
export interface GarmentSpec {
  id: string
  productId: string
  bodySlot: BodySlot
  /** 覆盖的高度区间（归一化 t） */
  fromT: number
  toT: number
  /** 相对身体表面的向外偏移，单位 cm —— 模拟衣服厚度与松量 */
  offsetCm: number
  /** 颜色 */
  color: number
  /** 扣子总数；有扣件的单品才有 */
  fastenerTotal?: number
  /** 该单品支持的穿法 */
  allowedModes: WearMode[]
  /** 袖长：不填表示无袖。袖子与手臂共用 limb specs，保证严格对齐 */
  sleeve?: 'short' | 'long'
}

/**
 * 单品 3D 描述注册表。
 * demo 阶段按 productId 硬编码；后续应由后台的商品 3D 资产接口返回。
 */
export const GARMENT_REGISTRY: Record<string, Omit<GarmentSpec, 'id' | 'productId'>> = {
  // 白衬衫：上装，长袖，有 5 颗扣子，可正常穿 / 敞开 / 披肩
  p_white_shirt: {
    bodySlot: 'upper',
    fromT: 0.60,
    toT: 0.835,
    offsetCm: 1.4,
    color: 0xf2f2f0,
    fastenerTotal: 5,
    allowedModes: ['worn', 'open', 'draped'],
    sleeve: 'long',
  },
  // 牛仔外套：更厚、松量更大，长袖，同样有扣件
  p_denim_jacket: {
    bodySlot: 'outer',
    fromT: 0.575,
    toT: 0.845,
    offsetCm: 3.0,
    color: 0x8fb4d9,
    fastenerTotal: 4,
    allowedModes: ['worn', 'open', 'draped'],
    sleeve: 'long',
  },
  // 阔腿西裤：下装，无扣件，只能正常穿
  p_wide_trousers: {
    bodySlot: 'lower',
    fromT: 0.10,
    toT: 0.635,
    offsetCm: 2.2,
    color: 0xd9cdbb,
    allowedModes: ['worn'],
  },
  // 围巾：配饰，可围在脖子上 / 披着 / 系在腰上
  p_knit_scarf: {
    bodySlot: 'neck',
    fromT: 0.815,
    toT: 0.885,
    offsetCm: 3.2,
    color: 0xc19a6b,
    allowedModes: ['wrapped', 'draped', 'tied'],
  },
}

/** 每种穿法在 UI 上的中文名 */
export const WEAR_MODE_LABEL: Record<WearMode, string> = {
  worn: '正常穿',
  open: '敞开',
  draped: '披着',
  wrapped: '围起来',
  tied: '系在腰上',
}

interface VertexParam {
  /** 归一化高度 */
  t: number
  /** 绕身体一周的角度，0 = 正前方 */
  theta: number
}

/**
 * 一个可变的服装图层。
 * 持有基准顶点，按 (wearMode, fastenerClosed) 解析计算出当前顶点。
 */
export class Garment {
  readonly object3D: THREE.Object3D
  readonly spec: GarmentSpec

  private readonly meshes: THREE.Mesh[] = []
  /** 每个 mesh 的基准顶点与顶点参数 */
  private readonly bases: { mesh: THREE.Mesh; base: Float32Array; params: VertexParam[] }[] = []

  private _wearMode: WearMode
  private _fastenerClosed: number

  constructor(
    private readonly profile: BodyProfile,
    spec: GarmentSpec,
  ) {
    this.spec = spec
    this._wearMode = spec.allowedModes[0] ?? 'worn'
    this._fastenerClosed = spec.fastenerTotal ?? 0
    this.object3D = this.build()
  }

  get wearMode(): WearMode {
    return this._wearMode
  }

  get fastenerClosed(): number {
    return this._fastenerClosed
  }

  setWearMode(mode: WearMode): void {
    if (!this.spec.allowedModes.includes(mode)) return
    this._wearMode = mode
    this.update()
  }

  setFastenerClosed(n: number): void {
    if (!this.spec.fastenerTotal) return
    this._fastenerClosed = Math.max(0, Math.min(this.spec.fastenerTotal, Math.round(n)))
    this.update()
  }

  setColor(hex: number): void {
    for (const m of this.meshes) {
      ;(m.material as THREE.MeshStandardMaterial).color.setHex(hex)
    }
  }

  private material(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: this.spec.color,
      roughness: 0.78,
      metalness: 0.03,
      side: THREE.DoubleSide,
    })
  }

  // ---------------------------------------------------------------- 构建

  private build(): THREE.Object3D {
    const group = new THREE.Group()
    group.name = `garment:${this.spec.productId}`

    if (this.spec.bodySlot === 'lower') {
      this.buildLegs(group)
    } else if (this.spec.bodySlot === 'neck' || this.spec.bodySlot === 'waist') {
      this.buildBand(group)
    } else {
      this.buildShell(group)
      if (this.spec.sleeve) this.buildSleeves(group, this.spec.sleeve)
    }

    this.update()
    return group
  }

  /** 上装 / 外套 / 连衣裙：绕躯干的壳层 */
  private buildShell(group: THREE.Group): void {
    const H = this.profile.heightCm
    const scale = 0.01
    const rings = buildTrunkRings(this.profile)
    const segs = 48
    const rows = 24

    const positions: number[] = []
    const uvs: number[] = []
    const params: VertexParam[] = []
    const indices: number[] = []

    for (let r = 0; r <= rows; r++) {
      const t = this.spec.fromT + ((this.spec.toT - this.spec.fromT) * r) / rows
      const { rx, rz } = sampleBodyRing(rings, t)
      for (let c = 0; c <= segs; c++) {
        const theta = (c / segs) * Math.PI * 2
        const off = this.spec.offsetCm * scale
        positions.push(Math.cos(theta) * (rx * scale + off), t * H * scale, Math.sin(theta) * (rz * scale + off))
        uvs.push(c / segs, r / rows)
        params.push({ t, theta })
      }
    }

    const rowIdx = (r: number, c: number) => r * (segs + 1) + c
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < segs; c++) {
        const a = rowIdx(r, c)
        const b = rowIdx(r, c + 1)
        const cc = rowIdx(r + 1, c + 1)
        const d = rowIdx(r + 1, c)
        indices.push(a, d, b, b, d, cc)
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    geo.computeVertexNormals()

    const mesh = new THREE.Mesh(geo, this.material())
    mesh.name = this.spec.productId
    group.add(mesh)
    this.meshes.push(mesh)
    this.bases.push({ mesh, base: new Float32Array(positions), params })
  }

  /** 下装：两条绕腿的管子（复用腿部 limb specs） */
  private buildLegs(group: THREE.Group): void {
    const H = this.profile.heightCm
    const scale = 0.01
    const off = this.spec.offsetCm * scale
    const segs = 28
    const rows = 22

    for (const leg of buildLegSpecs(this.profile)) {
      const positions: number[] = []
      const uvs: number[] = []
      const params: VertexParam[] = []
      const indices: number[] = []

      for (let r = 0; r <= rows; r++) {
        const k = r / rows
        // 从裤腰(上) 到 裤脚(下)
        const t = this.spec.toT - (this.spec.toT - this.spec.fromT) * k
        const d = (BODY_LANDMARKS.hip - t) * H * scale
        const center = limbPointAt(leg, d)
        // 裤腰处 d 为负（向上外推），会得到更宽的胯部；设下限避免过宽
        const radius = Math.max(limbRadiusAt(leg, d), leg.radiusTop * 0.55) + off

        for (let c = 0; c <= segs; c++) {
          const theta = (c / segs) * Math.PI * 2
          positions.push(
            center.x + Math.cos(theta) * radius,
            t * H * scale,
            center.z + Math.sin(theta) * radius,
          )
          uvs.push(c / segs, k)
          params.push({ t, theta })
        }
      }

      const rowIdx = (r: number, c: number) => r * (segs + 1) + c
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < segs; c++) {
          const a = rowIdx(r, c)
          const b = rowIdx(r, c + 1)
          const cc = rowIdx(r + 1, c + 1)
          const dd = rowIdx(r + 1, c)
          indices.push(a, b, dd, b, cc, dd)
        }
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geo.setIndex(indices)
      geo.computeVertexNormals()

      const mesh = new THREE.Mesh(geo, this.material())
      mesh.name = `${this.spec.productId}-leg-${leg.side < 0 ? 'l' : 'r'}`
      group.add(mesh)
      this.meshes.push(mesh)
      this.bases.push({ mesh, base: new Float32Array(positions), params })
    }
  }

  /**
   * 袖子：绕手臂的管状壳层。
   *
   * 关键点：手臂的位置、倾角、半径全部取自 body.ts 的 buildArmSpecs，
   * 所以无论身型怎么调，袖子永远精确贴合手臂，不会「飘在空中」或穿模。
   * 半径用 limbRadiusAt 沿臂长插值再加松量，得到自然的锥形袖。
   */
  private buildSleeves(group: THREE.Group, kind: 'short' | 'long'): void {
    const H = this.profile.heightCm
    const scale = 0.01
    const off = this.spec.offsetCm * scale
    const segs = 24
    const rows = 16
    // 短袖覆盖上臂约 1/3，长袖到手腕附近
    const coverage = kind === 'long' ? 0.94 : 0.34

    for (const arm of buildArmSpecs(this.profile)) {
      const len = arm.length * coverage
      const positions: number[] = []
      const uvs: number[] = []
      const params: VertexParam[] = []
      const indices: number[] = []

      for (let r = 0; r <= rows; r++) {
        const k = r / rows
        // 起点略微上移，让袖山与躯干壳层重叠、接缝不露缝
        const d = -0.012 + (len + 0.012) * k
        const center = limbPointAt(arm, d)
        const radius = limbRadiusAt(arm, d) + off

        for (let c = 0; c <= segs; c++) {
          const theta = (c / segs) * Math.PI * 2
          positions.push(
            center.x + Math.cos(theta) * radius,
            center.y,
            center.z + Math.sin(theta) * radius,
          )
          uvs.push(c / segs, k)
          params.push({ t: center.y / (H * scale), theta })
        }
      }

      const rowIdx = (r: number, c: number) => r * (segs + 1) + c
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < segs; c++) {
          const a = rowIdx(r, c)
          const b = rowIdx(r, c + 1)
          const cc = rowIdx(r + 1, c + 1)
          const dd = rowIdx(r + 1, c)
          indices.push(a, dd, b, b, dd, cc)
        }
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geo.setIndex(indices)
      geo.computeVertexNormals()

      const mesh = new THREE.Mesh(geo, this.material())
      mesh.name = `${this.spec.productId}-sleeve-${arm.side < 0 ? 'l' : 'r'}`
      group.add(mesh)
      this.meshes.push(mesh)
      this.bases.push({ mesh, base: new Float32Array(positions), params })
    }
  }

  /** 配饰：围在脖子/腰上的环带 */
  private buildBand(group: THREE.Group): void {
    const H = this.profile.heightCm
    const scale = 0.01
    const rings = buildTrunkRings(this.profile)
    const segs = 64
    const rows = 6
    const off = this.spec.offsetCm * scale
    const positions: number[] = []
    const uvs: number[] = []
    const params: VertexParam[] = []
    const indices: number[] = []

    for (let r = 0; r <= rows; r++) {
      const t = this.spec.fromT + ((this.spec.toT - this.spec.fromT) * r) / rows
      const { rx, rz } = sampleBodyRing(rings, t)
      // 环带比身体略粗，形成蓬松的围巾感
      const bulge = r === 0 || r === rows ? 0 : Math.sin((r / rows) * Math.PI) * 0.012
      for (let c = 0; c <= segs; c++) {
        const theta = (c / segs) * Math.PI * 2
        positions.push(
          Math.cos(theta) * (rx * scale + off + bulge),
          t * H * scale,
          Math.sin(theta) * (rz * scale + off + bulge),
        )
        uvs.push(c / segs, r / rows)
        params.push({ t, theta })
      }
    }

    const rowIdx = (r: number, c: number) => r * (segs + 1) + c
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < segs; c++) {
        const a = rowIdx(r, c)
        const b = rowIdx(r, c + 1)
        const cc = rowIdx(r + 1, c + 1)
        const d = rowIdx(r + 1, c)
        indices.push(a, d, b, b, d, cc)
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    geo.computeVertexNormals()

    const mesh = new THREE.Mesh(geo, this.material())
    mesh.name = this.spec.productId
    group.add(mesh)
    this.meshes.push(mesh)
    this.bases.push({ mesh, base: new Float32Array(positions), params })
  }

  // ---------------------------------------------------------------- 变形

  /**
   * 按当前 (wearMode, fastenerClosed) 重算顶点。
   *
   * 位移全部是解析式，语义如下：
   *   - 张开程度由 wearMode 与扣子状态共同决定
   *   - 扣子越少 / 敞开模式 -> 前襟张开越大
   *   - 披着 -> 整体上移并后仰
   *   - 围起来 -> 向颈部聚拢
   *   - 系在腰上 -> 整体下移到腰部并收紧
   */
  update(): void {
    for (const { mesh, base, params } of this.bases) {
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = position.array as Float32Array

      for (let i = 0; i < params.length; i++) {
        const p = params[i]!
        const ix = i * 3
        const bx = base[ix]!
        const by = base[ix + 1]!
        const bz = base[ix + 2]!

        const d = this.displacement(p, bx, by, bz)

        arr[ix] = bx + d.x
        arr[ix + 1] = by + d.y
        arr[ix + 2] = bz + d.z
      }

      position.needsUpdate = true
      mesh.geometry.computeVertexNormals()
    }
  }

  /** 计算单个顶点的位移（单位：米） */
  private displacement(p: VertexParam, bx: number, by: number, bz: number): { x: number; y: number; z: number } {
    const mode = this._wearMode
    const total = this.spec.fastenerTotal ?? 0
    const closed = this._fastenerClosed

    // 张开程度 0..1：敞开模式直接全开；否则由未扣的扣子比例决定
    let opening = 0
    if (mode === 'open') opening = 1
    else if (total > 0) opening = 1 - closed / total

    // 正前方的权重。
    // 注意参数化是 x=cos(θ), z=sin(θ)，所以 **正前方(+Z)对应 θ=π/2**，
    // 用 cos(θ) 会把"前襟"开到侧面去（曾因此导致敞开模式几乎看不出效果）。
    const front = Math.max(0, Math.sin(p.theta))
    // 越靠上、越靠前，张开越明显（模拟衣襟从上往下敞开）
    const heightK = total > 0 ? Math.max(0, (p.t - this.spec.fromT) / (this.spec.toT - this.spec.fromT)) : 0

    let dx = 0
    let dy = 0
    let dz = 0

    // --- 前襟张开 ---
    if (opening > 0.001 && front > 0.001) {
      const amount = opening * Math.pow(front, 1.4) * (0.35 + 0.65 * heightK)
      dx += Math.sign(bx) * amount * 0.035
      dz += amount * 0.045
    }

    // --- 披着：整体上移 + 后仰 + 略微放松 ---
    if (mode === 'draped') {
      const k = (p.t - this.spec.fromT) / Math.max(1e-6, this.spec.toT - this.spec.fromT)
      dy += 0.045 + k * 0.02
      dz -= 0.03 * k
      dx += bx * 0.06
    }

    // --- 围起来：向颈部聚拢 ---
    if (mode === 'wrapped') {
      const neckY = BODY_LANDMARKS.neckBase * this.profile.heightCm * 0.01
      dy += (neckY - by) * 0.75
      dx += bx * -0.1
      dz += bz * -0.1
    }

    // --- 系在腰上：下移到腰部并收紧 ---
    if (mode === 'tied') {
      const waistY = BODY_LANDMARKS.waist * this.profile.heightCm * 0.01
      dy += (waistY - by) * 0.9
      dx += bx * -0.18
      dz += bz * -0.18
    }

    return { x: dx, y: dy, z: dz }
  }
}

/** 便捷工厂 */
export function createGarment(profile: BodyProfile, productId: string, colorHex?: number): Garment | null {
  const reg = GARMENT_REGISTRY[productId]
  if (!reg) return null
  const spec: GarmentSpec = {
    id: `g_${productId}`,
    productId,
    ...reg,
    color: reg.color,
  }
  const g = new Garment(profile, spec)
  if (colorHex !== undefined) g.setColor(colorHex)
  return g
}
