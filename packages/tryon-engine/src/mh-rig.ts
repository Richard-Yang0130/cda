/**
 * MakeHuman 骨架网格（CC0）。
 *
 * ── 为什么换成这套 ──
 * 原来的人偶是一具**无骨架的静态 OBJ**，改体型靠我自己写的启发式：
 *   柱面重参数化 → 按「离轴距离/该处半径」评分 → 1/score⁵ 加权 → LBS。
 * 这套东西有个致命缺陷，实测数据如下（头部各高度被谁控制）：
 *     头顶  手臂 54.6%  头部段 1.7%
 *     头上部 手臂 90.4%  头部段 0.0%
 *     头中部 手臂 96.5%  头部段 0.0%
 * 原因是手臂轴的反向延长线正好穿过头部，而手臂根部的半径又被邻近躯干
 * 顶点污染成 492mm，于是「离轴距离 / 492mm」得到极小的 score，
 * **手臂反而成了头部最匹配的段**。躯干一变长，头就被手臂拉成锥形，
 * 就是用户看到的头顶尖刺。三次针对性修复（段外惩罚、两遍测量半径、
 * 硬门控）**实测全部更差**，说明这条启发式路线已经走不通。
 *
 * ── 换成什么 ──
 * MakeHuman 官方提供的完整骨架角色，**全部 CC0**（可商用）：
 *   base.obj              19158 顶点、172 命名分组    基础网格
 *   default.mhskel        163 根骨骼                  骨架定义
 *   default_weights.mhw   139 根骨头的蒙皮权重        官方权重
 *
 * 官方权重实测：覆盖全部 19158 顶点，平均每顶点 2.98 根骨头影响，
 * **头顶与头上部受手臂影响为 0** —— 问题从根上消失。
 *
 * ── 一个关键设计 ──
 * mhskel 里的关节（joints）是**顶点索引列表**，不是坐标：
 *   "spine02____head": [13654, 13655, ...]
 * 骨骼位置取这些顶点的质心。这意味着**骨架是从网格推出来的** ——
 * 网格被形变目标改变后，骨架会自动跟着走，不需要单独维护两套数据。
 * 这正是 MakeHuman 自己的做法。
 */
import * as THREE from 'three'

/** 骨骼定义（mhskel.bones 的一项） */
export interface MhBoneDef {
  /** 指向 joints 里的一组顶点；其质心即骨头起点 */
  head: string
  /** 同上，骨头终点 */
  tail: string
  /** 父骨骼名；null 表示根 */
  parent: string | null
}

export interface MhSkeleton {
  bones: Record<string, MhBoneDef>
  /** 关节名 → 顶点索引列表。位置 = 这些顶点的质心 */
  joints: Record<string, number[]>
  license: string
}

export interface MhWeights {
  /** 骨头名 → [[顶点索引, 权重], ...] */
  weights: Record<string, [number, number][]>
  license: string
}

export function parseMhSkeleton(text: string): MhSkeleton {
  const d = JSON.parse(text) as {
    bones?: Record<string, { head?: string; tail?: string; parent?: string | null }>
    joints?: Record<string, number[]>
    license?: string
  }
  const bones: Record<string, MhBoneDef> = {}
  for (const [name, b] of Object.entries(d.bones ?? {})) {
    if (!b?.head || !b?.tail) continue
    bones[name] = { head: b.head, tail: b.tail, parent: b.parent ?? null }
  }
  return { bones, joints: d.joints ?? {}, license: d.license ?? 'unknown' }
}

export function parseMhWeights(text: string): MhWeights {
  const d = JSON.parse(text) as { weights?: Record<string, [number, number][]>; license?: string }
  return { weights: d.weights ?? {}, license: d.license ?? 'unknown' }
}

/**
 * 关节位置 = 该关节所引用顶点的质心。
 *
 * 用质心而不是某个单点，是因为 MakeHuman 用一小圈顶点来界定关节，
 * 取质心能得到位于肢体内部的稳定位置（单点会偏到表面上去）。
 */
export function jointPosition(jointName: string, skel: MhSkeleton, pos: Float32Array): THREE.Vector3 | null {
  const idx = skel.joints[jointName]
  if (!idx || !idx.length) return null
  const out = new THREE.Vector3()
  let n = 0
  for (const i of idx) {
    if (i * 3 + 2 >= pos.length) continue
    out.x += pos[i * 3]!
    out.y += pos[i * 3 + 1]!
    out.z += pos[i * 3 + 2]!
    n++
  }
  if (!n) return null
  return out.divideScalar(n)
}

