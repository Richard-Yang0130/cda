/**
 * 隐式曲面（SDF）图元库。
 *
 * 为什么要走 SDF 而不是继续用「圆柱 + 球」拼装：
 *   显式拼装件之间必然存在接缝与硬过渡 —— 那是积木，不是肉体。
 *   SDF 用**平滑并集**把多个「肉块」融成一个连续曲面，且曲面处处光滑，
 *   于是肌肉轮廓（肱二头肌、小腿肚、胸廓收腰）可以自然生长出来。
 *
 * 性能约定：本文件全部用「裸数字」做参数，不创建临时对象 ——
 * 求值函数会被调用数十万次，任何一次分配都会显著拖慢生成。
 */

/** 平滑并集。k 越大过渡越柔；k=0 时退化为普通 min（会露出硬接缝） */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(0, k - Math.abs(a - b)) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** 平滑交集（用来把形体限制在某个区域内） */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k)
}

/** 球 */
export function sdSphere(
  px: number, py: number, pz: number,
  cx: number, cy: number, cz: number, r: number,
): number {
  const dx = px - cx
  const dy = py - cy
  const dz = pz - cz
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r
}

/** 胶囊（等半径线段） */
export function sdCapsule(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
): number {
  const pax = px - ax, pay = py - ay, paz = pz - az
  const bax = bx - ax, bay = by - ay, baz = bz - az
  const len2 = bax * bax + bay * bay + baz * baz
  const dot = pax * bax + pay * bay + paz * baz
  const h = len2 > 1e-12 ? Math.max(0, Math.min(1, dot / len2)) : 0
  const dx = pax - bax * h
  const dy = pay - bay * h
  const dz = paz - baz * h
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r
}

/**
 * 变径胶囊（圆台）。
 * 这是「肌肉」的关键图元：沿轴把半径从 r1 渐变到 r2，
 * 串起来就能做出肱二头肌、小腿肚那种中段隆起。
 * 实现取自 Inigo Quilez 的标准推导。
 */
export function sdRoundCone(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r1: number, r2: number,
): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az
  const l2 = bax * bax + bay * bay + baz * baz
  const rr = r1 - r2
  const a2 = l2 - rr * rr
  const il2 = l2 > 1e-12 ? 1 / l2 : 0

  const pax = px - ax, pay = py - ay, paz = pz - az
  const y = pax * bax + pay * bay + paz * baz
  const z = y - l2

  const x0 = pax * l2 - bax * y
  const x1 = pay * l2 - bay * y
  const x2 = paz * l2 - baz * y
  const xx = x0 * x0 + x1 * x1 + x2 * x2

  const y2 = y * y * l2
  const z2 = z * z * l2
  const k = Math.sign(rr) * rr * rr * xx

  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(xx + z2) * il2 - r2
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(xx + y2) * il2 - r1
  return (Math.sqrt(xx * a2 * il2) + y * rr) * il2 - r1
}

/** 椭球（IQ 的近似解，对本用途足够精确） */
export function sdEllipsoid(
  px: number, py: number, pz: number,
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
): number {
  const dx = (px - cx) / rx
  const dy = (py - cy) / ry
  const dz = (pz - cz) / rz
  const k0 = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const ex = dx / rx, ey = dy / ry, ez = dz / rz
  const k1 = Math.sqrt(ex * ex + ey * ey + ez * ez)
  if (k1 < 1e-9) return -Math.min(rx, ry, rz)
  return (k0 * (k0 - 1.0)) / k1
}

// ────────────────────────────────────────────────────────────
// 形体描述与编译
// ────────────────────────────────────────────────────────────

export type Vec3 = readonly [number, number, number]

/** 扫掠体（躯干）的一个站位：高度 y 处的椭圆半宽 w / 半深 d */
export interface LoftStation {
  y: number
  w: number
  d: number
}

/** 一块「肉」。全身就是若干肉块的平滑并集 */
export type SdfBlob =
  | { kind: 'sphere'; c: Vec3; r: number }
  | { kind: 'capsule'; a: Vec3; b: Vec3; r: number }
  | { kind: 'roundcone'; a: Vec3; b: Vec3; r1: number; r2: number }
  | { kind: 'ellipsoid'; c: Vec3; r: Vec3 }
  /**
   * 沿 Y 轴扫掠的变截面体（带上下盖）。
   *
   * 躯干必须用它，而不是堆一串椭球 —— 椭球之间竖向不重叠时会在中间塌陷，
   * 掐出一个假的细腰（实际踩过，出来的是蜂腰）。扫掠体的截面连续变化，
   * 天然没有这个问题，而且一个图元就够，求值也更快。
   */
  | { kind: 'loft'; stations: LoftStation[] }

