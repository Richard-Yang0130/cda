/**
 * Surface Nets 多边形化 —— 把隐式曲面（SDF）转成三角网格。
 *
 * 为什么不用 Marching Cubes：
 *   MC 需要两张 256 项的查表，代码量大、且每格顶点数不定（最多 5 个），
 *   顶点更多、更重。Surface Nets 每个含有曲面的格子只产生**一个**顶点，
 *   结构简单、网格更轻 —— 对移动端更友好。
 *
 * 代价是棱角位置略有平滑（毕竟是取交点平均），但对人体这种有机形体
 * 反而是优点：天然更圆润。
 */
import * as THREE from 'three'
import type { Vec3 } from './sdf'

export interface PolygonizeOptions {
  bounds: { min: Vec3; max: Vec3 }
  /** 目标体素边长（米）。越小越精细、越慢 */
  voxel: number
  /** 安全上限：网格角点数超过它就直接提高体素边长，避免卡死 */
  maxCorners?: number
}

/** 12 条棱的端点偏移（相对于格的 (i,j,k) 最小角） */
const EDGE_CORNERS: Array<[number, number, number, number, number, number]> = [
  [0, 0, 0, 1, 0, 0],
  [1, 0, 0, 1, 1, 0],
  [1, 1, 0, 0, 1, 0],
  [0, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 1],
  [1, 1, 1, 0, 1, 1],
  [0, 1, 1, 0, 0, 1],
  [0, 0, 0, 0, 0, 1],
  [1, 0, 0, 1, 0, 1],
  [1, 1, 0, 1, 1, 1],
  [0, 1, 0, 0, 1, 1],
]

