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
import { createBodyState, deriveProfile, type BodyProfile } from '@cda/core'

/**
 * 体表查询接口。
 *
 * 服装壳的拟合靠「从身体内部一点沿方向投射射线，求到体表的距离」。
 * 把这件能力抽成接口，SDF 人体与雕刻网格各实现一份，
 * 服装代码就不必知道身后是哪一种身体。
 */
export interface BodySurface {
  /**
   * 从内部一点 (ox,oy,oz) 沿单位方向 (dx,dy,dz) 找体表距离（米）。
   * 起点必须在体内；未命中返回 null。
   */
  radiusAt(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
  ): number | null
}

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

/**
 * 组织沉积方向表。
 *
 * **核心原则：增加一个围度 = 往身上加肉。而肉在人身上不是均匀地鼓一圈，
 * 而是按解剖规律堆在特定方位。**
 *
 *   front / back / side 是在截面局部坐标系里的权重 ——
 *   某个方向权重越大，该处增加同样的围度时鼓得越多。
 *   dir 表示 +z 为身前、+x 为身体右侧。
 *
 * 例：腰围增大主要是腹部脂肪（前向）+ 腰侧赘肉（侧向），背部最少；
 *     臀围增大是臀部（后向）；小腿围增大是腓肠肌（后向）。
 *     这些差异正是「同样加 5cm，看起来却是不同的人」的原因。
 */
interface Deposition {
  front: number
  back: number
  side: number
  /** 不随方向变化的基础量，避免形状被扭曲 */
  base: number
}

const DEPOSIT: Record<string, Deposition> = {
  // 腹部脂肪在前、腰侧赘肉在两侧，背部最少
  waist: { front: 1.7, back: 0.35, side: 1.1, base: 0.2 },
  // 臀部：后向为主
  hip: { front: 0.45, back: 1.9, side: 1.0, base: 0.2 },
  // 女性胸围：乳房组织，几乎全在前向
  chestF: { front: 2.2, back: 0.1, side: 0.6, base: 0.1 },
  // 男性胸围：胸肌 + 胸廓，前后较均匀
  chestM: { front: 1.1, back: 0.7, side: 1.0, base: 0.3 },
  // 大腿：前后较均匀，略偏内侧
  thigh: { front: 1.0, back: 1.0, side: 1.15, base: 0.4 },
  // 小腿：腓肠肌在后
  calf: { front: 0.45, back: 1.7, side: 0.95, base: 0.25 },
  // 大臂：肱二头肌在前、肱三头肌在后，侧向少
  arm: { front: 1.2, back: 1.2, side: 0.7, base: 0.35 },
  // 前臂：较均匀
  forearm: { front: 1.0, back: 1.0, side: 1.0, base: 0.5 },
}

/**
 * 给定截面内的单位方向 (nx, nz)（nz>0 为身前），算出沉积权重。
 * 结果用于**在径向位移上做方向调制**，使肉加在正确方位。
 */
function depositWeight(d: Deposition, nx: number, nz: number): number {
  const f = Math.max(0, nz)
  const b = Math.max(0, -nz)
  const sd = Math.abs(nx)
  return d.base + d.front * f * f + d.back * b * b + d.side * sd * sd
}

/** 该沉积表在整圈上的平均值（用于归一化，保证周长与测量一致） */
function depositMean(d: Deposition): number {
  // 对 θ 均匀采样求平均；椭圆截面下已足够精确
  let sum = 0
  const N = 48
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2
    sum += depositWeight(d, Math.sin(th), Math.cos(th))
  }
  return sum / N
}

/** 一个体段：轴 + 参考半径剖面（按 t 等分采样） */
interface MeshSegment {
  name: string
  /** **目标**轴（每次 setProfile 按骨骼参数重算）。全程归一化单位 */
  a: THREE.Vector3
  b: THREE.Vector3
  len: number
  dir: THREE.Vector3
  /** **参考**轴（网格自身的，永不改变）。顶点的参数化一律基于它 */
  refA: THREE.Vector3
  refDir: THREE.Vector3
  refLen: number
  /** 该段由哪些骨骼参数驱动长度；比值缩放，中性时 = 1 */
  bone: 'torso' | 'head' | 'arm' | 'leg'
  /** 左右侧（0 = 居中），肩宽用它决定轴起点的 x */
  side: 0 | 1 | -1
  /** 沿段的参考半径采样，长度固定 */
  refR: number[]
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

export class MeshBody implements BodySurface {
  readonly object3D: THREE.Object3D
  private readonly mesh: THREE.Mesh
  private readonly geo: THREE.BufferGeometry
  /** 归一化后的原始顶点（身高 1.0），每次重拟合都从这里出发，避免累积误差 */
  private readonly base: Float32Array
  /** 体段（轴 + 参考半径剖面）。改体型全靠它做柱面重参数化 */
  private readonly segments: MeshSegment[] = []
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
    // 姿势（A 字站姿 → 双手自然下垂）在**离线**由 scripts/bake-pose.py 烘焙进 OBJ。
    // 不在运行时做：这是一个一次性的资产变换，放运行时既增加开销，
    // 又因为看不到中间数据而极难调试（先前在这里反复出错）。
    this.base = base