/** 扫掠体求值：椭圆形截面 + 上下盖 */
function loftDistance(px: number, py: number, pz: number, stations: LoftStation[]): number {
  const first = stations[0]!
  const last = stations[stations.length - 1]!

  // 把高度夹到有效区间，再插值出该高度的截面
  const yc = py < first.y ? first.y : py > last.y ? last.y : py
  let w = last.w
  let d = last.d
  if (yc <= first.y) {
    w = first.w
    d = first.d
  } else if (yc < last.y) {
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i]!
      const b = stations[i + 1]!
      if (yc >= a.y && yc <= b.y) {
        let t = (yc - a.y) / Math.max(1e-9, b.y - a.y)
        // smoothstep：让腰线、胸廓的过渡更接近真实的肉体曲线，而非折线
        t = t * t * (3 - 2 * t)
        w = a.w + (b.w - a.w) * t
        d = a.d + (b.d - a.d) * t
        break
      }
    }
  }

  // 水平方向：椭圆截面的近似距离
  const nx = px / Math.max(1e-6, w)
  const nz = pz / Math.max(1e-6, d)
  const e = Math.sqrt(nx * nx + nz * nz)
  const horiz = (e - 1) * Math.min(w, d)

  // 垂直方向：上下盖
  const vert = Math.max(first.y - py, py - last.y)

  return Math.max(horiz, vert)
}

function evalBlob(blob: SdfBlob, x: number, y: number, z: number): number {
  switch (blob.kind) {
    case 'sphere':
      return sdSphere(x, y, z, blob.c[0], blob.c[1], blob.c[2], blob.r)
    case 'capsule':
      return sdCapsule(x, y, z, blob.a[0], blob.a[1], blob.a[2], blob.b[0], blob.b[1], blob.b[2], blob.r)
    case 'roundcone':
      return sdRoundCone(x, y, z, blob.a[0], blob.a[1], blob.a[2], blob.b[0], blob.b[1], blob.b[2], blob.r1, blob.r2)
    case 'ellipsoid':
      return sdEllipsoid(x, y, z, blob.c[0], blob.c[1], blob.c[2], blob.r[0], blob.r[1], blob.r[2])
    case 'loft':
      return loftDistance(x, y, z, blob.stations)
  }
}

/** 每个肉块的包围球，用于快速剔除 */
function boundingOf(blob: SdfBlob): { cx: number; cy: number; cz: number; R: number } {
  switch (blob.kind) {
    case 'sphere':
      return { cx: blob.c[0], cy: blob.c[1], cz: blob.c[2], R: blob.r }
    case 'capsule': {
      const cx = (blob.a[0] + blob.b[0]) / 2
      const cy = (blob.a[1] + blob.b[1]) / 2
      const cz = (blob.a[2] + blob.b[2]) / 2
      const hx = (blob.b[0] - blob.a[0]) / 2
      const hy = (blob.b[1] - blob.a[1]) / 2
      const hz = (blob.b[2] - blob.a[2]) / 2
      return { cx, cy, cz, R: Math.sqrt(hx * hx + hy * hy + hz * hz) + blob.r }
    }
    case 'roundcone': {
      const cx = (blob.a[0] + blob.b[0]) / 2
      const cy = (blob.a[1] + blob.b[1]) / 2
      const cz = (blob.a[2] + blob.b[2]) / 2
      const hx = (blob.b[0] - blob.a[0]) / 2
      const hy = (blob.b[1] - blob.a[1]) / 2
      const hz = (blob.b[2] - blob.a[2]) / 2
      return { cx, cy, cz, R: Math.sqrt(hx * hx + hy * hy + hz * hz) + Math.max(blob.r1, blob.r2) }
    }
    case 'ellipsoid':
      return { cx: blob.c[0], cy: blob.c[1], cz: blob.c[2], R: Math.max(blob.r[0], blob.r[1], blob.r[2]) }
    case 'loft': {
      const first = blob.stations[0]!
      const last = blob.stations[blob.stations.length - 1]!
      let maxW = 0
      for (const s of blob.stations) maxW = Math.max(maxW, s.w, s.d)
      const halfH = Math.max(1e-6, (last.y - first.y) / 2)
      return {
        cx: 0,
        cy: (first.y + last.y) / 2,
        cz: 0,
        R: Math.sqrt(maxW * maxW + halfH * halfH),
      }
    }
  }
}

/**
 * 把肉块列表编译成一个求值函数。
 *
 * 关键优化：平滑并集有个性质 —— 当 |a-b| >= k 时 smin 就等于 min。
 * 所以只要某个肉块的**最近可能距离**已经超出当前最小值 k 以上，
 * 就可以整个跳过它的求值。这让求值开销从「全部肉块」降到「邻近几块」，
 * 是能在手机上做实时预览的原因。
 */
export function compileSdf(blobs: SdfBlob[], k: number): (x: number, y: number, z: number) => number {
  const meta = blobs.map((blob) => ({ blob, ...boundingOf(blob) }))

  return (x: number, y: number, z: number): number => {
    let d = Infinity
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i]!
      const dx = x - m.cx
      const dy = y - m.cy
      const dz = z - m.cz
      const reach = Math.sqrt(dx * dx + dy * dy + dz * dz) - m.R
      if (reach > d + k) continue
      d = smin(d, evalBlob(m.blob, x, y, z), k)
    }
    return d
  }
}

/** 全部肉块的合并包围盒，用于确定采样网格范围 */
export function blobsBounds(blobs: SdfBlob[]): { min: Vec3; max: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const blob of blobs) {
    const b = boundingOf(blob)
    min[0] = Math.min(min[0], b.cx - b.R)
    min[1] = Math.min(min[1], b.cy - b.R)
    min[2] = Math.min(min[2], b.cz - b.R)
    max[0] = Math.max(max[0], b.cx + b.R)
    max[1] = Math.max(max[1], b.cy + b.R)
    max[2] = Math.max(max[2], b.cz + b.R)
  }
  return { min, max }
}