export function polygonize(
  sdf: (x: number, y: number, z: number) => number,
  opts: PolygonizeOptions,
): THREE.BufferGeometry {
  const { bounds } = opts
  let h = opts.voxel
  const maxCorners = opts.maxCorners ?? 1_200_000

  const spanX = bounds.max[0] - bounds.min[0]
  const spanY = bounds.max[1] - bounds.min[1]
  const spanZ = bounds.max[2] - bounds.min[2]

  // 网格角点数超限时自动降精度，宁可糊一点也不要卡死
  let nx = Math.ceil(spanX / h) + 1
  let ny = Math.ceil(spanY / h) + 1
  let nz = Math.ceil(spanZ / h) + 1
  while (nx * ny * nz > maxCorners) {
    h *= 1.25
    nx = Math.ceil(spanX / h) + 1
    ny = Math.ceil(spanY / h) + 1
    nz = Math.ceil(spanZ / h) + 1
  }

  const ox = bounds.min[0]
  const oy = bounds.min[1]
  const oz = bounds.min[2]

  // ── 1. 在网格角点上采样 SDF ──
  const values = new Float32Array(nx * ny * nz)
  let idx = 0
  for (let k = 0; k < nz; k++) {
    const z = oz + k * h
    for (let j = 0; j < ny; j++) {
      const y = oy + j * h
      for (let i = 0; i < nx; i++) {
        values[idx++] = sdf(ox + i * h, y, z)
      }
    }
  }
  const at = (i: number, j: number, k: number) => values[i + nx * (j + ny * k)]

  // ── 2. 每个含曲面的格子生成一个顶点 ──
  const cx = nx - 1
  const cy = ny - 1
  const cz = nz - 1
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1)

  const positions: number[] = []
  const cellAt = (i: number, j: number, k: number) => i + cx * (j + cy * k)

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const v000 = at(i, j, k)
        const v100 = at(i + 1, j, k)
        const v010 = at(i, j + 1, k)
        const v110 = at(i + 1, j + 1, k)
        const v001 = at(i, j, k + 1)
        const v101 = at(i + 1, j, k + 1)
        const v011 = at(i, j + 1, k + 1)
        const v111 = at(i + 1, j + 1, k + 1)

        // 全在内部或全在外部 -> 无曲面
        const neg =
          (v000 < 0 ? 1 : 0) + (v100 < 0 ? 1 : 0) + (v010 < 0 ? 1 : 0) + (v110 < 0 ? 1 : 0) +
          (v001 < 0 ? 1 : 0) + (v101 < 0 ? 1 : 0) + (v011 < 0 ? 1 : 0) + (v111 < 0 ? 1 : 0)
        if (neg === 0 || neg === 8) continue

        const corner = [v000, v100, v010, v110, v001, v101, v011, v111]
        let sx = 0
        let sy = 0
        let sz = 0
        let count = 0

        for (const [a, b, c, d, e, f] of EDGE_CORNERS) {
          const va = corner[a + 2 * b + 4 * c]!
          const vb = corner[d + 2 * e + 4 * f]!
          if ((va < 0) === (vb < 0)) continue
          // 线性插值出过零点
          const t = va / (va - vb)
          sx += a + (d - a) * t
          sy += b + (e - b) * t
          sz += c + (f - c) * t
          count++
        }
        if (count === 0) continue

        cellVertex[cellAt(i, j, k)] = positions.length / 3
        positions.push(
          ox + (i + sx / count) * h,
          oy + (j + sy / count) * h,
          oz + (k + sz / count) * h,
        )
      }
    }
  }

  // ── 3. 沿三条轴遍历，把跨符号的格子连成四边形 ──
  const indices: number[] = []

  /**
   * 发出一个四边形。
   *
   * flip 是**必须**的：沿某条轴穿过曲面时，起点可能落在体内（负），
   * 也可能落在体外（正）。两种情况下面法线方向正好相反。
   * 如果一律用同一个绕向，会有一半的面朝里 —— 渲染出来就是满屏破洞。
   * （这个 bug 实际踩到过：整个人偶像被虫蛀了。）
   */
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) indices.push(a, d, c, a, c, b)
    else indices.push(a, b, c, a, c, d)
  }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v = at(i, j, k)
        // 起点在体外时需要反向
        const flip = v >= 0

        // +X 方向的棱：共享它的 4 个格子在 (y,z) 平面上环列
        if (i < nx - 1 && j >= 1 && k >= 1 && j < ny - 1 && k < nz - 1) {
          const vx = at(i + 1, j, k)
          if ((v < 0) !== (vx < 0)) {
            quad(
              cellVertex[cellAt(i, j - 1, k - 1)]!,
              cellVertex[cellAt(i, j, k - 1)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i, j - 1, k)]!,
              flip,
            )
          }
        }

        // +Y 方向的棱
        if (j < ny - 1 && i >= 1 && k >= 1 && i < nx - 1 && k < nz - 1) {
          const vy = at(i, j + 1, k)
          if ((v < 0) !== (vy < 0)) {
            quad(
              cellVertex[cellAt(i - 1, j, k - 1)]!,
              cellVertex[cellAt(i - 1, j, k)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i, j, k - 1)]!,
              flip,
            )
          }
        }

        // +Z 方向的棱
        if (k < nz - 1 && i >= 1 && j >= 1 && i < nx - 1 && j < ny - 1) {
          const vz = at(i, j, k + 1)
          if ((v < 0) !== (vz < 0)) {
            quad(
              cellVertex[cellAt(i - 1, j - 1, k)]!,
              cellVertex[cellAt(i, j - 1, k)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i - 1, j, k)]!,
              flip,
            )
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)

  // ── 4. 用有向体积自动纠正整体绕向 ──
  // 三条轴生成的四边形之间绕向是一致的，但「整体朝内还是朝外」取决于
  // SDF 的符号约定。与其手工推导，不如算一次网格的有向体积：
  // 为负说明法线朝内，整体翻转即可。这样就不怕符号约定搞反。
  if (signedVolume(positions, indices) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]!
      indices[i + 1] = indices[i + 2]!
      indices[i + 2] = t
    }
  }

  geometry.computeVertexNormals()
  return geometry
}

/** 三角网格的有向体积（散度定理）。为正表示法线朝外 */
function signedVolume(positions: number[], indices: number[]): number {
  let total = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3
    const b = indices[i + 1]! * 3
    const c = indices[i + 2]! * 3
    const ax = positions[a]!, ay = positions[a + 1]!, az = positions[a + 2]!
    const bx = positions[b]!, by = positions[b + 1]!, bz = positions[b + 2]!
    const cx2 = positions[c]!, cy2 = positions[c + 1]!, cz2 = positions[c + 2]!
    total +=
      ax * (by * cz2 - bz * cy2) -
      ay * (bx * cz2 - bz * cx2) +
      az * (bx * cy2 - by * cx2)
  }
  return total / 6
}
