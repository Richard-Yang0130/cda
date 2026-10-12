/**
 * 身型数据组合测试。
 *
 * 用「身高 + 体重」这种最自然的输入方式覆盖常规身型 ——
 * 围度由耦合模型派生，所以这一条路径就是普通用户最常走的那条。
 * 每个用例出一张图，最后拼成contact sheet便于一眼评估。
 *
 * 用法：node scripts/test-body-suite.mjs   （需开发服务器在 5173）
 */
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const CASES = [
  ['女 155/42 偏瘦',  'g=female&m=height:155,weight:42'],
  ['女 158/56 标准',  'g=female'],
  ['女 165/70 微胖',  'g=female&m=height:165,weight:70'],
  ['女 170/85 丰满',  'g=female&m=height:170,weight:85'],
  ['女 180/70 高挑',  'g=female&m=height:180,weight:70'],
  ['男 165/58 偏瘦',  'g=male&m=height:165,weight:58'],
  ['男 170/65 标准',  'g=male'],
  ['男 178/82 偏壮',  'g=male&m=height:178,weight:82'],
  ['男 185/95 偏胖',  'g=male&m=height:185,weight:95'],
  ['男 195/88 高个',  'g=male&m=height:195,weight:88'],
]

const OUT = '/tmp/bodysuite'
mkdirSync(OUT, { recursive: true })

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
         '--disable-crash-reporter', '--disable-breakpad', '--user-data-dir=/tmp/cda-suite'],
})

const rows = []
let idx = 0
for (const [label, q] of CASES) {
  const p = await b.newPage()
  await p.setViewport({ width: 620, height: 900 })
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  await p.goto('http://127.0.0.1:5173/?' + q, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 14000))
  const file = `${OUT}/${String(idx).padStart(2, '0')}.png`
  await (await p.$('canvas')).screenshot({ path: file })
  const vals = await p.evaluate(() => {
    const t = document.body.innerText.replace(/\n/g, ' ')
    const g = (re) => (t.match(re) || [])[1]
    return {
      身高: g(/身高\s*([\d.]+)cm/), 体重: g(/体重\s*([\d.]+)kg/),
      胸: g(/胸围\s*([\d.]+)cm/), 腰: g(/腰围\s*([\d.]+)cm/), 臀: g(/臀围\s*([\d.]+)cm/),
      大腿: g(/大腿围\s*([\d.]+)cm/), 大臂: g(/大臂围\s*([\d.]+)cm/),
    }
  })
  rows.push({ label, ...vals, err: errs.join('|') || '' })
  console.log(`${label.padEnd(18)} 胸${vals.胸} 腰${vals.腰} 臀${vals.臀} 腿${vals.大腿} 臂${vals.大臂} ${errs.length ? '⚠️' + errs.join('|') : ''}`)
  await p.close()
  idx++
}
await b.close()
writeFileSync(`${OUT}/values.json`, JSON.stringify(rows, null, 2))
console.log('\n已写出', OUT)
