/**
 * 照片比例估算的端侧验证（走应用自己的代码路径）。
 *
 * ── 这个测试的来历 ──
 * 最初它**绕过了应用的导入路径**：在 page.evaluate 里用 CDN 直接 import
 * MediaPipe 跑推理，只验证「库能在浏览器里用」。
 * 结果是漏掉了一个真机必现的 bug —— uni-app 的 H5 构建把
 * `await import('@mediapipe/tasks-vision')` 编译成了畸形的 chunk 路径，
 * 页面一跑就报「Failed to resolve module specifier」，功能完全不可用。
 *
 * 教训：**在评测环境里验证库，不等于验证应用集成。**
 * 现在改为通过页面里的最小注入口（window.__CDA_DEMO_IMAGE）
 * 走**与用户操作完全相同的那条链路**：
 *   选图 → analyse() → FilesetResolver → PoseLandmarker → detect
 *   → estimateBodyProportion → 渲染结果 → 应用到人偶
 *
 * 换算数学仍由 scripts/test-body-proportion.ts 覆盖（纯函数，24 条断言）。
 *
 * 级别：L1（核心功能）+ L3（加载耗时与体积）
 */
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.CDA_BASE ?? 'http://127.0.0.1:8801'
const PHOTO = process.env.CDA_TEST_PHOTO ?? '/tmp/vtest/pose.jpg'
const ROOT = new URL('..', import.meta.url).pathname

/** 测试里假定这个人身高 170，用来验证身高确实被写进状态 */
const HEIGHT = 170

const R = []
const ck = (label, pass, extra = '') => {
  R.push(pass)
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
}

if (!existsSync(PHOTO)) {
  console.log(`❌ 找不到测试照片 ${PHOTO}`)
  console.log('   curl -o /tmp/vtest/pose.jpg https://storage.googleapis.com/mediapipe-assets/pose.jpg')
  process.exit(1)
}

// ══ 先做纯静态的构建产物检查：畸形模块说明符必须不存在 ══
{
  const assetsDir = join(ROOT, 'apps/client/dist/build/h5/assets')
  let found = []
  if (existsSync(assetsDir)) {
    for (const f of readdirSync(assetsDir)) {
      if (!f.endsWith('.js')) continue
      const txt = readFileSync(join(assetsDir, f), 'utf8')
      // 畸形路径长这样：..-node_modules-@mediapipe-tasks-vision-vision_bundle.xxxx.js
      const m = txt.match(/\.\.-node_modules[^"'`)\s]*/g)
      if (m) found = found.concat(m.slice(0, 2))
    }
  }
  ck('★ 构建产物里没有畸形的模块说明符', found.length === 0, found.slice(0, 2).join(' , '))
  // 顺带确认页面 chunk 存在且体积合理（说明 MediaPipe 被打进了它自己的分包）
  const pageChunk = existsSync(assetsDir)
    ? readdirSync(assetsDir).find((f) => f.startsWith('pages-photo-proportion') && f.endsWith('.js'))
    : null
  const size = pageChunk ? statSync(join(assetsDir, pageChunk)).size : 0
  ck('照片页有独立分包（不拖累其它页面首屏）', !!pageChunk && size > 50 * 1024,
     pageChunk ? `${(size / 1024).toFixed(0)}KB` : '未找到')
}

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: [
    '--no-sandbox', '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-crash-reporter', '--disable-breakpad',
    '--user-data-dir=/tmp/cda-photo-test',
  ],
})

const errs = []
const assetLog = []
const p = await b.newPage()
await p.setViewport({ width: 420, height: 900 })
p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)))
p.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error' && !/401|Unauthorized|XNNPACK|TensorFlow Lite/.test(t)) {
    errs.push(t.slice(0, 200))
  }
})
p.on('response', (res) => {
  const u = res.url()
  if (u.includes('/static/vision/')) {
    assetLog.push({ name: u.split('/').pop(), status: res.status(), type: res.headers()['content-type'] })
  }
})

// 注入测试照片：页面 onMounted 时若发现它，就走完整分析链路
const b64 = readFileSync(PHOTO).toString('base64')
await p.evaluateOnNewDocument((data) => {
  window.__CDA_DEMO_IMAGE = 'data:image/jpeg;base64,' + data
}, b64)

const start = Date.now()
await p.goto(`${BASE}/#/pages/photo-proportion/photo-proportion`, { waitUntil: 'networkidle2', timeout: 120000 })

const txt = () => p.evaluate(() => document.body.innerText)

// 首屏静态内容（此时推理可能已在跑，所以先抓一份）
await new Promise((r) => setTimeout(r, 1200))
const t0 = await txt()
ck('页面打开成功', t0.includes('从照片估算比例'))
ck('★ 隐私提示在首屏（照片不出设备）',
   t0.includes('照片不会上传') && t0.includes('不会离开你的设备'))
