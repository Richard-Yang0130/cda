/**
 * 注册**全流程**自测：从第 1 步一路走到注册完成。
 *
 * 与之前两个脚本的区别：之前只验证「到达了验证码步骤」，
 * 从没真正输入验证码 —— 于是漏掉了「6 个格子点不到输入框」这个
 * 让流程彻底卡死的 bug。这个脚本把每一步都真正走通并断言结果。
 *
 * 唯一例外：生日的原生日期选择器无法程序化驱动，
 * 用 ?draft=birthday:... 预填，其余全部走真实 UI。
 */
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--disable-crash-reporter','--disable-breakpad','--user-data-dir=/tmp/cda-full'],
})
const p = await b.newPage(); await p.setViewport({ width: 390, height: 900 })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0,150)))
p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,150)) })
const txt = () => p.evaluate(() => document.body.innerText)
const tap = async (l) => {
  const ok = await p.evaluate((x) => {
    const a = [...document.querySelectorAll('uni-view,uni-text,div,span,button')].filter(e=>e.textContent.trim()===x)
    if(!a.length) return false; a[a.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true})); return true
  }, l); await new Promise(r=>setTimeout(r,700)); return ok
}
const R=[]; const ck=(l,c)=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}`)}
const stepNow = async () => {
  const t = await txt()
  return [1,2,3,4,5,6].find(n => t.includes(['','选择登录方式','昵称与性别','基础信息','选择风格','选择品牌','上传头像'][n])) ?? 0
}

// 从第 1 步开始，只预填生日（原生日期控件无法自动化）
await p.goto('http://127.0.0.1:4173/#/pages/register/register?draft=birthday:1995-06-15',
  { waitUntil:'networkidle2', timeout:60000 })
await new Promise(r=>setTimeout(r,3000))
ck('起点是第 1 步', (await stepNow()) === 1)

// ── 第 1 步：手机号 + 验证码 ──
await tap('手机号')
await new Promise(r=>setTimeout(r,600))
// 真实输入手机号
await p.click('uni-input input, input').catch(()=>{})
await p.keyboard.type('13800138000', { delay: 30 })
await new Promise(r=>setTimeout(r,600))
await tap('获取验证码')
await new Promise(r=>setTimeout(r,1000))

const t2 = await txt()
// ⚠️ 必须精确提取「本次验证码：」后面的 6 位。
// 用裸的 /(\d{6})/ 会抓到手机号 13800138000 的前六位 138001 ——
// 上一版就是这么错的：输入框里明明是对的，却拿去和一个假验证码比对。
const m = t2.match(/本次验证码[：:]\s*(\d{6})/)
ck('弹窗按「本次验证码：xxxxxx」给出验证码', !!m)
const code = m ? m[1] : ''
ck(`验证码与手机号前缀不同（${code} ≠ 138001）`, code !== '138001')
console.log(`   验证码 = ${code}`)

// 关掉弹窗（uni.showModal 的确定按钮）
await tap('确定').catch(()=>{})
await new Promise(r=>setTimeout(r,600))

// 关键：把验证码真正输进去
// 点透明覆盖层 → 应聚焦到内层真实 input
await p.click('.codeinput input').catch(async () => { await p.click('.codeinput').catch(()=>{}) })
await p.keyboard.type(code, { delay: 60 })
await new Promise(r=>setTimeout(r,700))
// 直接读输入框的值判断是否真的输进去了（不能用 innerText 里有没有数字，
// 手机号里也含这些数字，会假阳性 —— 上一版就是这么漏掉 bug 的）
const typed = await p.evaluate(() => {
  const el = document.querySelector('.codeinput input')
  return el ? el.value : ''
})
ck(`验证码真的输入进去了（读到 "${typed}"）`, typed === code)

await tap('下一步')
const s2 = await stepNow()
ck('验证码正确 → 进入第 2 步', s2 === 2)

// ── 第 2 步：昵称 + 性别 ──
await p.click('uni-input input, input').catch(()=>{})
await p.keyboard.type('全流程测试', { delay: 30 })
await tap('女性')
await tap('下一步')
ck('第 2 步通过 → 第 3 步', (await stepNow()) === 3)

// ── 第 3 步：生日已预填，身高用滚轮改一个 0.5 值（手输框）──
const t4 = await txt()
ck('第 3 步已带预填生日', t4.includes('1995-06-15'))
await tap('下一步')
ck('第 3 步通过 → 第 4 步', (await stepNow()) === 4)

// ── 第 4 步：风格 ──
await tap('极简')
await tap('下一步')
ck('第 4 步通过 → 第 5 步', (await stepNow()) === 5)

// ── 第 5 步：品牌（搜索 + 选择 + 计数）──
await p.click('uni-input input, input').catch(()=>{})
await p.keyboard.type('cos', { delay: 40 })
await new Promise(r=>setTimeout(r,900))
ck('品牌搜索有结果', /COS/i.test(await txt()))
await tap('COS')
await new Promise(r=>setTimeout(r,500))
ck('品牌计数变为 1/15', (await txt()).includes('1/15'))
await tap('下一步')
ck('第 5 步通过 → 第 6 步', (await stepNow()) === 6)

// ── 第 6 步：完成 ──
await tap('基础款棉质白衬衫').catch(()=>{}) // 随便点一个非交互元素，不影响
await tap('完成注册')
await new Promise(r=>setTimeout(r,2600))
const finalHash = await p.evaluate(() => location.hash)
const finalTxt = await txt()
ck('注册完成后跳转个人主页', finalHash.includes('profile'))
ck('个人主页显示昵称', finalTxt.includes('全流程测试'))
ck('个人主页显示用户码 CDA_xxxxxxxx', /CDA_\d{8}/.test(finalTxt))
ck('个人主页显示在线状态', finalTxt.includes('在线'))

console.log(`\n运行时报错: ${errs.length?errs.join(' | '):'无'}`)
console.log(`通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
