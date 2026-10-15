/**
 * 把 MakeHuman 骨架资产烘焙成运行时用的单一紧凑文件。
 *
 * ── 为什么要烘焙 ──
 * 运行时如果直接读上游格式，要发 20+ 个请求、解析 ~2.5MB 文本，
 * 而且 parseMhTarget 每次都要 split 十几万行。这在跨境链路上不可接受
 * （用户已经反馈过加载慢）。
 *
 * ── 格式选择 ──
 * 用**二进制**而不是 JSON：
 *   - 顶点/索引/蒙皮权重都是定长数值，JSON 的十进制文本会膨胀 2–3 倍
 *   - 解析退化成一次 DataView 读取，没有字符串处理
 * 形变目标用**稀疏**编码（只存被改动的顶点），实测每个目标只动
 * 数百到一万余个顶点，密集存储会浪费 2–10 倍空间。
 *
 * ── 男女共用一个文件 ──
 * MakeHuman 的 base.obj 是**中性**基础网格，性别本身就是一个形变目标，
 * 所以不需要两份网格，只要把两性的 macrodetails 目标都装进去即可。
 *
 * 用法：
 *   node scripts/bake-rig.mjs
 * 输出：
 *   apps/client/src/static/models/rig.bin
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, '.assets/mh_rig')
const OUT = join(ROOT, 'apps/client/src/static/models/rig.bin')

if (!existsSync(join(SRC, 'base.obj'))) {
  console.error('❌ 找不到 .assets/mh_rig/base.obj')
  console.error('   先运行：bash scripts/fetch-mh-rig.sh')
  process.exit(1)
}

// ── 解析（与运行时 mh-rig.ts 同逻辑，这里独立实现以免依赖 TS 编译）──
function parseObj(text) {
  const verts = []
  const tris = []
  for (const line of text.split('\n')) {
    const c = line.charCodeAt(0)
    if (c === 118 /* v */ && (line.charCodeAt(1) === 32 || line.charCodeAt(1) === 9)) {
      const p = line.split(/\s+/)
      verts.push(+p[1], +p[2], +p[3])
    } else if (c === 102 /* f */) {
      const p = line.split(/\s+/)
      const ix = []
      for (let i = 1; i < p.length; i++) {
        const t = p[i]
        if (!t) continue
        const s = t.indexOf('/')
        ix.push(parseInt(s < 0 ? t : t.slice(0, s), 10) - 1)
      }
      for (let i = 1; i < ix.length - 1; i++) tris.push(ix[0], ix[i], ix[i + 1])
    }
  }
  return { verts, tris }
}

function parseTarget(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line || line.charCodeAt(0) === 35) continue
    const p = line.split(/\s+/)
    if (p.length < 4) continue
    const i = parseInt(p[0], 10)
    if (!Number.isFinite(i)) continue
    out.push(i, +p[1], +p[2], +p[3])
  }
  return out
}

console.log('读取 MakeHuman 资产…')
const { verts, tris } = parseObj(readFileSync(join(SRC, 'base.obj'), 'utf8'))
const nV = verts.length / 3
const skel = JSON.parse(readFileSync(join(SRC, 'default.mhskel'), 'utf8'))
const mhw = JSON.parse(readFileSync(join(SRC, 'default_weights.mhw'), 'utf8'))
console.log(`  顶点 ${nV}  三角面 ${tris.length / 3}  骨骼 ${Object.keys(skel.bones).length}`)

// 骨骼顺序：稳定排序，保证 skinIndex 的编号可复现
const boneNames = Object.keys(skel.bones).sort()
const boneSlot = new Map(boneNames.map((n, i) => [n, i]))