/** 从 OBJ 文本读出顶点（只取 v）。骨架与权重都按这个顺序索引 */
export function parseObjPositions(text: string): Float32Array {
  const out: number[] = []
  for (const line of text.split('\n')) {
    if (line.charCodeAt(0) !== 118 /* v */) continue
    if (line.charCodeAt(1) !== 32 && line.charCodeAt(1) !== 9) continue
    const p = line.split(/\s+/)
    out.push(Number(p[1]), Number(p[2]), Number(p[3]))
  }
  return new Float32Array(out)
}

/**
 * 按骨骼层级建立 Three.js 的骨骼树。
 *
 * ⚠️ 必须**两遍**算，且顺序不能反：
 *   第一遍算出每根骨头的世界位置与朝向；
 *   第二遍按拓扑序把世界量转成**父骨骼局部坐标系**下的量。
 *
 * 我第一版写成「先设 position 为 (自身世界坐标 − 父世界坐标)，再设 quaternion」，
 * 结果是错的：骨骼方向一旦旋转，**父骨骼的旋转会把子骨骼的局部偏移一起转掉**。
 * 实测症状是 head 的 y=1.275 反而低于 neck01 的 y=1.494，
 * foot.L 的 x 飘到 −2.388。这种错误不会报错，只会让整具骨架错位。
 */
export function buildBoneTree(
  skel: MhSkeleton,
  pos: Float32Array,
): { bones: THREE.Bone[]; byName: Map<string, THREE.Bone>; roots: THREE.Bone[] } {
  const UP = new THREE.Vector3(0, 1, 0)
  const byName = new Map<string, THREE.Bone>()
  const worldHead = new Map<string, THREE.Vector3>()
  const worldQuat = new Map<string, THREE.Quaternion>()

  // 第一遍：世界位置与朝向
  for (const [name, def] of Object.entries(skel.bones)) {
    const h = jointPosition(def.head, skel, pos)
    const t = jointPosition(def.tail, skel, pos)
    if (!h || !t) continue
    worldHead.set(name, h)
    const dir = new THREE.Vector3().subVectors(t, h)
    const q = new THREE.Quaternion()
    if (dir.lengthSq() > 1e-12) q.setFromUnitVectors(UP, dir.clone().normalize())
    worldQuat.set(name, q)
    const b = new THREE.Bone()
    b.name = name
    byName.set(name, b)
  }

  // 拓扑排序：父必须先于子处理，否则拿不到父的世界量
  const order: string[] = []
  const visit = (n: string, seen: Set<string>) => {
    if (seen.has(n) || !byName.has(n)) return
    seen.add(n)
    const p = skel.bones[n]!.parent
    if (p) visit(p, seen)
    order.push(n)
  }
  const seen = new Set<string>()
  for (const n of byName.keys()) visit(n, seen)

  // 第二遍：转成局部量
  const roots: THREE.Bone[] = []
  for (const name of order) {
    const b = byName.get(name)!
    const def = skel.bones[name]!
    const ownHead = worldHead.get(name)!
    const ownQ = worldQuat.get(name)!
    const parent = def.parent ? byName.get(def.parent) : undefined

    if (parent && def.parent) {
      const pHead = worldHead.get(def.parent)!
      const pQ = worldQuat.get(def.parent)!
      const invPQ = pQ.clone().invert()
      // 局部位置 = 父旋转的逆 ×（自身世界头 − 父世界头）
      b.position.copy(ownHead.clone().sub(pHead).applyQuaternion(invPQ))
      // 局部朝向 = 父旋转的逆 × 自身世界朝向
      b.quaternion.copy(invPQ.clone().multiply(ownQ))
      parent.add(b)
    } else {
      b.position.copy(ownHead)
      b.quaternion.copy(ownQ)
      roots.push(b)
    }
  }

  return { bones: [...byName.values()], byName, roots }
}

/**
 * 把官方权重整理成 Three.js 的 skinIndex / skinWeight 属性。
 *
 * ⚠️ 必须归一化：官方权重的和并不精确等于 1
 * （实测 min 0.32 / max 1.67，2687 个顶点偏离超过 5%）。
 * 不归一化的话 LBS 会整体缩放顶点，人偶会忽大忽小。
 */
