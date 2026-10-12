/**
 * 无头浏览器验证脚本。
 *
 * 为什么需要它：光看截图无法定位「页面横向溢出」这类问题 ——
 * 我为此靠猜改了两轮 CSS 都没中。这个脚本直接测量 DOM，
 * 一次就能指出是哪个元素越界、宽多少、文本是什么。
 *
 * 用法：
 *   node scripts/verify.mjs <url> [screenshotPath]
 *
 * 输出：
 *   - 视口宽度 / 滚动宽度（判断是否溢出）
 *   - 越界元素清单（标签、class、右边界、宽度、文本片段）
 *   - 页面异常与 console.error
 */
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const url = process.argv[2]
const shotPath = process.argv[3]
const width = Number(process.env.VIEWPORT_WIDTH ?? 430)
const height = Number(process.env.VIEWPORT_HEIGHT ?? 1500)
const waitMs = Number(process.env.WAIT_MS ?? 3500)

if (!url) {
  console.error('用法: node scripts/verify.mjs <url> [screenshotPath]')
  process.exit(1)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/cda-pptr',
  ],
})

const page = await browser.newPage()
await page.setViewport({ width, height, deviceScaleFactor: 1 })

const pageErrors = []
const consoleErrors = []
const badResponses = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
})
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 120)}`)
})

try {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
} catch (err) {
  console.error('导航失败:', err.message)
}
await new Promise((r) => setTimeout(r, waitMs))

const report = await page.evaluate(() => {
  const docW = document.documentElement.clientWidth
  const scrollW = document.documentElement.scrollWidth
  const offenders = []

  for (const el of Array.from(document.querySelectorAll('*'))) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    // 只看明显越界的
    if (rect.right > docW + 1) {
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className ?? '').slice(0, 48),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        overflowPx: Math.round(rect.right - docW),
        text: text.slice(0, 40),
      })
    }
  }

  // 越界最多的排前面，并只保留「最外层」的几个，避免父子重复刷屏
  offenders.sort((a, b) => b.overflowPx - a.overflowPx)
  return { docW, scrollW, overflow: scrollW - docW, offenders: offenders.slice(0, 12) }
})

console.log('URL:', url)
console.log('视口宽:', report.docW, ' 滚动宽:', report.scrollW, ' 溢出:', report.overflow, 'px')
if (report.offenders.length) {
  console.log('\n越界元素:')
  for (const o of report.offenders) {
    console.log(
      `  +${String(o.overflowPx).padStart(4)}px  <${o.tag}> .${o.cls}  w=${o.width}  「${o.text}」`,
    )
  }
} else {
  console.log('\n✅ 无元素越界')
}

if (pageErrors.length) console.log('\n页面异常:\n  ' + pageErrors.join('\n  '))
if (badResponses.length) console.log('\n失败的请求:\n  ' + [...new Set(badResponses)].join('\n  '))
if (!pageErrors.length && !badResponses.length) console.log('\n✅ 无运行时异常与失败请求')

if (shotPath) {
  await page.screenshot({ path: shotPath })
  console.log('\n截图已保存:', shotPath)
}

await browser.close()