// ── 蒙皮权重：每顶点取权重最大的 4 根，并归一化 ──
const MAX_INF = 4
const perVert = Array.from({ length: nV }, () => [])
for (const [bone, pairs] of Object.entries(mhw.weights)) {
  const slot = boneSlot.get(bone)
  if (slot === undefined) continue
  for (const [vi, w] of pairs) {
    if (vi >= 0 && vi < nV && w > 0) perVert[vi].push([slot, w])
  }
}
const skinIndex = new Uint16Array(nV * MAX_INF)
const skinWeight = new Float32Array(nV * MAX_INF)
for (let i = 0; i < nV; i++) {
  const l = perVert[i]
  if (!l.length) { skinWeight[i * MAX_INF] = 1; continue }
  l.sort((a, b) => b[1] - a[1])
  const keep = l.slice(0, MAX_INF)
  let tot = 0
  for (const [, w] of keep) tot += w
  if (tot <= 1e-9) tot = 1
  for (let k = 0; k < keep.length; k++) {
    skinIndex[i * MAX_INF + k] = keep[k][0]
    skinWeight[i * MAX_INF + k] = keep[k][1] / tot
  }
}

// ── 关节：名字 → 顶点索引列表 ──
const jointNames = Object.keys(skel.joints).sort()
const jointSlot = new Map(jointNames.map((n, i) => [n, i]))
const jointData = jointNames.map((n) => skel.joints[n])

// ── 形变目标：只带运行时真正会用到的 ──
/*
 * 只带**够用的** macrodetails，而不是完整的 3×3 组合。
 * 原因：形变目标占了整包 74% 的体积（27 个目标共 1.39MB），
 * 而完整组合里的信息高度冗余 —— 「肌肉」与「体重」两维各 3 档共 9 个，
 * 其中 2 个是空的（中性就是基准网格）。
 *
 * 折中方案：
 *   体重维：minweight / maxweight（averagemuscle 下）→ 线性插值，
 *           中间档由基准网格充当，不额外占体积
 *   肌肉维：maxmuscle-averageweight 当作一个**增量**，按 build 缩放
 * 这样 6 个目标就能覆盖原来的表达范围。
 */
const WANT = []
for (const g of ['female', 'male']) {
  WANT.push(`universal-${g}-young-averagemuscle-minweight`)
  WANT.push(`universal-${g}-young-averagemuscle-maxweight`)
  WANT.push(`universal-${g}-young-maxmuscle-averageweight`)
}
for (const t of ['bust-circ', 'waist-circ', 'hips-circ', 'underbust-circ']) {
  WANT.push(`measure-${t}-incr`)
}
for (const t of ['shoulder-dist', 'napetowaist-dist', 'neck-height',
  'upperarm-length', 'lowerarm-length', 'upperleg-height', 'lowerleg-height']) {
  WANT.push(`measure-${t}-incr`)
}

const targets = []
let skipped = 0
for (const name of WANT) {
  const f = join(SRC, 'targets', `${name}.target`)
  if (!existsSync(f)) { skipped++; continue }
  const flat = parseTarget(readFileSync(f, 'utf8'))
  if (!flat.length) { skipped++; continue }  // 中性组合是空的，跳过
  targets.push({ name, flat })
}
console.log(`  形变目标 ${targets.length} 个（跳过 ${skipped} 个空目标或缺失）`)

// ── 编码 ──
// 布局：[magic u32][ver u32][nV u32][nTri u32][nBone u32][nJoint u32][nTarget u32]
//       [positions f32×3nV][indices u32×3nTri][skinIndex u16×4nV][skinWeight f32×4nV]
//       [boneNames][joints][targets]
const enc = new TextEncoder()
const chunks = []
const u32 = (v) => { const b = new ArrayBuffer(4); new DataView(b).setUint32(0, v, true); return new Uint8Array(b) }
const pushStr = (s) => { const b = enc.encode(s); chunks.push(u32(b.length), b) }

const MAGIC = 0x4d485247 // 'MHRG'
/*
 * ── 量化：每个字段用「够用就好」的位宽 ──
 * 未量化时整包 4.07MB，比现有 OBJ（877KB）大 4 倍多，在跨境链路上不可接受。
 * 逐项压缩后（实测）：
 *   顶点坐标  f32 → i16  范围 ±17 单位，缩放 2000 → 精度 0.0005 单位
 *                        （158cm 身高下约 0.005mm，远超需要）
 *   三角索引  u32 → u16  顶点数 19158 < 65536
 *   骨骼索引  u16 → u8   骨骼 163 < 256
 *   蒙皮权重  f32 → u8   权重和已归一化到 1，1/255 的量化误差不可见
 *   目标偏移  f32 → i16  同上，按各目标自身最大绝对值定标
 */