ck('★ 能力边界在首屏：说明能估比例、不测三围',
   t0.includes('肩宽') && t0.includes('不能测三围'))
ck('列出了拍摄要求', t0.includes('全身都要拍到') && t0.includes('正对镜头'))

// 等推理结果
let state = null
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  state = await p.evaluate(() => ({
    rows: [...document.querySelectorAll('.trow')].map((tr) => ({
      name: tr.querySelector('.tc-name')?.textContent?.trim(),
      val: Number(tr.querySelector('.tc-val')?.textContent?.replace('cm', '')?.trim()),
      conf: tr.querySelector('.cc-text')?.textContent?.trim(),
      warn: !!tr.querySelector('.tc-warn'),
    })),
    fatal: document.querySelector('.fatal')?.textContent?.trim() ?? '',
    blocked: document.querySelectorAll('.issue.block').length,
    busy: !!document.querySelector('.busy'),
    preview: !!document.querySelector('.preview-img'),
  }))
  if (state.rows.length || state.fatal || state.blocked) break
}
const ms = Date.now() - start

ck('★ 测试照片进入分析链路（出现预览）', state?.preview === true)
ck('★ 没有模块解析错误（静态导入修复生效）',
   !(state?.fatal ?? '').includes('module specifier') && !errs.some((e) => e.includes('module specifier')),
   state?.fatal || '')
ck('★ 推理完成并产出结果行', (state?.rows.length ?? 0) > 0,
   state?.fatal ? `fatal: ${state.fatal}` : `${state?.rows.length} 行，${(ms / 1000).toFixed(1)}s`)

if (state?.rows.length) {
  const names = state.rows.map((r) => r.name)
  ck('包含肩宽与躯干长', names.includes('肩宽') && names.includes('躯干长'), names.join(','))
  const vals = state.rows.map((r) => r.val)
  ck('所有值为正且量纲合理（1–100cm）', vals.every((v) => Number.isFinite(v) && v > 1 && v < 100), vals.join(','))
  ck('每行都标了置信度', state.rows.every((r) => ['高', '中'].includes(r.conf ?? '')),
     state.rows.map((r) => r.conf).join(','))
  console.log(`   结果: ${state.rows.map((r) => `${r.name}=${r.val}cm(${r.conf})`).join('  ')}`)
}

// ── 应用到人偶 ──
const before = await p.evaluate(() => localStorage.getItem('cda.bodyState.v1'))
const clicked = await p.evaluate(() => {
  const n = [...document.querySelectorAll('uni-view,uni-text,div,span')]
    .filter((e) => e.textContent.trim() === '应用到人偶')
  if (!n.length) return false
  n[n.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})
await new Promise((r) => setTimeout(r, 1500))
const after = await p.evaluate(() => localStorage.getItem('cda.bodyState.v1'))

if (state?.rows.length && clicked) {
  ck('★ 应用后本地人偶状态被写入', !!after && after !== before)
  if (after) {
    const st = JSON.parse(after)
    ck('★ 只写入了比例字段（frame）', st.frame && typeof st.frame.shoulderWidthCm === 'number' && st.frame.shoulderWidthCm > 0,
       `肩宽 ${st.frame?.shoulderWidthCm}`)
    ck('★ 体脂未被照片改动（不伪造围度）',
       typeof st.adiposity === 'number' && st.adiposity >= 0 && st.adiposity <= 1, `${st.adiposity}`)
    ck('身高被保留（本用例身高取自人偶现值）',
       typeof st.heightCm === 'number' && st.heightCm > 100 && st.heightCm < 220, `${st.heightCm}`)
  }
}

// ── 静态资产 ──
const wasmHits = assetLog.filter((a) => a.status === 200 && a.name?.endsWith('.wasm'))
const taskHits = assetLog.filter((a) => a.status === 200 && a.name?.endsWith('.task'))
ck('★ WASM 与模型同源取到（无第三方 CDN 依赖）', wasmHits.length > 0 && taskHits.length > 0,
   `wasm ${wasmHits.length} / task ${taskHits.length}`)
ck('WASM 的 MIME 为 application/wasm', wasmHits.every((a) => (a.type ?? '').includes('wasm')),
   wasmHits.map((a) => a.type).join(', '))
ck('推理总耗时在可接受范围（< 90s，含模型下载）', ms < 90000, `${(ms / 1000).toFixed(1)}s`)

void HEIGHT
console.log(`\n运行时报错: ${errs.length ? errs.slice(0, 3).join(' | ') : '无'}`)
console.log(`通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
process.exit(R.every(Boolean) ? 0 : 1)
