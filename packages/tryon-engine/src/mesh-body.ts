/**
 * 雕刻网格人体。
 *
 * 分工：
 *   解剖细节（肌肉分界、手指、五官）来自 MakeHuman 的 CC0 雕刻网格 —— 我们生成不了
 *   体型变化（181cm/94kg 该多粗）由已有的耦合模型驱动 —— 我们自己的成果
 *
 * 重拟合算法：**按肢体段做径向缩放**。
 *   1. 载入时把网格归一化（身高 1.0、脚底 y=0、中轴 x=0）
 *   2. 从网格自身量出各控制高度上的参考半径与各肢体段的轴心
 *   3. 改体型时，用耦合模型算出目标半径，对每个顶点沿它所属段做径向缩放
 *
 * 这样骨骼比例、关节位置、肌肉形态都由雕刻保留，
 * 变动的只有围度与身高 —— 正是「同一个人变胖变瘦」应有的效果。
 */
import * as THREE from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { defaultBodyProfile, type BodyProfile } from '@cda/core'

/** 一个控制高度上的参考信息 */
interface ControlLevel {
  /** 归一化高度 0..1 */
  y: number
  /** 该高度上「躯干」（靠近中轴）的参考半径，米（归一化前，身高=1） */
  trunkR: number
}

/** 一条肢体段的轴心随高度的走向 */
interface LimbAxis {
  y: number
  cx: number
  cz: number
  r: number
}

export interface MeshBodySpec {
  url: string
  gender: 'male' | 'female'
}

/**
 * 归一化后的控制高度。取自 mesh-rig.ts 的实测值 ——
 * 不能用 body.ts 里按测量均值推的比例，两者不一致，会错位。
 */
const LEVELS = { ankle: 0.075, knee: 0.28, crotch: 0.5, hip: 0.53, waist: 0.6, chest: 0.72, shoulder: 0.82 }
/** A 字站姿下肘与腕的大致高度（网格实测：腕约 0.57） */
const ELBOW_Y = 0.65
const WRIST_Y = 0.57

function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[s.length >> 1]!
}

export class MeshBody {
  readonly object3D: THREE.Object3D
  private readonly mesh: THREE.Mesh
  private readonly geo: THREE.BufferGeometry
  /** 归一化后的原始顶点（身高 1.0），每次重拟合都从这里出发，避免累积误差 */
  private readonly base: Float32Array
  private readonly trunk: ControlLevel[]
  /** 左右两侧的腿/臂轴心。用显式字段而不是 Record<1|-1>，避免靠断言糊过去 */
  private readonly legAxisR: LimbAxis[]
  private readonly legAxisL: LimbAxis[]
  private readonly armAxisR: LimbAxis[]
  private readonly armAxisL: LimbAxis[]
  private profile: BodyProfile

