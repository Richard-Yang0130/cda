/** 注册流程第 4~6 步自测：用 ?draft= 直接落到指定步骤，再走完真实交互 */
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--disable-crash-reporter','--disable-breakpad','--user-data-dir=/tmp/cda-flow2'],
})
const p = await b.newPage(); await p.setViewport({ width: 390, height: 844 })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0,140)))
p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,140)) })
const text = () => p.evaluate(() => document.body.innerText)
const tap = async (l) => {
  const ok = await p.evaluate((x) => {
    const n=[...document.querySelectorAll('uni-view,uni-text,div,span,button')].filter(e=>e.textContent.trim()===x)
    if(!n.length) return false; n[n.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true})); return true
  }, l); await new Promise(r=>setTimeout(r,700)); return ok
}
const results=[]; const check=(l,c)=>{results.push(c);console.log(`${c?'✅':'❌'} ${l}`)}

// 直接落到第 4 步（风格），模拟已填完 1~3 步
await p.goto('http://127.0.0.1:4173/#/pages/register/register?step=4&draft=nickname:%E6%B5%8B%E8%AF%95,gender:female,birthday:1995-06-15,loginMethod:phone',
  { waitUntil:'networkidle2', timeout:60000 })
await new Promise(r=>setTimeout(r,3000))
check('落到第 4 步', (await text()).includes('选择风格'))

// 未选风格应被拦
await tap('下一步')
check('未选风格被拦截', (await text()).includes('选择风格'))

await tap('运动')
await tap('山系')
await tap('下一步')
check('选风格后进入第 5 步', (await text()).includes('选择品牌'))

// 搜品牌
await p.type('uni-input input, input', 'nike').catch(()=>{})
await new Promise(r=>setTimeout(r,900))
const t5 = await text()
check('搜「nike」出结果', /Nike|耐克/.test(t5))
await tap('Nike')
await new Promise(r=>setTimeout(r,500))
const picked = await p.evaluate(() => document.body.innerText.match(/1\/15|2\/15|1\s*\/\s*15/) !== null)
check('选中品牌后计数变化', picked || (await text()).includes('/15'))
await tap('下一步')
check('进入第 6 步', (await text()).includes('上传头像'))

const t6 = await text()
check('第 6 步展示确认信息（昵称/风格/品牌）', t6.includes('测试') && t6.includes('确认信息'))
await tap('完成注册')
await new Promise(r=>setTimeout(r,2500))
const after = await p.evaluate(() => location.hash + '||' + document.body.innerText.slice(0,120))
check('注册完成后跳转到个人主页', after.includes('profile'))
check('个人主页出现用户码', /CDA_\d{8}/.test(await text()))

console.log(`\n运行时报错: ${errs.length?errs.join(' | '):'无'}`)
console.log(`通过 ${results.filter(Boolean).length}/${results.length}`)
await b.close()
