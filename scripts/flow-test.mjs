/**
 * 跨页交互测试：穿搭建议 → 一键穿到 3D 人偶。
 *
 * 这条链路是 Step4 的核心集成点：
 *   穿搭建议页写入 store.pendingOutfit
 *   → navigateBack 回到 3D 试穿台
 *   → onShow 消费 pendingOutfit 并把单品挂到引擎上
 *
 * 注意：uni-app H5 的 onShow 早于引擎初始化触发，所以有"引擎未就绪则
 * 不清空标记"的逻辑，这里正好一并验证。
 *
 * 用法：node scripts/flow-test.mjs
 */
import puppeteer from 'puppeteer-core'
import { createHash } from 'node:crypto'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--user-data-dir=/tmp/cda-flow',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: 430, height: 1200, deviceScaleFactor: 1 })

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 按可见文本点击。
 * 注意 pick：页面上可能有多个文案相同的按钮（例如 4 条建议各有一个
 * 「在 3D 人偶上试穿」），默认取**第一个**才是"点第一条建议"的语义。
 * 之前取最后一个，导致点到了第 4 条，验证结论一度对不上。
 */
async function clickByText(text, pick = 'first') {
  const ok = await page.evaluate(
    ({ t, p }) => {
      const nodes = Array.from(document.querySelectorAll('uni-view, uni-text, button, div, span'))
      const exact = nodes.filter((el) => (el.textContent ?? '').trim() === t)
      const target = p === 'first' ? exact[0] : exact[exact.length - 1]
      if (!target) return false
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    },
    { t: text, p: pick },
  )
  return ok
}

/**
 * 用画布截图的内容哈希来判断 3D 是否变化。
 *
 * 之前用 gl.readPixels 采样，结果是假阴性（SwiftShader 下读回的是陈旧缓冲）。
 * 截图哈希更可靠，而且能真正反映"用户看到的东西"。
 */
async function canvasHash() {
  const canvas = await page.$('canvas')
  if (!canvas) return 'no-canvas'
  const buf = await canvas.screenshot()
  return createHash('sha1').update(buf).digest('hex').slice(0, 12)
}

const steps = []

// 1. 打开 3D 试穿台
await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(4000)
const bare = await canvasHash()
steps.push(['1. 打开 3D 试穿台（未穿）画布哈希', bare])

// 2. 进入穿搭建议
await clickByText('穿搭建议')
await sleep(2500)
const onOutfit = await page.evaluate(() => document.body.innerText.includes('#1'))
steps.push(['2. 进入穿搭建议页并生成建议', onOutfit ? '✅ 已渲染建议' : '❌ 未渲染'])
await page.screenshot({ path: '/tmp/flow-1-outfit.png' })

// 3. 点「在 3D 人偶上试穿」
await clickByText('在 3D 人偶上试穿 ›')
await sleep(4000)
const backOnIndex = await page.evaluate(() => document.body.innerText.includes('身型数据'))
const dressed = await canvasHash()
steps.push(['3. 返回 3D 试穿台并自动穿上', backOnIndex ? '✅ 已返回' : '❌ 未返回'])
steps.push(['4. 画布哈希对比', `${bare === dressed ? '❌ 无变化（未穿上）' : '✅ 已变化（穿上生效）'}`])
steps.push(['   未穿前', bare])
steps.push(['   穿上后', dressed])

// 检查页面上是否显示「已穿」标记
const wornBadges = await page.evaluate(() => document.body.innerText.split('已穿').length - 1)
steps.push(['5. 衣橱卡片「已穿」标记数', String(wornBadges)])

await page.screenshot({ path: '/tmp/flow-2-dressed.png' })

console.log('\n跨页流程测试结果:')
for (const [k, v] of steps) console.log(`  ${k}: ${v}`)
if (pageErrors.length) console.log('\n页面异常:\n  ' + pageErrors.join('\n  '))
else console.log('\n✅ 无运行时报错')
console.log('\n截图: /tmp/flow-1-outfit.png, /tmp/flow-2-dressed.png')

await browser.close()