  private constructor(
    obj: THREE.Object3D,
    profile: BodyProfile,
    spec: MeshBodySpec,
  ) {
    this.profile = profile
    // 取第一个网格
    let found: THREE.Mesh | null = null
    obj.traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh
    })
    if (!found) throw new Error('[CDA] OBJ 里没有网格')
    this.mesh = found
    this.geo = this.mesh.geometry
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute

    // ── 归一化：按包围盒**中心**平移（不能用 min，那会把中轴推歪），
    //    再缩放到身高 1.0、脚底 y=0 ──
    const box = new THREE.Box3().setFromBufferAttribute(pos)
    const cx = (box.min.x + box.max.x) / 2
    const rawH = box.max.y - box.min.y
    const base = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      base[i * 3] = (pos.getX(i) - cx) / rawH
      base[i * 3 + 1] = (pos.getY(i) - box.min.y) / rawH
      base[i * 3 + 2] = pos.getZ(i) / rawH
    }
    this.base = poseArmsDown(base)

    this.trunk = this.measureTrunk(this.base)
    this.legAxisR = this.measureLeg(this.base, 1)
    this.legAxisL = this.measureLeg(this.base, -1)
    this.armAxisR = this.measureArm(this.base, 1)
    this.armAxisL = this.measureArm(this.base, -1)

    // 白模材质
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xece8e3,
      roughness: 0.34,
      clearcoat: 0.4,
      clearcoatRoughness: 0.4,
      metalness: 0,
    })
    this.mesh.material = mat
    this.geo.computeVertexNormals()
    this.object3D = new THREE.Group()
    this.object3D.add(this.mesh)
    void spec
  }

  /** 从 OBJ 文本构建（H5 下用 fetch 取文本，小程序需要换成平台读取） */
  static async loadFromUrl(url: string, profile: BodyProfile, gender: 'male' | 'female'): Promise<MeshBody> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`[CDA] 网格加载失败 ${res.status}: ${url}`)
    const text = await res.text()
    const obj = new OBJLoader().parse(text)
    return new MeshBody(obj, profile, { url, gender })
  }

  /** 量出各控制高度上躯干的参考半径 */
  private measureTrunk(base: Float32Array): ControlLevel[] {
    const out: ControlLevel[] = []
    for (const y of [LEVELS.hip, LEVELS.waist, LEVELS.chest, LEVELS.shoulder]) {
      const rs: number[] = []
      for (let i = 0; i < base.length; i += 3) {
        const vy = base[i + 1]!
        if (Math.abs(vy - y) > 0.015) continue
        const vx = base[i]!
        // 只取靠近中轴的顶点（躯干），排除手臂
        if (Math.abs(vx) > 0.13) continue
        rs.push(Math.hypot(vx, base[i + 2]!))
      }
      out.push({ y, trunkR: median(rs) })
    }
    return out
  }

  /** 量出单侧腿在各高度的轴心与半径 */
  private measureLeg(base: Float32Array, side: 1 | -1): LimbAxis[] {
    const ys = [LEVELS.ankle, LEVELS.knee, LEVELS.crotch - 0.05]
    const out: LimbAxis[] = []
    for (const y of ys) {
      const xs: number[] = []
      const zs: number[] = []
      const pts: Array<[number, number]> = []
      for (let i = 0; i < base.length; i += 3) {
        const vy = base[i + 1]!
        if (Math.abs(vy - y) > 0.015) continue
        const vx = base[i]!
        if (Math.sign(vx) !== side || Math.abs(vx) < 0.02) continue
        xs.push(vx)
        zs.push(base[i + 2]!)
        pts.push([vx, base[i + 2]!])
      }
      const cx = median(xs)
      const cz = median(zs)
      const rs = pts.map(([x, z]) => Math.hypot(x - cx, z - cz))
      out.push({ y, cx, cz, r: median(rs) })
    }
    return out
  }

  /** 量出单侧上臂在各高度的轴心与半径 */
  private measureArm(base: Float32Array, side: 1 | -1): LimbAxis[] {
    const out: LimbAxis[] = []
    for (const y of [ELBOW_Y, WRIST_Y]) {
      const pts: Array<[number, number]> = []
      for (let i = 0; i < base.length; i += 3) {
        const vy = base[i + 1]!
        if (Math.abs(vy - y) > 0.015) continue
        const vx = base[i]!
        if (Math.sign(vx) !== side) continue
        if (Math.abs(vx) < 0.14) continue // 排除躯干
        pts.push([vx, base[i + 2]!])
      }
      const cx = median(pts.map((p) => p[0]))
      const cz = median(pts.map((p) => p[1]))
      const rs = pts.map(([x, z]) => Math.hypot(x - cx, z - cz))
      out.push({ y, cx, cz, r: median(rs) })
    }
    return out
  }

  /** 在某高度的参考躯干半径（线性插值） */
  private refTrunkR(y: number): number {
    const L = this.trunk
    if (y <= L[0]!.y) return L[0]!.trunkR
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i]!
      const b = L[i + 1]!
      if (y >= a.y && y <= b.y) {
        const k = (y - a.y) / (b.y - a.y)
        return a.trunkR + (b.trunkR - a.trunkR) * k
      }
    }
    return L[L.length - 1]!.trunkR
  }

  /**
   * 按新的身型数据重拟合。
   *
   * 每个顶点按所属区域取不同的增益：
   *   裆以下 → 腿段（按该侧腿轴心做径向缩放）
   *   裆到肩 → 躯干（按中轴）/ 手臂（按该侧臂轴心，靠 |x| 区分）
   *   肩以上 → 头颈，只随身高缩放
   */
  setProfile(profile: BodyProfile): void {
    this.profile = profile
    const heightM = profile.heightCm / 100

    /**
     * ⚠️ 关键设计：**雕刻网格本身就是基准形体，只施加「相对中性档案的偏移量」**。
     *
     * 一开始我按「绝对匹配」做 —— 把目标围度直接除以网格实测半径。
     * 结果是灾难性的：网格自身胸半径 18.2cm（围度 114cm），
     * 而默认女性档案只有 86cm，增益 0.455，把躯干压扁到 45%，
     * 满身硬边与鼓包。
     *
     * 正确做法：
     *   gain = 耦合模型(用户) / 耦合模型(中性档案)
     * 用户是平均身材时网格**原样不动**，雕刻的美术比例得以保留；
     * 偏胖偏瘦时才在基准上按比例偏移。
     *
     * 围度一律用比值，避免 cm/m/归一化三套单位互相污染
     * （之前正是这里漏了 /100 又漏乘 heightM，人偶被放大 100 倍）。
     */
    const neutral = defaultBodyProfile(profile.gender)
    const ratio = (v: number, n: number) => (n > 1e-6 ? v / n : 1)

    const hipG = ratio(profile.hipCm, neutral.hipCm)
    const waistG = ratio(profile.waistCm, neutral.waistCm)
    const chestG = ratio(profile.chestCm, neutral.chestCm)
    const legGain = ratio(profile.thighCircCm, neutral.thighCircCm)
    const armGain = ratio(profile.upperArmCircCm, neutral.upperArmCircCm)

    /** 躯干增益随高度在 胯/腰/胸 三点间线性插值 */
    const trunkGain = (y: number): number => {
      const pts: Array<[number, number]> = [
        [LEVELS.hip, hipG],
        [LEVELS.waist, waistG],
        [LEVELS.chest, chestG],
      ]
      if (y <= pts[0]![0]) return pts[0]![1]
      if (y >= pts[pts.length - 1]![0]) return pts[pts.length - 1]![1]
      for (let i = 0; i < pts.length - 1; i++) {
        const [ya, ga] = pts[i]!
        const [yb, gb] = pts[i + 1]!
        if (y >= ya && y <= yb) return ga + (gb - ga) * ((y - ya) / (yb - ya))
      }
      return 1
    }

    /** 平滑过渡：硬边界会让相邻顶点拿到不同增益，网格上直接撕裂成硬边 */
    const smoothstep = (e0: number, e1: number, v: number) => {
      const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
      return t * t * (3 - 2 * t)
    }

    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const base = this.base

    for (let i = 0; i < base.length; i += 3) {
      const x0 = base[i]!
      const y0 = base[i + 1]!
      const z0 = base[i + 2]!
      let x = x0
      let y = y0
      let z = z0

      // 手臂与躯干之间按 |x| 平滑混合，而不是硬切
      const armBlend = smoothstep(0.11, 0.17, Math.abs(x0))
      const legBlend = 1 - smoothstep(LEVELS.crotch - 0.035, LEVELS.crotch + 0.035, y0)

      if (armBlend < 1) {
        const g = trunkGain(y0)
        const tx = x0 * g
        const tz = z0 * g
        x = x + (tx - x) * (1 - armBlend)
        z = z + (tz - z) * (1 - armBlend)
      }
      if (armBlend > 0) {
        const ax = this.nearestAxis(x0 >= 0 ? this.armAxisR : this.armAxisL, y0)
        if (ax) {
          const ax1 = ax.cx + (x0 - ax.cx) * armGain
          const az1 = ax.cz + (z0 - ax.cz) * armGain
          x = x + (ax1 - x) * armBlend
          z = z + (az1 - z) * armBlend
        }
      }
      if (legBlend > 0) {
        const ax = this.nearestAxis(x0 >= 0 ? this.legAxisR : this.legAxisL, y0)
        if (ax) {
          const lx = ax.cx + (x0 - ax.cx) * legGain
          const lz = ax.cz + (z0 - ax.cz) * legGain
          x = x + (lx - x) * legBlend
          z = z + (lz - z) * legBlend
        }
      }
      // 肩以上（头颈）只随身高缩放

      arr[i] = x * heightM
      arr[i + 1] = y * heightM
      arr[i + 2] = z * heightM
    }

    pos.needsUpdate = true
    this.geo.computeVertexNormals()
    this.geo.computeBoundingSphere()
  }

  private nearestAxis(list: LimbAxis[], y: number): LimbAxis | null {
    if (!list.length) return null
    let best = list[0]!
    let bd = Infinity
    for (const a of list) {
      const d = Math.abs(a.y - y)
      if (d < bd) {
        bd = d
        best = a
      }
    }
    return best
  }

  get currentProfile(): BodyProfile {
    return this.profile
  }

  dispose(): void {
    this.geo.dispose()
    const m = this.mesh.material
    if (Array.isArray(m)) m.forEach((x) => x.dispose())
    else m.dispose()
  }
}