    this.buildSegments(this.base)

    // 白模材质
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xece8e3,
      roughness: 0.34,
      clearcoat: 0.4,
      clearcoatRoughness: 0.4,
      metalness: 0,
      // ⚠️ 必须双面。Raycaster 默认只命中正面三角形，
      // 而服装求交是**从身体内部向外**投射的，打到的是体表三角形的**背面**——
      // 单面时会全部落空（实测三个高度里两个返回 null）。
      side: THREE.DoubleSide,
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

    // ────────────────────────────────────────────────────────
  // 按段柱面重参数化
  // ────────────────────────────────────────────────────────

  /**
   * 从网格自身量出各体段的轴心与半径剖面。
   *
   * 关键认识：**网格自身的锥度（手细臂粗）本来就是对的**，
   * 不该由我重新规定。所以这里只量它，改体型时按段整体缩放，
   * 锥度原样保留 —— 「手部分粗部分细」正是上一版重新规定锥度造成的。
   */
  private buildSegments(base: Float32Array): void {
    const n = base.length / 3
    const P = (i: number) => new THREE.Vector3(base[i * 3]!, base[i * 3 + 1]!, base[i * 3 + 2]!)

    // 先粗测肩/腕/胯/踝的位置，用来定义各段轴
    const at = (y: number, pred: (v: THREE.Vector3) => boolean) => {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i < n; i++) {
        const v = P(i)
        if (Math.abs(v.y - y) > 0.02 || !pred(v)) continue
        pts.push(v)
      }
      if (!pts.length) return null
      const c = new THREE.Vector3()
      pts.forEach((q) => c.add(q))
      return c.divideScalar(pts.length)
    }

    const shoulderY = LEVELS.shoulder - 0.02
    const crotchY = LEVELS.crotch
    const neckY = LEVELS.shoulder + 0.03
    const headTopY = 1.0

    const defs: Array<{
      name: string
      a: THREE.Vector3
      b: THREE.Vector3
      bone: MeshSegment['bone']
      side: 0 | 1 | -1
    }> = []
    // 躯干：裆 → 颈根（竖直）
    defs.push({ name: 'torso', a: new THREE.Vector3(0, crotchY, 0), b: new THREE.Vector3(0, neckY, 0), bone: 'torso', side: 0 })
    // 头颈：由颈长驱动
    defs.push({ name: 'head', a: new THREE.Vector3(0, neckY, 0), b: new THREE.Vector3(0, headTopY, 0), bone: 'head', side: 0 })
    for (const side of [1, -1] as const) {
      const sh = at(shoulderY, (v) => Math.sign(v.x) === side && Math.abs(v.x) > 0.09)
      const wr = at(0.57, (v) => Math.sign(v.x) === side && Math.abs(v.x) > 0.2)
      const hip = at(crotchY - 0.03, (v) => Math.sign(v.x) === side)
      const an = at(LEVELS.ankle + 0.01, (v) => Math.sign(v.x) === side)
      const sgn = side > 0 ? 'R' : 'L'
      if (sh && wr) defs.push({ name: `arm${sgn}`, a: sh, b: wr, bone: 'arm', side })
      if (hip && an) defs.push({ name: `leg${sgn}`, a: hip, b: an, bone: 'leg', side })
    }