export function buildSkinAttributes(
  weights: MhWeights,
  boneOrder: string[],
  vertexCount: number,
  maxInfluences = 4,
): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const boneIndex = new Map<string, number>()
  boneOrder.forEach((n, i) => boneIndex.set(n, i))

  // 每顶点收集 (boneSlot, weight)
  const perVertex: Array<Array<[number, number]>> = Array.from({ length: vertexCount }, () => [])
  for (const [bone, pairs] of Object.entries(weights.weights)) {
    const slot = boneIndex.get(bone)
    if (slot === undefined) continue // 该骨不在骨骼树里（例如纯面部骨），跳过
    for (const [vi, w] of pairs) {
      if (vi >= 0 && vi < vertexCount && w > 0) perVertex[vi]!.push([slot, w])
    }
  }

  const skinIndex = new Uint16Array(vertexCount * maxInfluences)
  const skinWeight = new Float32Array(vertexCount * maxInfluences)

  for (let i = 0; i < vertexCount; i++) {
    const list = perVertex[i]!
    if (!list.length) {
      // 完全没有权重的顶点会「钉死」在原地。给根骨骼 1.0 是 Three.js 惯例
      skinIndex[i * maxInfluences] = 0
      skinWeight[i * maxInfluences] = 1
      continue
    }
    // Three.js 只支持固定数量的影响；取权重最大的几个
    list.sort((a, b) => b[1] - a[1])
    const keep = list.slice(0, maxInfluences)
    let total = 0
    for (const [, w] of keep) total += w
    if (total <= 1e-9) total = 1
    for (let k = 0; k < keep.length; k++) {
      skinIndex[i * maxInfluences + k] = keep[k]![0]
      skinWeight[i * maxInfluences + k] = keep[k]![1] / total
    }
  }

  return { skinIndex, skinWeight }
}

/** OBJ 的面（三角化），索引与 v 一一对应 */
export function parseObjFaces(text: string): number[] {
  const tris: number[] = []
  for (const line of text.split('\n')) {
    if (line.charCodeAt(0) !== 102 /* f */) continue
    const parts = line.split(/\s+/)
    const idx: number[] = []
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i]
      if (!t) continue
      const s = t.indexOf('/')
      idx.push(parseInt(s < 0 ? t : t.slice(0, s), 10) - 1)
    }
    for (let i = 1; i < idx.length - 1; i++) tris.push(idx[0]!, idx[i]!, idx[i + 1]!)
  }
  return tris
}

// ────────────────────────────────────────────────────────────
// 形变目标（morph targets）
// ────────────────────────────────────────────────────────────

/**
 * 一个形变目标 = 一组顶点偏移（稀疏）。
 *
 * 文件格式极简，每行 `顶点索引 dx dy dz`，`#` 开头是注释。
 * 例如 measure-bust-circ-incr.target 只改 1972 个顶点。
 */
export type MhTarget = Map<number, [number, number, number]>

export function parseMhTarget(text: string): MhTarget {
  const out: MhTarget = new Map()
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) === 35 /* # */) continue
    const p = line.split(/\s+/)
    if (p.length < 4) continue
    const i = parseInt(p[0]!, 10)
    if (!Number.isFinite(i)) continue
    out.set(i, [Number(p[1]), Number(p[2]), Number(p[3])])
  }
  return out
}

export interface WeightedTarget {
  target: MhTarget
  /** 混合权重。measure 系目标有 incr/decr 两份，权重可取负 */
  weight: number
}

/**
 * 把若干形变目标按权重叠加到基础网格上。
 *
 * ⚠️ 这是**改体型的正确方式**，不是缩放骨骼。
 *
 * 为什么不能用骨骼缩放：骨骼缩放会被子骨骼**继承**。
 * 实测把脊椎放大 1.18 倍来拉长躯干，结果 `spine01 → neck01 → head`
 * 一路继承下去，**头高被拉伸了 82.45%**（头宽 0.00% 不变，纯纵向拉长）——
 * 换汤不换药，还是头顶尖刺。
 *
 * 形变目标是**直接改网格顶点**的，改哪儿就是哪儿，没有继承问题。
 * 这也是 MakeHuman 自己的做法：网格由目标驱动，
 * 骨架只是**从形变后的网格推导出来**（关节位置 = 顶点质心），自动跟随。
 */
export function applyTargets(base: Float32Array, list: WeightedTarget[]): Float32Array {
  const out = Float32Array.from(base)
  for (const { target, weight } of list) {
    if (!weight) continue
    for (const [i, d] of target) {
      if (i * 3 + 2 >= out.length) continue
      out[i * 3] += d[0] * weight
      out[i * 3 + 1] += d[1] * weight
      out[i * 3 + 2] += d[2] * weight
    }
  }
  return out
}