/**
 * 把 A 字站姿改成**双手自然下垂**。
 *
 * ⚠️ 不能整体硬转：肩膀处的顶点如果和上臂转一样多，腋下会被撕开。
 * 所以以肩关节为轴心，按「离肩关节的距离」做 smoothstep 加权 ——
 * 肩附近几乎不转，越往手转得越充分，过渡是连续的。
 *
 * 另外目标不是完全垂直，而是**离垂直线约 8°**：
 * 完全垂直会让上臂压进躯干，视觉上像粘住了。
 */
function poseArmsDown(base: Float32Array): Float32Array {
  const out = Float32Array.from(base)
  const n = out.length / 3

  // 肩关节高度（略低于肩顶）与躯干半宽
  const shoulderY = LEVELS.shoulder - 0.02

  for (const side of [1, -1] as const) {
    // 躯干在肩高处的半宽
    const trunkR: number[] = []
    for (let i = 0; i < n; i++) {
      const y = base[i * 3 + 1]!
      if (Math.abs(y - shoulderY) > 0.02) continue
      if (Math.abs(base[i * 3]!) > 0.13) continue
      trunkR.push(Math.abs(base[i * 3]!))
    }
    trunkR.sort((a, b) => a - b)
    const halfW = trunkR.length ? trunkR[trunkR.length >> 1]! : 0.1
    const joint = new THREE.Vector3(side * halfW * 0.8, shoulderY, 0)

    // 手部质心 → 当前上臂方向
    const hand = new THREE.Vector3()
    let hn = 0
    for (let i = 0; i < n; i++) {
      const x = base[i * 3]!
      const y = base[i * 3 + 1]!
      if (Math.sign(x) !== side) continue
      if (Math.abs(x) < 0.2 || y > 0.65) continue
      hand.x += x
      hand.y += y
      hand.z += base[i * 3 + 2]!
      hn++
    }
    if (!hn) continue
    hand.divideScalar(hn)

    const from = hand.clone().sub(joint).normalize()
    // 目标：离垂直线约 8°（向外），避免上臂压进躯干
    const target = new THREE.Vector3(side * Math.sin(THREE.MathUtils.degToRad(8)), -Math.cos(THREE.MathUtils.degToRad(8)), 0)
    const full = new THREE.Quaternion().setFromUnitVectors(from, target)

    const v = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const id = new THREE.Quaternion()
    for (let i = 0; i < n; i++) {
      const x = base[i * 3]!
      const y = base[i * 3 + 1]!
      // 只处理该侧、且明显属于手臂的顶点
      if (Math.sign(x) !== side || Math.abs(x) < 0.1) continue
      // ⚠️ 必须排除裆以下。只看 |x| 会把**腿**也当成手臂 ——
      // 腿离肩关节很远，套上旋转后被甩到几倍身宽之外，
      // 渲染出来是一大片放射状扇形。
      if (y < LEVELS.crotch - 0.02) continue
      v.set(x, y, base[i * 3 + 2]!)
      const d = v.distanceTo(joint)
      // 肩附近不转（否则腋下撕裂）；超过臂长后衰减到零（把腿和杂物排除干净）
      const t = THREE.MathUtils.smoothstep(d, 0.02, 0.12) * (1 - THREE.MathUtils.smoothstep(d, 0.36, 0.48))
      if (t <= 0) continue
      q.copy(id).slerp(full, t)
      v.sub(joint).applyQuaternion(q).add(joint)
      out[i * 3] = v.x
      out[i * 3 + 1] = v.y
      out[i * 3 + 2] = v.z
    }
  }
  return out
}
