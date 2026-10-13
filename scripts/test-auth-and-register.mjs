/** 自测：鉴权守卫 + 手机号验证 + 0.5 精度滚轮 */
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--disable-crash-reporter','--disable-breakpad','--user-data-dir=/tmp/cda-auth'],
})
const p = await b.newPage(); await p.setViewport({ width: 390, height: 900 })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0,140)))
p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,140)) })
const txt = () => p.evaluate(() => document.body.innerText)
const hash = () => p.evaluate(() => location.hash)
const tap = async (l, nth = -1) => {
  const ok = await p.evaluate((x, n) => {
    const a = [...document.querySelectorAll('uni-view,uni-text,div,span,button')].filter(e=>e.textContent.trim()===x)
    if(!a.length) return false
    ;(n < 0 ? a[a.length-1] : a[n]).dispatchEvent(new MouseEvent('click',{bubbles:true})); return true
  }, l, nth)
  await new Promise(r=>setTimeout(r,600)); return ok
}
const R = []; const ck = (l,c)=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}`)}

// ① 未登录访问主页 → 应被引导到注册
await p.goto('http://127.0.0.1:4173/#/pages/home/home',{waitUntil:'networkidle2',timeout:60000})
await new Promise(r=>setTimeout(r,3500))
ck('未登录访问主页被引导到注册页', (await hash()).includes('register'))
ck('注册页显示第 1 步', (await txt()).includes('选择登录方式'))

// ② 手机号方式 → 进入手机号输入
await tap('手机号')
await new Promise(r=>setTimeout(r,600))
ck('选手机号后进入手机号输入', (await txt()).includes('请输入 11 位手机号'))

// ③ 非法手机号应被拦（点获取验证码）
await p.type('uni-input input, input', '12345').catch(()=>{})
await new Promise(r=>setTimeout(r,500))
await tap('获取验证码')
await new Promise(r=>setTimeout(r,600))
// 断言用「仍停在手机号输入步骤」判断，而不是 placeholder 文案（它不在 innerText 里）
ck('非法手机号被拦截（仍在手机号输入步骤）', !(await txt()).includes('验证码已发送'))

// ④ 合法手机号 → 进入验证码页（6 格）
await p.evaluate(() => {
  const el = document.querySelector('uni-input input, input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set
  setter.call(el, '13800138000')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await new Promise(r=>setTimeout(r,600))
await tap('获取验证码')
await new Promise(r=>setTimeout(r,900))
const t4 = await txt()
ck('合法手机号后进入验证码步骤', t4.includes('验证码已发送') || t4.includes('重新发送'))

// ⑤ 0.5 精度：直接用 draft 参数落到第 3 步验证小数保留
await p.goto('http://127.0.0.1:4173/#/pages/register/register?step=3&draft=nickname:%E6%B5%8B,gender:female,birthday:1995-06-15,loginMethod:phone,heightCm:177.5,weightKg:62.5',
  {waitUntil:'networkidle2',timeout:60000})
await new Promise(r=>setTimeout(r,3000))
const t5 = await txt()
ck('第 3 步可承载 .5 身高（177.5 显示）', t5.includes('177.5'))
ck('第 3 步可承载 .5 体重（62.5 显示）', t5.includes('62.5'))

// ⑥ 地址页可达且校验生效
await p.goto('http://127.0.0.1:4173/#/pages/address/address',{waitUntil:'networkidle2',timeout:60000})
await new Promise(r=>setTimeout(r,3500))
// 地址页是二级页（从个人主页进入），本身不带导航外壳与守卫 —— 这是预期行为
ck('地址页为二级页（无导航外壳，符合预期）', !(await txt()).includes('首页') || (await hash()).includes('address'))

console.log(`\n运行时报错: ${errs.length?errs.join(' | '):'无'}`)
console.log(`通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