/**
 * 顶点 → 主导骨骼（权重最大的那根）。
 *
 * 用来分析「某个形变目标实际影响了哪些部位」，
 * 也用于把网格按身体部位分组做统计。
 */
export function dominantBone(weights: MhWeights, vertexCount: number): (string | null)[] {
  const best = new Array<string | null>(vertexCount).fill(null)
  const bestW = new Float32Array(vertexCount)
  for (const [bone, pairs] of Object.entries(weights.weights)) {
    for (const [vi, w] of pairs) {
      if (vi < 0 || vi >= vertexCount) continue
      if (w > bestW[vi]!) {
        bestW[vi] = w
        best[vi] = bone
      }
    }
  }
  return best
}

// ────────────────────────────────────────────────────────────
// 围度测量
// ────────────────────────────────────────────────────────────

export interface SliceMeasure {
  /** 参与统计的顶点数 */
  count: number
  /** 左右宽度 */
  width: number
  /** 前后厚度 */
  depth: number
  /** 椭圆近似的周长。**不是精确围度**，但足以做相对比较与校准 */
  perimeter: number
}

/**
 * 量某个高度处的横截面。
 *
 * 为什么用「椭圆近似」而不是算真实周长：
 *   真实围度需要把该高度附近的顶点排序连成多边形再求周长，
 *   但网格在该高度上的顶点分布并不均匀（还有手臂等干扰），
 *   直接连多边形会得到锯齿状结果。
 *   椭圆近似（用横向半轴 a、纵向半轴 b 代入拉马努金公式）
 *   对「躯干横截面」这种接近椭圆的形状足够准，
 *   而我们的用途是**相对比较**（改了参数之后粗了多少），不是绝对量体。
 *
 * ⚠️ 必须只统计**躯干**顶点：手臂在腰高附近也存在，
 * 混进来会让腰围虚高一倍。用主导骨骼过滤。
 */
export function sliceMeasure(
  pos: Float32Array,
  yCenter: number,
  yTolerance: number,
  filter?: (vertexIndex: number) => boolean,
): SliceMeasure {
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity
  let n = 0
  const vc = pos.length / 3
  for (let i = 0; i < vc; i++) {
    const y = pos[i * 3 + 1]!
    if (Math.abs(y - yCenter) > yTolerance) continue
    if (filter && !filter(i)) continue
    const x = pos[i * 3]!
    const z = pos[i * 3 + 2]!
    if (x < xmin) xmin = x
    if (x > xmax) xmax = x
    if (z < zmin) zmin = z
    if (z > zmax) zmax = z
    n++
  }
  if (!n) return { count: 0, width: 0, depth: 0, perimeter: 0 }
  const a = (xmax - xmin) / 2
  const b = (zmax - zmin) / 2
  // 拉马努金椭圆周长近似：h = ((a-b)/(a+b))²
  const h = ((a - b) / Math.max(a + b, 1e-9)) ** 2
  const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
  return { count: n, width: xmax - xmin, depth: zmax - zmin, perimeter }
}

/**
 * 从骨架推导出三个关键测量高度。
 *
 * 用骨骼位置而不是硬编码高度：网格被形变目标改变后骨骼会自动跟随，
 * 测量点也跟着走。硬编码高度的做法在体型变化后必然量错地方。
 */
export function measureHeights(
  skel: MhSkeleton,
  pos: Float32Array,
): { chest: number; waist: number; hip: number; headTop: number; footBottom: number } {
  const at = (n: string): number | null => {
    const def = skel.bones[n]
    if (!def) return null
    return jointPosition(def.head, skel, pos)?.y ?? null
  }
  const spine01 = at('spine01') ?? 0   // 胸
  const spine03 = at('spine03') ?? 0   // 腰上
  const spine02 = at('spine02') ?? 0   // 腰下
  const root = at('root') ?? 0         // 骨盆

  let ymin = Infinity, ymax = -Infinity
  for (let i = 1; i < pos.length; i += 3) {
    const y = pos[i]!
    if (y < ymin) ymin = y
    if (y > ymax) ymax = y
  }
  return {
    chest: spine01,
    // 腰取腰椎中段，而不是某一根骨头 —— 单根骨头的位置在不同体型下会漂
    waist: (spine03 + spine02) / 2,
    hip: root,
    headTop: ymax,
    footBottom: ymin,
  }
}
