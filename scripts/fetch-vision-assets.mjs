#!/usr/bin/env node
/**
 * 下载端侧人体姿态推理所需的静态资产。
 *
 * 为什么用脚本而不是直接提交进 git：
 *   MediaPipe 的 WASM 有 3 个变体、每个约 12MB，加上模型 5.8MB，
 *   总共约 42MB。提交进仓库会让每次 clone 都很慢，而且这是**可再生成的**
 *   第三方二进制 —— 按需下载更合理。
 *
 * 为什么不用 CDN 直接引用：
 *   1. 训练/演示环境到 jsdelivr、googleapis 的连通性不稳定
 *   2. 用户照片相关的推理应当同源加载，避免额外的第三方请求
 *   3. 版本固定后离线也能跑
 *
 * 用法：
 *   node scripts/fetch-vision-assets.mjs          # 缺什么下什么
 *   node scripts/fetch-vision-assets.mjs --force  # 全部重下
 */
import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps/client/src/static/vision')
const FORCE = process.argv.includes('--force')

/** MediaPipe 官方发布地址。版本写死，避免上游更新导致行为变化 */
const WASM_VERSION = '1.1.0'
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${WASM_VERSION}/wasm`

/**
 * 模型选择说明：
 *   lite   约 5.8MB，速度最快，关键点精度略低
 *   full   约 9MB
 *   heavy  约 30MB
 * PoC 先用 lite —— 我们要的是**比例**，不是指尖级精度，
 * 而模型体积直接影响首次加载体验（跨境链路尤其明显）。
 */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

const ASSETS = [
  { name: 'vision_wasm_internal.js', url: `${CDN_WASM}/vision_wasm_internal.js` },
  { name: 'vision_wasm_internal.wasm', url: `${CDN_WASM}/vision_wasm_internal.wasm` },
  // 不支持 SIMD 的老浏览器需要这一份；现代浏览器用不到，但缺了会加载失败
  { name: 'vision_wasm_nosimd_internal.js', url: `${CDN_WASM}/vision_wasm_nosimd_internal.js` },
  { name: 'vision_wasm_nosimd_internal.wasm', url: `${CDN_WASM}/vision_wasm_nosimd_internal.wasm` },
  { name: 'pose_landmarker_lite.task', url: MODEL_URL },
]

mkdirSync(OUT, { recursive: true })

let downloaded = 0
let skipped = 0
let failed = 0

for (const a of ASSETS) {
  const dest = join(OUT, a.name)
  if (!FORCE && existsSync(dest) && statSync(dest).size > 1024) {
    console.log(`  跳过（已存在） ${a.name}  ${(statSync(dest).size / 1024 / 1024).toFixed(1)}MB`)
    skipped++
    continue
  }
  process.stdout.write(`  下载 ${a.name} … `)
  try {
    const res = await fetch(a.url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1024) throw new Error(`文件过小（${buf.length} 字节），可能是错误响应`)
    writeFileSync(dest, buf)
    console.log(`完成 ${(buf.length / 1024 / 1024).toFixed(1)}MB`)
    downloaded++
  } catch (e) {
    console.log(`失败：${e && e.message ? e.message : e}`)
    failed++
  }
}

const total = ASSETS.reduce((n, a) => {
  const p = join(OUT, a.name)
  return n + (existsSync(p) ? statSync(p).size : 0)
}, 0)

console.log()
console.log(`  新下载 ${downloaded} · 已存在 ${skipped} · 失败 ${failed}`)
console.log(`  目录 ${OUT}`)
console.log(`  合计 ${(total / 1024 / 1024).toFixed(1)}MB`)
if (failed) {
  console.log()
  console.log('  ⚠️ 有文件下载失败。网络受限时可以：')
  console.log('     - 换网络重试')
  console.log('     - 或从其它机器拷贝到上述目录')
  console.log('     缺文件时页面会明确报「模型加载失败」，不会静默降级成假结果。')
  process.exit(1)
}