    // 分段量半径剖面（先按**原始距离**粗分，够用：各段轴本来就穿过各自的肢体）
    const N = 14
    for (const d of defs) {
      const axis = new THREE.Vector3().subVectors(d.b, d.a)
      const len = axis.length()
      const dir = axis.clone().divideScalar(Math.max(len, 1e-6))
      const buckets: number[][] = Array.from({ length: N }, () => [])
      for (let i = 0; i < n; i++) {
        const v = P(i)
        const rel = new THREE.Vector3().subVectors(v, d.a)
        const t = rel.dot(dir) / Math.max(len, 1e-6)
        if (t < -0.02 || t > 1.02) continue
        const perp = rel.clone().addScaledVector(dir, -rel.dot(dir)).length()
        const bi = Math.min(N - 1, Math.max(0, Math.round(t * (N - 1))))
        buckets[bi]!.push(perp)
      }
      const refR = buckets.map((b) => {
        if (!b.length) return 0
        b.sort((x, y) => x - y)
        // 取 88 分位：接近外表面，但不被个别飞点拉偏
        return b[Math.min(b.length - 1, Math.floor(b.length * 0.88))]!
      })
      this.segments.push({
        name: d.name,
        a: d.a.clone(),
        b: d.b.clone(),
        len,
        dir,
        refA: d.a.clone(),
        refDir: dir.clone(),
        refLen: len,
        bone: d.bone,
        side: d.side,
        refR,
      })
    }
  }

  /**
   * 顶点到某段的「归一化距离」= 垂距 ÷ 该处参考半径。
   *
   * ⚠️ 用归一化距离而不是原始距离来判断归属 —— 这是胸部塌陷的根治办法：
   *   女性胸部顶点：到手臂轴 0.095（原始距离更近）、到躯干轴 0.15
   *   但归一化后：0.095/0.05 = 1.9（远在手臂表面之外）
   *               0.15/0.18 = 0.83（在躯干表面之内）
   *   → 归躯干，正确。原始距离比较会把它判成手臂。
   */
  private segScore(seg: MeshSegment, v: THREE.Vector3): { score: number; t: number; tRaw: number; perp: THREE.Vector3 } {
    // 参数化一律基于**参考轴** —— 目标轴会随骨骼参数移动，
    // 用它算 t 会让同一顶点在不同骨骼设置下对应到不同位置，产生漂移。
    const rel = new THREE.Vector3().subVectors(v, seg.refA)
    const proj = rel.dot(seg.refDir)
    const tRaw = proj / Math.max(seg.refLen, 1e-6)
    const t = Math.min(1, Math.max(0, tRaw))
    const perp = rel.clone().addScaledVector(seg.refDir, -proj)
    const idx = Math.round(t * (seg.refR.length - 1))
    const r = seg.refR[idx] || 1e-4
    return { score: perp.length() / Math.max(r, 1e-4), t, tRaw, perp }
  }

