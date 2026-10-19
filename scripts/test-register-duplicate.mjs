/**
 * 注册前置检查的 **UI 行为**：重复账号必须在「获取验证码」那一刻被拦下。
 *
 * ── 为什么这条必须单独测 ──
 * 接口本身对了（见 test-account-check.mjs），不代表用户**感知到**了。
 * 完全可能出现「接口返回已占用、页面却照样放进验证码步骤」——
 * 那用户还是要填完 6 步，这个改动就等于没做。
 *
 * 所以要验证的是**可观察的界面行为**：
 *   已注册 → 弹出提示、**停在原步骤**、不出现验证码输入框
 *   未注册 → 正常进入验证码步骤（不能把新用户误拦）
 *
 * 级别：L1（核心功能）
 */
import puppeteer from 'puppeteer-core'

const BASE = process.env.CDA_BASE ?? 'http://127.0.0.1:4173'
const R = []
const ck = (l, c, x = '') => { R.push(c); console.log(`${c ? '✅' : '❌'} ${l}${x ? '  ' + x : ''}`) }

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-crash-reporter', '--disable-breakpad',
    `--user-data-dir=/tmp/cda-dup-${Date.now()}`],
})
const p = await b.newPage()
await p.setViewport({ width: 390, height: 900 })
const errs = []
p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)))
p.on('console', (m) => { if (m.type() === 'error' && !/401|Unauthorized/.test(m.text())) errs.push(m.text().slice(0, 150)) })

const txt = () => p.evaluate(() => document.body.innerText)
const tap = async (label) => {
  const ok = await p.evaluate((x) => {
    const a = [...document.querySelectorAll('uni-view,uni-text,div,span,button')]
      .filter((e) => e.textContent.trim() === x)
    if (!a.length) return false
    a[a.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  }, label)
  await new Promise((r) => setTimeout(r, 900))
  return ok
}
/** 往第一个可见输入框填值（uni-app 的 input 渲染成原生 input） */
const fill = async (val) => {
  return p.evaluate((v) => {
    const el = [...document.querySelectorAll('input')].find((x) => x.offsetParent !== null)
    if (!el) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, val)
}
/** 验证码输入框是否出现（6 个格子那一步的特征文案） */
const inCodeStep = async () => (await txt()).includes('验证码已发送至')

// ── 造一个已注册的手机号（走接口，绕开 UI）──
const apiBase = process.env.CDA_API ?? 'http://127.0.0.1:8787'
const takenPhone = '135' + String(Date.now()).slice(-8)
const reg = await fetch(`${apiBase}/api/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    inviteCode: 'ZZTEST-A03', password: 'pw123456', nickname: '占号账号',
    phone: takenPhone, gender: 'female', birthday: '1995-06-15',
  }),
}).then((r) => r.json()).catch(() => ({}))
ck('前置：已注册账号创建成功', reg?.ok === true, takenPhone)

// ── ① 已注册的手机号：点「获取验证码」应被当场拦下 ──
await p.goto(`${BASE}/#/pages/register/register`, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 3500))
await tap('手机号')
ck('手机号输入框出现', (await txt()).includes('获取验证码'))
await fill(takenPhone)
await new Promise((r) => setTimeout(r, 500))
await tap('获取验证码')
await new Promise((r) => setTimeout(r, 1500))

const afterTaken = await txt()
ck('★ 已注册手机号 → 出现「已注册」提示',
  /已经注册|已注册/.test(afterTaken),
  (afterTaken.match(/[^\n]*已经注册[^\n]*/) ?? [''])[0].slice(0, 40))
ck('★ 已注册手机号 → **没有**进入验证码步骤（关键：没有白填）',
  !(await inCodeStep()))

// 关掉提示框，继续下一项
await p.evaluate(() => {
  const btns = [...document.querySelectorAll('uni-view,uni-text,div,span,button')]
    .filter((e) => ['换一个', '取消', '确定', '去登录'].includes(e.textContent.trim()))
  btns[btns.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 800))

// ── ② 未注册的手机号：必须能正常进入验证码步骤（不能误拦）──
await p.goto(`${BASE}/#/pages/register/register`, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 3500))
await tap('手机号')
const freePhone = '136' + String(Date.now() + 13).slice(-8)
await fill(freePhone)
await new Promise((r) => setTimeout(r, 500))
await tap('获取验证码')
await new Promise((r) => setTimeout(r, 1500))

ck('★ 未注册手机号 → 正常进入验证码步骤（不误拦新用户）', await inCodeStep(), freePhone)

ck('无运行时报错', errs.length === 0, errs.slice(0, 2).join(' | '))

console.log(`\n通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
process.exit(R.every(Boolean) ? 0 : 1)
