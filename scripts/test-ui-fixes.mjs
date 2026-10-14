/** 自测用户反馈的 4 个界面问题是否真的修好 */
import puppeteer from 'puppeteer-core'
const BASE = process.env.CDA_BASE ?? 'http://127.0.0.1:4173'
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--disable-crash-reporter','--disable-breakpad','--user-data-dir=/tmp/cda-uifix'],
})
const R=[]; const ck=(l,c)=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}`)}
const newPage = async () => {
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844 })
  await p.evaluateOnNewDocument(() => {
    const u = { code:'CDA_00000001', status:'active', nickname:'自测用户', gender:'female',
      birthday:'1995-06-15', avatarHex:'#c9b8a8', styles:['s_minimal'], brands:['b_cos'],
      loginMethod:'phone', createdAt:new Date().toISOString(),
      privacy:{hideFromSearch:false,hideOnlineStatus:false,hideRegion:false,allowStrangerMessage:true},
      region:'中国', lastSeenAt:new Date().toISOString(), isOnline:true }
    try { localStorage.setItem('cda.user.v1', JSON.stringify(u)) } catch {}
  })
  return p
}
const errs=[]
const API = process.env.CDA_API ?? BASE

/**
 * 造一条真实会话。
 * 原版这个用例依赖消息页里的本地示例会话，消息改走后端后就没有了 ——
 * **测试不能依赖实现细节（示例数据）**，要自己准备前置条件。
 */
async function seedConversation() {
  const reg = (n, i) => fetch(API + '/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inviteCode: `CDA-BETA-0${i}`, password: 'pw123456', nickname: n,
      phone: '135' + String(Date.now() + i).slice(-8), gender: 'female', birthday: '1995-06-15' }),
  }).then((r) => r.json())
  const a = await reg('界面甲', 1)
  const b2 = await reg('界面乙', 2)
  await fetch(API + `/api/conversations/${a.user.code}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${b2.token}` },
    body: JSON.stringify({ text: '界面测试消息' }),
  })
  return a
}

// ① 品牌页（第 5 步）「下一步」按钮无需滚动即可见
{
  const p = await newPage()
  p.on('pageerror',e=>errs.push(String(e).slice(0,120)))
  await p.goto(BASE + '/#/pages/register/register?step=5&draft=nickname:%E6%B5%8B,gender:female,birthday:1995-06-15,loginMethod:phone,styles:s_gorpcore',
    { waitUntil:'networkidle2', timeout:60000 })
  await new Promise(r=>setTimeout(r,3500))
  const box = await p.evaluate(() => {
    const a=[...document.querySelectorAll('uni-view,uni-text,div,span')].filter(e=>e.textContent.trim()==='下一步')
    if(!a.length) return null
    const r=a[a.length-1].getBoundingClientRect()
    return { top:r.top, bottom:r.bottom, vh: window.innerHeight }
  })
  ck('第 5 步「下一步」按钮位于视口内（未滚动）', !!box && box.top >= 0 && box.bottom <= box.vh)
  if (box) console.log(`   按钮 top=${Math.round(box.top)} bottom=${Math.round(box.bottom)} 视口高=${box.vh}`)
  await p.close()
}

const seeded = await seedConversation()

// ② 消息页有底部导航
{
  const p = await newPage()
  await p.goto(BASE + '/', { waitUntil:'networkidle2', timeout:60000 })
  await new Promise(r=>setTimeout(r,1500))
  await p.evaluate((t,u)=>{ localStorage.setItem('cda.token.v1',t); localStorage.setItem('cda.user.v1',u) },
    seeded.token, JSON.stringify(seeded.user))
  p.on('pageerror',e=>errs.push(String(e).slice(0,120)))
  await p.goto(BASE + '/#/pages/messages/messages',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,3500))
  const t = await p.evaluate(()=>document.body.innerText)
  ck('消息页有底部导航（含 首页/衣橱/我的）', ['首页','衣橱','我的'].every(x=>t.includes(x)))
  const tabbar = await p.evaluate(() => {
    const el = document.querySelector('.tabbar')
    return el ? getComputedStyle(el).display !== 'none' : false
  })
  ck('底部导航可见', tabbar)
  await p.close()
}

// ③ 会话头部可进入他人主页
{
  const p = await newPage()
  await p.goto(BASE + '/', { waitUntil:'networkidle2', timeout:60000 })
  await new Promise(r=>setTimeout(r,1500))
  await p.evaluate((t,u)=>{ localStorage.setItem('cda.token.v1',t); localStorage.setItem('cda.user.v1',u) },
    seeded.token, JSON.stringify(seeded.user))
  p.on('pageerror',e=>errs.push(String(e).slice(0,120)))
  await p.goto(BASE + '/#/pages/messages/messages',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,3500))
  // 点第一个会话 —— 用 .row 选择器。
  // 会话行的 textContent 是「名字 + 最后一条消息」，精确等于 '林' 匹配不到，
  // 上一版就是这么点空的。
  const clicked = await p.evaluate(()=>{
    const r=document.querySelector('.row'); if(!r) return false
    r.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true
  })
  await new Promise(r=>setTimeout(r,1000))
  if (!clicked) console.log('   ⚠️ 没找到会话行')
  const hasHead = await p.evaluate(()=>document.querySelector('.chav')!==null)
  ck('会话头部有可点头像', hasHead)
  await p.evaluate(()=>{const e=document.querySelector('.chinfo'); if(e)e.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  await new Promise(r=>setTimeout(r,1500))
  ck('点会话头部进入他人主页', (await p.evaluate(()=>location.hash)).includes('user'))
  await p.close()
}

// ④ 个人主页设置入口在右上角齿轮
{
  const p = await newPage()
  p.on('pageerror',e=>errs.push(String(e).slice(0,120)))
  await p.goto(BASE + '/#/pages/profile/profile',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,3500))
  const g = await p.evaluate(() => {
    const el = document.querySelector('.gear')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top:r.top, right: r.right, vw: window.innerWidth, icon: el.textContent.trim() }
  })
  ck('右上角存在齿轮按钮', !!g)
  if (g) {
    ck('齿轮位于右上角（顶部 120px 内且靠右）', g.top < 120 && g.right > g.vw * 0.75)
    ck('齿轮图标非空', g.icon.length > 0)
    console.log(`   齿轮 top=${Math.round(g.top)} right=${Math.round(g.right)} 视口宽=${g.vw} 图标="${g.icon}"`)
  }
  await p.evaluate(()=>{const e=document.querySelector('.gear'); if(e)e.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  await new Promise(r=>setTimeout(r,1500))
  ck('点齿轮进入设置页', (await p.evaluate(()=>location.hash)).includes('settings'))
  await p.close()
}

console.log(`\n运行时报错: ${errs.length?errs.join(' | '):'无'}`)
console.log(`通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