  setProfile(profile: BodyProfile): void {
    this.profile = profile
    const heightM = profile.heightCm / 100
    // 中性档案必须等于**应用自己的默认状态**。
    // 原先用 defaultBodyProfile（胸86/腰67），而应用默认是 adiposity 0.35
    // （胸88/腰71）—— 默认状态下网格就已经被改了 2–6%，雕刻原貌一开始就丢了。
    const neutral = deriveProfile(createBodyState(profile.gender))
    const ratio = (v: number, nn: number) => (nn > 1e-6 ? v / nn : 1)

    // 各段的整体增益。四肢用**常数**增益 —— 网格自身的锥度保留，
    // 只整体缩放，于是不会出现「一段粗一段细」。
    // 躯干按高度变（胯/腰/胸三点），并在肩以上**回到 1.0** ——
    // 肩宽属骨骼，不该随胸围变（上一版肩部鼓包就是这个原因）。
    // 躯干增益随高度变化。单独抽出来，是为了让四肢在交界处**与躯干取值一致** ——
    // 这是消除「体段交界处横向条带」的关键：各段增益若在边界上不等，
    // 交界顶点就会跳变，视觉上是一圈台阶（用户看到的凹陷）。
    const torsoGainAtY = (y: number): number =>
      smoothSeg(y, [
        [hipY, ratio(profile.hipCm, neutral.hipCm)],
        [waistY, ratio(profile.waistCm, neutral.waistCm)],
        [chestY, ratio(profile.chestCm, neutral.chestCm)],
        // 肩以上回到 1.0：肩宽属骨骼，不该随胸围变
        [LEVELS.shoulder + 0.03, 1],
      ])

    // 四肢在交界处取躯干的增益，再平滑过渡到自身的常数增益
    /*
     * 控制高度**从网格自身实测**，不能用写死的男性网格值。
     *
     * 原先用 胯0.53/腰0.60/胸0.72（那是一次男性网格实测的结果），
     * 却同时用于女性网格 —— 两者的腰臀高度并不相同，
     * 增益落到了错误的高度上。
     *
     * 做法：在躯干段的参考半径剖面上找极值 ——
     * 腰 = 中段的最小半径处，胸/胯 = 其上下两侧的最大半径处。
     */
    const tor = this.segments.find((q) => q.name === 'torso')
    const tRange = LEVELS.shoulder + 0.03 - LEVELS.crotch
    let hipY = LEVELS.hip
    let waistY = LEVELS.waist
    let chestY = LEVELS.chest
    if (tor && tor.refR.length >= 6) {
      const rr = tor.refR
      const n2 = rr.length
      const yOf = (i: number) => LEVELS.crotch + (i / (n2 - 1)) * tRange
      // 腰：中段（30%..75%）最小半径
      let wi = Math.round(n2 * 0.3)
      for (let i = Math.round(n2 * 0.3); i <= Math.round(n2 * 0.75); i++) {
        if (rr[i]! < rr[wi]!) wi = i
      }
      waistY = yOf(wi)
      // 胯：腰以下最大；胸：腰以上最大
      let hi = 0
      for (let i = 0; i <= wi; i++) if (rr[i]! > rr[hi]!) hi = i
      let ci = wi
      for (let i = wi; i < n2; i++) if (rr[i]! > rr[ci]!) ci = i
      hipY = yOf(hi)
      chestY = yOf(ci)
      // 防止退化（例如极瘦体型上极值挤在一起）
      if (!(hipY < waistY - 0.01 && waistY < chestY - 0.01)) {
        hipY = LEVELS.hip
        waistY = LEVELS.waist
        chestY = LEVELS.chest
      }
    }

    // 相邻控制点之间用 smoothstep 而不是线性 ——
    // 线性插值在每个控制点上**导数突变**，半径剖面上会出现折角，
    // 视觉上就是「胸腰之间那道断层」。smoothstep 在结点处导数为 0，
    // 整条曲线 C1 连续，不再有折角。
    const smoothSeg = (y: number, pts: Array<[number, number]>): number => {
      if (y <= pts[0]![0]) return pts[0]![1]
      const last = pts[pts.length - 1]!
      if (y >= last[0]) return last[1]
      for (let i = 0; i < pts.length - 1; i++) {
        const [ya, ga] = pts[i]!
        const [yb, gb] = pts[i + 1]!
        if (y >= ya && y <= yb) {
          const t2 = (y - ya) / Math.max(yb - ya, 1e-6)
          const sm = t2 * t2 * (3 - 2 * t2)
          return ga + (gb - ga) * sm
        }
      }
      return last[1]
    }

        const gThigh = ratio(profile.thighCircCm, neutral.thighCircCm)
    const gArm = ratio(profile.upperArmCircCm, neutral.upperArmCircCm)
    const gForearm = ratio(profile.forearmCircCm, neutral.forearmCircCm)
    const gCalf = ratio(profile.calfCircCm, neutral.calfCircCm)
    const gAtShoulder = torsoGainAtY(LEVELS.shoulder - 0.02)
    const gAtHip = torsoGainAtY(LEVELS.crotch)

    const gainOf = (name: string, t: number): number => {
      if (name === 'head') return 1
      /*
       * 四肢增益**沿长度变化**，不再全段一个常数。
       *
       * 这是联动逻辑的关键一环：一条肢体的粗细本来就不均匀 ——
       * 大腿最粗、膝以下由小腿围决定；大臂最粗、肘以下由小臂围决定。
       * 用单个常数会把小腿按大腿缩放、小臂按大臂缩放，比例必然错。
       *
       * 控制点位置按解剖比例：膝约在 t=0.5（大腿长≈小腿长）、
       * 小腿最粗处 t≈0.72；肘约在 t=0.5、前臂最粗处 t≈0.72。
       */
      if (name.startsWith('leg')) {
        return smoothSeg(t, [
          [0, gAtHip],
          [0.3, gThigh],
          [0.55, gThigh],
          [0.72, gCalf],
          [1, gCalf],
        ])
      }
      if (name.startsWith('arm')) {
        return smoothSeg(t, [
          [0, gAtShoulder],
          [0.28, gArm],
          [0.5, gArm],
          [0.72, gForearm],
          [1, gForearm],
        ])
      }
      return torsoGainAtY(LEVELS.crotch + t * (LEVELS.shoulder + 0.03 - LEVELS.crotch))
    }

    // 沉积表的插值：与增益用同一套控制点，两者必须同步过渡
    const lerpDep = (a: Deposition, b: Deposition, k: number): Deposition => ({
      front: a.front + (b.front - a.front) * k,
      back: a.back + (b.back - a.back) * k,
      side: a.side + (b.side - a.side) * k,
      base: a.base + (b.base - a.base) * k,
    })
    const smoothK = (v: number, a: number, b: number) => {
      const t2 = Math.min(1, Math.max(0, (v - a) / Math.max(b - a, 1e-6)))
      return t2 * t2 * (3 - 2 * t2)
    }
    /** 躯干在某高度的沉积表：胯→腰→胸 三点平滑过渡 */
    const torsoDepositAt = (y: number): Deposition => {
      const dHip = DEPOSIT.hip!
      const dWaist = DEPOSIT.waist!
      const dChest = profile.gender === 'male' ? DEPOSIT.chestM! : DEPOSIT.chestF!
      if (y <= hipY) return dHip
      if (y <= waistY) return lerpDep(dHip, dWaist, smoothK(y, hipY, waistY))
      if (y <= chestY) return lerpDep(dWaist, dChest, smoothK(y, waistY, chestY))
      return dChest
    }
    /** 按段名与段内位置取沉积表 */
    const depositOf = (name: string, t: number, y: number): Deposition | null => {
      if (name === 'head') return null
      if (name.startsWith('leg')) {
        const kLeg = smoothK(t, 0.45, 0.72)
        return lerpDep(DEPOSIT.thigh!, DEPOSIT.calf!, kLeg)
      }
      if (name.startsWith('arm')) {
        const kArm = smoothK(t, 0.42, 0.72)
        return lerpDep(DEPOSIT.arm!, DEPOSIT.forearm!, kArm)
      }
      return torsoDepositAt(y)
    }

    /*
     * ── 按骨骼参数重算各段的目标轴 ──
     *
     * 至此骨骼参数（肩宽 / 各段长度 / 颈长）才真正参与进来 ——
     * 此前它们是完全没被使用的死参数，拖动毫无反应。
     *
     * 一律用**比值**缩放（中性档案时比值 = 1，网格原样不动），
     * 并全程保持归一化单位，身高缩放留到最后统一乘。
     */
    const neckDelta = (profile.neckLengthCm - neutral.neckLengthCm) / 100 / heightM
    const boneScale = (seg: MeshSegment): number => {
      switch (seg.bone) {
        case 'arm':
          return (profile.upperArmCm + profile.forearmCm) / (neutral.upperArmCm + neutral.forearmCm)
        case 'leg':
          return (profile.thighCm + profile.calfCm) / (neutral.thighCm + neutral.calfCm)
        case 'torso':
          return profile.torsoLengthCm / neutral.torsoLengthCm
        case 'head':
          return 1
      }
    }
    for (const seg of this.segments) {
      const a = seg.refA.clone()
      let len = seg.refLen * boneScale(seg)
      if (seg.bone === 'arm' && seg.side !== 0) {
        // 肩宽驱动手臂轴的起点（与 buildSkeleton 的 0.86 系数保持一致）
        a.x = (seg.side * (profile.shoulderWidthCm / 200) * 0.86) / heightM
      }
      if (seg.bone === 'head') {
        // 颈长是「把头顶往上推」，不是把头放大 —— 所以只平移、不缩放
        a.y = seg.refA.y + neckDelta
      }
      if (seg.bone === 'torso') {
        // 躯干要额外接上颈部的位移，否则头与躯干之间会裂开
        len += neckDelta
      }
      seg.a = a
      seg.len = Math.max(len, 1e-4)
      seg.dir = seg.refDir.clone()
      seg.b = a.clone().addScaledVector(seg.dir, seg.len)
    }

    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const base = this.base
    const v = new THREE.Vector3()
    const wSum: number[] = []
    const scored: Array<{ seg: MeshSegment; s: ReturnType<MeshBody['segScore']> }> = []

    for (let i = 0; i < base.length; i += 3) {
      v.set(base[i]!, base[i + 1]!, base[i + 2]!)
      scored.length = 0
      wSum.length = 0
      let total = 0
      for (const seg of this.segments) {
        const sc = this.segScore(seg, v)
        // 权重 = 1/score^p。p 取 5：最近的那段压倒性主导，
        // 同时过渡仍是连续的，不会像硬切那样撕裂。
        const w = 1 / (Math.pow(sc.score, 5) + 1e-3)
        scored.push({ seg, s: sc })
        wSum.push(w)
        total += w
      }
      if (total <= 0) {
        arr[i] = v.x * heightM
        arr[i + 1] = v.y * heightM
        arr[i + 2] = v.z * heightM
        continue
      }
      /*
       * ⚠️ 只混合**位移量**，绝不能混合「轴心 + 缩放后垂距」的绝对位置。
       *
       * 各段的轴心相距很远（一个躯干顶点也会被腿段的轴心算出一个分数），
       * 把绝对位置加权平均，结果会被远端的轴心拽走 ——
       * 人偶直接揉成一团。位移量在增益接近 1 时本来就很小，
       * 混合它才是安全的。
       */
      /*
       * 混合的是**标量增益**，再沿主导段的垂距方向位移。
       *
       * ⚠️ 不能混合「位移向量」。各段的 perp 方向互不相同（各自垂直于不同的轴），
       * 向量相加会互相抵消变短，表面被拉向内侧 —— 这就是模型上那些**凹陷**
       * 的来源，也是线性混合蒙皮的老问题。混合标量保证位移严格沿径向。
       */
      let bestK = 0
      let bestW = -1
      for (let k = 0; k < wSum.length; k++) {
        if (wSum[k]! > bestW) { bestW = wSum[k]!; bestK = k }
      }
      let gBlend = 0
      for (let k = 0; k < scored.length; k++) {
        gBlend += gainOf(scored[k]!.seg.name, scored[k]!.s.t) * (wSum[k]! / total)
      }
      const dom = scored[bestK]!
      /*
       * 方向调制：把径向位移乘上沉积权重，再按整圈均值归一化。
       *
       * 归一化是必须的 —— 否则各方向鼓得不一样，实际周长就不再等于
       * 用户设定的围度。除以均值后，「肉加在该加的地方」与
       * 「总周长符合测量」两件事同时成立。
       */
      const domY = LEVELS.crotch + dom.s.t * (LEVELS.shoulder + 0.03 - LEVELS.crotch)
      const dep = depositOf(dom.seg.name, dom.s.t, domY)
      let mod = 1
      if (dep) {
        const plen = dom.s.perp.length()
        if (plen > 1e-9) {
          // 截面局部坐标系：dir 为轴，fwd 为身前方向，side 为身体右侧
          const axis = dom.seg.dir
          const zRef = new THREE.Vector3(0, 0, 1)
          const fwd = zRef.clone().addScaledVector(axis, -zRef.dot(axis))
          if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0)
          fwd.normalize()
          const sideV = new THREE.Vector3().crossVectors(axis, fwd).normalize()
          const nz = dom.s.perp.dot(fwd) / plen
          const nx = dom.s.perp.dot(sideV) / plen
          const mean = depositMean(dep)
          mod = mean > 1e-6 ? depositWeight(dep, nx, nz) / mean : 1
        }
      }
      // 从**目标轴**重建位置：轴心按段内参数 t 沿目标轴走，
      // 垂距按增益与沉积方向缩放。
      // 这样骨骼参数一变（例如小臂拉长），手腕与手会跟着外移。
      const axisPoint = dom.seg.a.clone().addScaledVector(dom.seg.dir, dom.s.tRaw * dom.seg.len)
      const p = dom.s.perp.clone().multiplyScalar(1 + (gBlend - 1) * mod)
      axisPoint.add(p)
      arr[i] = axisPoint.x * heightM
      arr[i + 1] = axisPoint.y * heightM
      arr[i + 2] = axisPoint.z * heightM
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

  /**
   * 体表查询：对网格做 raycast。
   *
   * 这是 SDF 射线步进的替代品 —— 身体换成雕刻网格后，
   * 服装壳必须按**网格的实际表面**求交，否则衣服会照着另一具身体计算。
   *
   * 注意：Raycaster 用的是世界坐标，所以必须先 updateMatrixWorld。
   */
  radiusAt(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
  ): number | null {
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-9) return null
    this.rayOrigin.set(ox, oy, oz)
    this.rayDir.set(dx / len, dy / len, dz / len)
    this.raycaster.set(this.rayOrigin, this.rayDir)
    this.raycaster.near = 0
    this.raycaster.far = maxDist
    // 变形后包围盒会变，必须先刷新世界矩阵与包围体
    this.mesh.updateMatrixWorld(true)
    this.geo.computeBoundingSphere()
    const hits = this.raycaster.intersectObject(this.mesh, false)
    return hits.length ? hits[0]!.distance : null
  }

  private readonly raycaster = new THREE.Raycaster()
  private readonly rayOrigin = new THREE.Vector3()
  private readonly rayDir = new THREE.Vector3()

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