const POS_SCALE = 2000
const posQ = new Int16Array(nV * 3)
for (let i = 0; i < nV * 3; i++) posQ[i] = Math.max(-32768, Math.min(32767, Math.round(verts[i] * POS_SCALE)))

const idxQ = new Uint16Array(tris)
const skinIdxQ = new Uint8Array(nV * MAX_INF)
for (let i = 0; i < nV * MAX_INF; i++) skinIdxQ[i] = Math.min(255, skinIndex[i])
const skinWQ = new Uint8Array(nV * MAX_INF)
for (let i = 0; i < nV * MAX_INF; i++) skinWQ[i] = Math.max(0, Math.min(255, Math.round(skinWeight[i] * 255)))

chunks.push(u32(MAGIC), u32(2), u32(nV), u32(tris.length / 3), u32(boneNames.length), u32(jointNames.length), u32(targets.length))
chunks.push(u32(POS_SCALE))
chunks.push(new Uint8Array(posQ.buffer))
chunks.push(new Uint8Array(idxQ.buffer))
chunks.push(new Uint8Array(skinIdxQ.buffer))
chunks.push(new Uint8Array(skinWQ.buffer))

// 骨骼
for (const n of boneNames) {
  pushStr(n)
  const b = skel.bones[n]
  pushStr(b.head); pushStr(b.tail); pushStr(b.parent ?? '')
}
// 关节：名字 + 索引列表
for (let i = 0; i < jointNames.length; i++) {
  pushStr(jointNames[i])
  const arr = jointData[i]
  chunks.push(u32(arr.length))
  chunks.push(new Uint8Array(Uint32Array.from(arr).buffer))
}
// 目标：名字 + 定标 + 条目数 + (vi u16, dx,dy,dz i16)
const TGT_SCALE = 20000
for (const t of targets) {
  pushStr(t.name)
  const count = t.flat.length / 4
  chunks.push(u32(count))
  chunks.push(u32(TGT_SCALE))
  const buf = new ArrayBuffer(count * 8)
  const dv = new DataView(buf)
  for (let i = 0; i < count; i++) {
    dv.setUint16(i * 8, t.flat[i * 4], true)
    dv.setInt16(i * 8 + 2, Math.max(-32768, Math.min(32767, Math.round(t.flat[i * 4 + 1] * TGT_SCALE))), true)
    dv.setInt16(i * 8 + 4, Math.max(-32768, Math.min(32767, Math.round(t.flat[i * 4 + 2] * TGT_SCALE))), true)
    dv.setInt16(i * 8 + 6, Math.max(-32768, Math.min(32767, Math.round(t.flat[i * 4 + 3] * TGT_SCALE))), true)
  }
  chunks.push(new Uint8Array(buf))
}

const total = chunks.reduce((n, c) => n + c.length, 0)
const out = new Uint8Array(total)
let off = 0
for (const c of chunks) { out.set(c, off); off += c.length }
writeFileSync(OUT, out)

const mb = (total / 1048576).toFixed(2)
console.log()
console.log(`  写出 ${OUT}`)
console.log(`  体积 ${total} 字节 (${mb} MB)`)
const gz = gzipSync(out).length
console.log(`  gzip 后 ${(gz / 1048576).toFixed(2)} MB（服务器与 Cloudflare 都会自动压缩）`)
// 分项体积，便于判断后续该压哪里
const bd = {
  '顶点坐标 i16': nV * 3 * 2,
  '三角索引 u16': tris.length * 2,
  '骨骼索引 u8': nV * MAX_INF,
  '蒙皮权重 u8': nV * MAX_INF,
  '形变目标': targets.reduce((n, t) => n + (t.flat.length / 4) * 8 + 40, 0),
}
for (const [k, v] of Object.entries(bd)) console.log(`    ${k.padEnd(16)} ${(v / 1048576).toFixed(2)} MB`)
void statSync
