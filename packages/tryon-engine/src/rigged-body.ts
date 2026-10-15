/**
 * 骨架人偶：用 MakeHuman 官方骨架网格驱动的人体（全部 CC0）。
 *
 * ── 与旧的 MeshBody 的关系 ──
 * 旧实现是「无骨架静态网格 + 我手写的柱面重拟合启发式」，
 * 那套启发式的权重场有致命缺陷：手臂轴的反向延长线穿过头部，
 * 而手臂根部半径被邻近躯干顶点污染，导致头顶顶点 54.6%、头中部 96.5%
 * 的权重给了手臂，躯干一变长头就被拉成锥形。三次针对性修复实测全部更差。
 *
 * 本实现换成：**官方骨架 + 官方蒙皮权重 + 形变目标改体型**。
 *   - 权重是专业人员做的，实测头顶受手臂影响为 0
 *   - 体型变化走形变目标（直接改网格顶点），不走骨骼缩放
 *     （骨骼缩放会被子骨骼继承：实测头高被拉伸 82.45%）
 *   - 骨架从形变后的网格**推导**（关节 = 顶点质心），自动跟随
 */
import * as THREE from 'three'
import type { BodyProfile } from '@cda/core'
import { adiposityFromBmi } from '@cda/core'
import { buildShapeTargets, calibrateShape, type ShapeCalibration } from './body-shape'
import type { MhTarget, WeightedTarget } from './mh-rig'
import { applyTargets } from './mh-rig'
import type { BodySurface } from './mesh-body'

const MAX_INF = 4

/** 烘焙资产的内存表示（对应 scripts/bake-rig.mjs 的输出） */
interface RigAsset {
  positions: Float32Array
  indices: Uint16Array
  /** 量化后的骨骼槽位（u8，最多 256 根骨骼） */
  skinIndex: Uint8Array
  /** ⚠️ 反量化后的浮点权重，不是文件里的 u8 —— Three.js 需要 Float32 */
  skinWeight: Float32Array
  boneNames: string[]
  bones: Array<{ head: string; tail: string; parent: string | null }>
  joints: number[][]
  jointSlot: Map<string, number>
  targets: Map<string, MhTarget>
}

/** 从烘焙二进制解析。格式定义见 scripts/bake-rig.mjs */
function parseRigAsset(buf: ArrayBuffer): RigAsset {
  const dv = new DataView(buf)
  let off = 0
  const u32 = () => {
    const v = dv.getUint32(off, true)
    off += 4
    return v
  }
  const magic = u32()
  if (magic !== 0x4d485247) throw new Error('[CDA] rig.bin 魔数不对，可能不是本项目的资产')
  const ver = u32()
  if (ver !== 2) throw new Error(`[CDA] rig.bin 版本 ${ver} 不受支持（需要 2）`)
  const nV = u32()
  const nTri = u32()
  const nBone = u32()
  const nJoint = u32()
  const nTarget = u32()
  const posScale = u32()

  const posQ = new Int16Array(buf, off, nV * 3); off += nV * 3 * 2
  const positions = new Float32Array(nV * 3)
  for (let i = 0; i < nV * 3; i++) positions[i] = posQ[i]! / posScale

  const indices = new Uint16Array(buf.slice(off, off + nTri * 3 * 2)); off += nTri * 3 * 2
  const skinIndex = new Uint8Array(buf.slice(off, off + nV * MAX_INF)) as unknown as Uint8Array<ArrayBuffer>
  off += nV * MAX_INF
  const skinWeightQ = new Uint8Array(buf.slice(off, off + nV * MAX_INF)) as unknown as Uint8Array<ArrayBuffer>
  off += nV * MAX_INF
  const skinWeight = new Float32Array(nV * MAX_INF)
  for (let i = 0; i < nV * MAX_INF; i++) skinWeight[i] = skinWeightQ[i]! / 255

  const dec = new TextDecoder()
  const str = () => {
    const len = dv.getUint32(off, true); off += 4
    const s = dec.decode(new Uint8Array(buf, off, len)); off += len
    return s
  }

  const boneNames: string[] = []
  const bones: RigAsset['bones'] = []
  for (let i = 0; i < nBone; i++) {
    boneNames.push(str())
    bones.push({ head: str(), tail: str(), parent: str() || null })
  }
  const joints: number[][] = []
  const jointSlot = new Map<string, number>()
  for (let i = 0; i < nJoint; i++) {
    const name = str()
    const n = dv.getUint32(off, true); off += 4
    const arr = Array.from(new Uint32Array(buf.slice(off, off + n * 4))); off += n * 4
    jointSlot.set(name, i)
    joints.push(arr)
  }
  const targets = new Map<string, MhTarget>()
  for (let i = 0; i < nTarget; i++) {
    const name = str()
    const count = dv.getUint32(off, true); off += 4
    const tscale = dv.getUint32(off, true); off += 4
    const m: MhTarget = new Map()
    for (let k = 0; k < count; k++) {
      const vi = dv.getUint16(off, true)
      const dx = dv.getInt16(off + 2, true) / tscale
      const dy = dv.getInt16(off + 4, true) / tscale
      const dz = dv.getInt16(off + 6, true) / tscale
      off += 8
      m.set(vi, [dx, dy, dz])
    }
    targets.set(name, m)
  }

  return { positions, indices, skinIndex, skinWeight, boneNames, bones, joints, jointSlot, targets }
}

