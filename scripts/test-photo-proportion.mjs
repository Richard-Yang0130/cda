/**
 * 照片比例估算的浏览器端验证。
 *
 * ── 这个测试验证什么 ──
 * 只验证**只有真浏览器才能证明的那部分**：
 *   1. 页面能打开、隐私提示在首屏、身高越界有提示
 *   2. MediaPipe 的 WASM 能在同源下编译（MIME 正确）
 *   3. 模型能在浏览器里对**真实照片**跑出 33 个关键点与分割掩膜
 *
 * 换算数学由 scripts/test-body-proportion.ts 覆盖（纯函数，24 条断言），
 * 这里不重复测。
 *
 * ── 为什么不驱动 uni.chooseImage ──
 * 试过两条路都不行：
 *   - puppeteer 的 uploadFile（CDP setFileInputFiles）不触发 uni 监听的 change
 *   - 在页面内用 DataTransfer 手动派发 change，uni 的处理器也没有响应
 * 与其把测试绑死在框架内部的文件选择实现上，不如**直接驱动真正有风险的
 * 那段链路**——WASM 编译与模型推理。这段一旦通过，剩下的只是
 * 「把 path 传给 detect」这种一次性接线，由人工在真机确认即可。
 *
 * 级别：L1（核心功能）+ L3（加载耗时）
 */
import puppeteer from 'puppeteer-core'
import { existsSync, readFileSync } from 'node:fs'

const BASE = process.env.CDA_BASE ?? 'http://127.0.0.1:8799'
const PHOTO = process.env.CDA_TEST_PHOTO ?? '/tmp/vtest/pose.jpg'

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
  // MediaPipe 会打一条 XNNPACK 的 INFO，不是错误
  const t = m.text()
  if (m.type() === 'error' && !/401|Unauthorized|XNNPACK|TensorFlow Lite/.test(t)) errs.push(t.slice(0, 200))
})
p.on('response', (res) => {
  const u = res.url()
  if (u.includes('/static/vision/')) {
    assetLog.push({ name: u.split('/').pop(), status: res.status(), type: res.headers()['content-type'] })
  }
})

// ══ 一、页面本身 ══
await p.goto(`${BASE}/#/pages/photo-proportion/photo-proportion`, { waitUntil: 'networkidle2', timeout: 90000 })
await new Promise((r) => setTimeout(r, 4000))

const txt = () => p.evaluate(() => document.body.innerText)
const t0 = await txt()
ck('页面打开成功', t0.includes('从照片估算比例'))
ck('★ 隐私提示在首屏（照片不出设备）',
   t0.includes('照片不会上传') && t0.includes('不会离开你的设备'))
ck('列出了拍摄要求', t0.includes('全身都要拍到') && t0.includes('正对镜头'))
ck('说明了只估算比例、围度另算', t0.includes('围度'))

// 身高越界应即时给出错误
await p.evaluate(() => {
  const inputs = [...document.querySelectorAll('uni-input input, input')]
  const el = inputs.find((x) => x.placeholder && /–/.test(x.placeholder)) ?? inputs[0]
  if (!el) return
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(el, '140')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 900))
ck('★ 身高越界时明确提示（不静默夹紧）', (await txt()).includes('当前人偶支持'))

// ══ 二、端侧推理链路（本测试的重点）══
const b64 = readFileSync(PHOTO).toString('base64')
const start = Date.now()

/*
 * 在页面里动态加载同一个包、同一份静态资产，跑一次真实推理。
 * 用的路径与页面代码完全一致（/static/vision），所以 WASM 的 MIME、
 * 模型体积、跨域策略这些坑都会在这里暴露。
 */
const probe = await p.evaluate(async (data) => {
  const out = { steps: [], landmarks: 0, persons: 0, hasMask: false, error: '' }
  try {
    out.steps.push('import')
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0')
    out.steps.push('fileset')
    const fileset = await vision.FilesetResolver.forVisionTasks('/static/vision')
    out.steps.push('create')
    const lm = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/static/vision/pose_landmarker_lite.task' },
      runningMode: 'IMAGE',
      numPoses: 2,
      outputSegmentationMasks: true,
    })
    out.steps.push('decode')
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('img load failed'))
      i.src = 'data:image/jpeg;base64,' + data
    })
    out.steps.push('detect')
    const r = lm.detect(img)
    out.landmarks = r?.landmarks?.[0]?.length ?? 0
    out.persons = r?.landmarks?.length ?? 0
    out.hasMask = !!(r?.segmentationMasks && r.segmentationMasks.length)
    out.steps.push('done')
    return out
  } catch (e) {
    out.error = String(e && e.message ? e.message : e).slice(0, 300)
    return out
  }
}, b64)

const ms = Date.now() - start
console.log(`   推理链路: ${probe.steps.join(' → ')}${probe.error ? '   错误: ' + probe.error : ''}`)
if (probe.persons) console.log(`   检测到 ${probe.persons} 人，第一个人的关键点数 ${probe.landmarks}`)

ck('★ MediaPipe 库可加载', probe.steps.includes('fileset'))
ck('★ WASM 在同源下编译成功（MIME 正确）', probe.steps.includes('create'),
   assetLog.filter((a) => a.name?.endsWith('.wasm')).map((a) => `${a.status} ${a.type}`).join(', ') || '未观察到 wasm 请求')
ck('★ 模型加载成功', probe.steps.includes('detect'))
ck('★ 真实照片检测出 33 个关键点', probe.landmarks === 33, `${probe.landmarks}`)
ck('检测出了人体分割掩膜（用于判断是否全身入镜）', probe.hasMask === true)

const wasmHits = assetLog.filter((a) => a.status === 200 && a.name?.endsWith('.wasm'))
const taskHits = assetLog.filter((a) => a.status === 200 && a.name?.endsWith('.task'))
ck('★ 静态资产全部 200', wasmHits.length > 0 && taskHits.length > 0,
   `wasm ${wasmHits.length} 个 / task ${taskHits.length} 个`)
ck('WASM 的 MIME 为 application/wasm', wasmHits.every((a) => (a.type ?? '').includes('wasm')),
   wasmHits.map((a) => a.type).join(', '))
ck('推理在可接受时间内完成（< 60s，含模型首次下载）', ms < 60000, `${(ms / 1000).toFixed(1)}s`)

console.log(`\n运行时报错: ${errs.length ? errs.slice(0, 3).join(' | ') : '无'}`)
console.log(`通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
process.exit(R.every(Boolean) ? 0 : 1)