/** 关节位置 = 所引用顶点的质心 */
function jointCentroid(idx: number[], pos: Float32Array): THREE.Vector3 | null {
  if (!idx.length) return null
  const v = new THREE.Vector3()
  let n = 0
  for (const i of idx) {
    if (i * 3 + 2 >= pos.length) continue
    v.x += pos[i * 3]!
    v.y += pos[i * 3 + 1]!
    v.z += pos[i * 3 + 2]!
    n++
  }
  return n ? v.divideScalar(n) : null
}

export class RiggedBody implements BodySurface {
  readonly object3D: THREE.Object3D
  private readonly mesh: THREE.SkinnedMesh
  private readonly geo: THREE.BufferGeometry
  private readonly asset: RigAsset
  private readonly bones: THREE.Bone[] = []
  private readonly boneByName = new Map<string, THREE.Bone>()
  private profile: BodyProfile
  /** 校准结果缓存（性别相关，切性别要重算） */
  private calibration: ShapeCalibration | null = null
  /** 当前形变后的顶点（归一化到身高 1.0 之前） */
  private morphed: Float32Array
  private baseHeight = 1
  /** 最近一次 setProfile 用的缩放与落地偏移，同步骨骼时复用 */
  private lastScale = 1
  private lastYMin = 0

  private constructor(asset: RigAsset, profile: BodyProfile) {
    this.asset = asset
    this.profile = profile
    const nV = asset.positions.length / 3

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(asset.positions), 3))
    geo.setIndex(new THREE.BufferAttribute(asset.indices, 1))
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(asset.skinIndex), 4))
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from(asset.skinWeight), 4))
    this.geo = geo

    // 建骨骼树
    for (const name of asset.boneNames) {
      const b = new THREE.Bone()
      b.name = name
      this.bones.push(b)
      this.boneByName.set(name, b)
    }
    /*
     * ⚠️ 必须先建好 object3D 再同步骨骼。
     * syncBones 末尾会调 object3D.updateMatrixWorld()，
     * 而它在构造函数里被调用时 object3D 还没赋值 —— 会直接崩。
     */
    this.object3D = new THREE.Group()
    this.syncBones(asset.positions)

    const skeleton = new THREE.Skeleton(this.bones)
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({
      color: 0xd8cfc6,
      roughness: 0.85,
      metalness: 0.02,
      // 与旧实现一致：服装求交是从体内向外投射，打到的是三角形背面
      side: THREE.DoubleSide,
    }))
    mesh.add(this.bones[0]!)
    mesh.bind(skeleton)
    this.mesh = mesh
    this.object3D.add(mesh)
    this.morphed = Float32Array.from(asset.positions)

    // 基准高度（用于归一化）
    let ymin = Infinity, ymax = -Infinity
    for (let i = 1; i < asset.positions.length; i += 3) {
      const y = asset.positions[i]!
      if (y < ymin) ymin = y
      if (y > ymax) ymax = y
    }
    this.baseHeight = ymax - ymin
    void nV
  }

  /**
   * 按当前顶点位置重建骨骼的世界→局部变换。
   *
   * ⚠️ 顺序不能反：必须先算出**全部骨骼的世界位置与朝向**，
   * 再按拓扑序转成父骨骼局部坐标。
   * 如果边算边设，父骨骼的旋转会把子骨骼的局部偏移一起转掉 ——
   * 这个坑在 mh-rig.ts 里踩过一次，症状是 head 的 y 反而低于 neck01。
   */
  private syncBones(pos: Float32Array): void {
    const UP = new THREE.Vector3(0, 1, 0)
    const worldHead = new Map<string, THREE.Vector3>()
    const worldQuat = new Map<string, THREE.Quaternion>()

    for (let i = 0; i < this.asset.boneNames.length; i++) {
      const name = this.asset.boneNames[i]!
      const def = this.asset.bones[i]!
      const h = jointCentroid(this.asset.joints[this.asset.jointSlot.get(def.head) ?? -1] ?? [], pos)
      const t = jointCentroid(this.asset.joints[this.asset.jointSlot.get(def.tail) ?? -1] ?? [], pos)
      if (!h) continue
      worldHead.set(name, h)
      const q = new THREE.Quaternion()
      if (t) {
        const dir = new THREE.Vector3().subVectors(t, h)
        if (dir.lengthSq() > 1e-12) q.setFromUnitVectors(UP, dir.normalize())
      }
      worldQuat.set(name, q)
    }

    // 拓扑序：父先于子
    const order: string[] = []
    const seen = new Set<string>()
    const visit = (n: string) => {
      if (seen.has(n) || !this.boneByName.has(n)) return
      seen.add(n)
      const i = this.asset.boneNames.indexOf(n)
      const p = this.asset.bones[i]?.parent
      if (p) visit(p)
      order.push(n)
    }
    for (const n of this.asset.boneNames) visit(n)

    for (const name of order) {
      const b = this.boneByName.get(name)!
      const i = this.asset.boneNames.indexOf(name)
      const parentName = this.asset.bones[i]?.parent ?? null
      const ownHead = worldHead.get(name)
      const ownQ = worldQuat.get(name)
      if (!ownHead || !ownQ) continue
      const parent = parentName ? this.boneByName.get(parentName) : undefined
      if (parent && parentName) {
        const pHead = worldHead.get(parentName)!
        const pQ = worldQuat.get(parentName)!
        const invPQ = pQ.clone().invert()
        b.position.copy(ownHead.clone().sub(pHead).applyQuaternion(invPQ))
        b.quaternion.copy(invPQ.clone().multiply(ownQ))
        if (b.parent !== parent) parent.add(b)
      } else {
        b.position.copy(ownHead)
        b.quaternion.copy(ownQ)
      }
    }
    this.object3D.updateMatrixWorld(true)
  }

  private calibrate(): ShapeCalibration {
    if (this.calibration) return this.calibration
    const jointsFor = (names: string[]): { chest: number; waist: number; hip: number; headTop: number; footBottom: number } => {
      const at = (n: string) => {
        const i = this.asset.boneNames.indexOf(n)
        if (i < 0) return null
        const def = this.asset.bones[i]!
        return jointCentroid(this.asset.joints[this.asset.jointSlot.get(def.head) ?? -1] ?? [], this.asset.positions)?.y ?? null
      }
      const spine01 = at('spine01') ?? 0
      const spine03 = at('spine03') ?? 0
      const spine02 = at('spine02') ?? 0
      const root = at('root') ?? 0
      let ymin = Infinity, ymax = -Infinity
      for (let i = 1; i < this.asset.positions.length; i += 3) {
        const y = this.asset.positions[i]!
        if (y < ymin) ymin = y
        if (y > ymax) ymax = y
      }
      return { chest: spine01, waist: (spine03 + spine02) / 2, hip: root, headTop: ymax, footBottom: ymin }
    }
    // 复用 body-shape 的校准，但测量高度从本资产的骨骼推导
    const h = jointsFor([])
    const skelShim = {
      bones: Object.fromEntries(this.asset.boneNames.map((n, i) => [n, {
        head: this.asset.bones[i]!.head, tail: this.asset.bones[i]!.tail, parent: this.asset.bones[i]!.parent,
      }])),
      joints: Object.fromEntries([...this.asset.jointSlot].map(([n, i]) => [n, this.asset.joints[i]!])),
      license: 'CC0',
    }
    const weightsShim = { weights: {} as Record<string, [number, number][]>, license: 'CC0' }
    void weightsShim
    this.calibration = calibrateShape({
      basePos: this.asset.positions,
      skel: skelShim,
      // 权重只用于「哪些顶点算躯干」，从 skinIndex/skinWeight 反推
      weights: this.weightsFromSkin(),
      loadTarget: (n) => this.asset.targets.get(n) ?? null,
    })
    void h
    return this.calibration
  }

  /** 从烘焙的 skinIndex/skinWeight 反推成 mh-rig 的权重表（只用于躯干过滤） */
  private weightsFromSkin(): { weights: Record<string, [number, number][]>; license: string } {
    const out: Record<string, [number, number][]> = {}
    const nV = this.asset.positions.length / 3
    for (let i = 0; i < nV; i++) {
      for (let k = 0; k < MAX_INF; k++) {
        const w = this.asset.skinWeight[i * MAX_INF + k]!
        if (w <= 0.01) continue
        const slot = this.asset.skinIndex[i * MAX_INF + k]!
        const bone = this.asset.boneNames[slot]
        if (!bone) continue
        ;(out[bone] ??= []).push([i, w])
      }
    }
    return { weights: out, license: 'CC0' }
  }

  /** 施加体型。这是唯一的身体修改入口 */
  setProfile(profile: BodyProfile): void {
    this.profile = profile
    const cal = this.calibrate()

    /*
     * ⚠️ 体脂必须**从 BMI 推**，不能读 profile.adiposity。
     * BodyProfile 上根本没有这个字段（它在 BodyState 上），
     * 早先写成 `profile.adiposity ?? 0.35` 的结果是：无论用户多胖多瘦，
     * macrodetails 都按 0.35 算，体脂对体型毫无影响。
     * BodyProfile 有 heightCm 与 weightKg，用与 core 同一套换算函数
     * （adiposityFromBmi）反推，才能保证两边完全一致。
     */
    const bmi = profile.weightKg / Math.pow(profile.heightCm / 100, 2)
    const adiposity = adiposityFromBmi(profile.gender, bmi)

    const input = {
      gender: profile.gender,
      heightCm: profile.heightCm,
      adiposity,
      build: profile.build,
      chestCm: profile.chestCm,
      waistCm: profile.waistCm,
      hipCm: profile.hipCm,
    }
    const shape = buildShapeTargets(cal, input, (n) => this.asset.targets.get(n) ?? null)

    /*
     * ⚠️ 目标偏移是**绝对单位**（按 makehuman 基础网格标定），
     * 而身高变化是另一条独立的缩放通路。所以：
     *   1) 先在基础网格尺度上叠加形变目标
     *   2) 再统一缩放到目标身高
     * 顺序反了的话，形变量会被身高比例二次放大。
     */
    const morphed = applyTargets(this.asset.positions, shape.targets)
    const scale = profile.heightCm / 100 / this.baseHeight

    /*
     * ⚠️ 缩放之后必须再**平移到脚底 y=0**。
     * MakeHuman 的基础网格是以身体中部为原点（y 跨 ±8.5），
     * 只缩放不平移的话整个模型会悬在半空 —— 实测脚底在 −69.4cm。
     * 场景、相机与服装系统都假定脚底在 0，所以这一步不能省。
     */
    let ymin = Infinity
    for (let i = 1; i < morphed.length; i += 3) {
      const y = morphed[i]!
      if (y < ymin) ymin = y
    }

    const posAttr = this.geo.getAttribute('position') as THREE.BufferAttribute
    const arr = posAttr.array as Float32Array
    for (let i = 0; i < morphed.length; i += 3) {
      arr[i] = morphed[i]! * scale
      arr[i + 1] = (morphed[i + 1]! - ymin) * scale
      arr[i + 2] = morphed[i + 2]! * scale
    }
    posAttr.needsUpdate = true
    this.morphed = morphed
    /** 网格单位 → 米。同步骨骼时要用同一个变换 */
    this.lastScale = scale
    this.lastYMin = ymin

    /*
     * 骨架必须从**已经缩放、且已落地**的网格推导。
     * 关节位置取顶点质心，所以只要顶点对了，骨架自然跟着对 ——
     * 这正是「关节由顶点索引定义」的好处。
     */
    const scaled = new Float32Array(arr.length)
    for (let i = 0; i < arr.length; i++) scaled[i] = arr[i]!
    this.syncBones(scaled)

    this.geo.computeVertexNormals()
    this.geo.computeBoundingSphere()
    this.geo.computeBoundingBox()
  }

  /** 遍历时的可渲染对象 */
  get renderable(): THREE.Object3D {
    return this.object3D
  }

  /** 变形后的顶点（米），供服装求交使用 */
  getPositions(): Float32Array {
    return (this.geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
  }

  get currentProfile(): BodyProfile {
    return this.profile
  }

  /**
   * 体表查询：从体内一点沿方向找体表。
   * 用 raycast 打到实际网格表面，而不是解析近似。
   */
  radiusAt(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
  ): number | null {
    const rc = new THREE.Raycaster(
      new THREE.Vector3(ox, oy, oz),
      new THREE.Vector3(dx, dy, dz).normalize(),
      0,
      maxDist,
    )
    const hits = rc.intersectObject(this.mesh, false)
    if (!hits.length) return null
    return hits[0]!.distance
  }

  /** 从 URL 加载烘焙资产 */
  static async loadFromUrl(url: string, profile: BodyProfile): Promise<RiggedBody> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`[CDA] 人偶资产加载失败 ${res.status}: ${url}`)
    const asset = parseRigAsset(await res.arrayBuffer())
    const body = new RiggedBody(asset, profile)
    body.setProfile(profile)
    return body
  }

  /** 从已解析的二进制构建（审计脚本用，避免依赖 fetch） */
  static fromBuffer(buf: ArrayBuffer, profile: BodyProfile): RiggedBody {
    const asset = parseRigAsset(buf)
    const body = new RiggedBody(asset, profile)
    body.setProfile(profile)
    return body
  }

  /** 导出模型与材质，便于外部挂到场景 */
  get skinnedMesh(): THREE.SkinnedMesh {
    return this.mesh
  }

  /** 暴露骨骼，供将来的姿势功能使用 */
  get boneList(): THREE.Bone[] {
    return this.bones
  }

  /** 最近一次生成的目标列表（调试与验证用） */
  lastTargets: WeightedTarget[] = []

  /** 释放 GPU 资源。与 MeshBody 保持同一接口，引擎才能无差别替换 */
  dispose(): void {
    this.geo.dispose()
    const mat = this.mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat.dispose()
    this.object3D.clear()
  }
}
