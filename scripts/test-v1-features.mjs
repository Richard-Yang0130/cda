/** 自测：聊天历史持久化 / 三围输入校验 / 版本更新弹窗 */
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({
  executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,
  args:['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--disable-crash-reporter','--disable-breakpad','--user-data-dir=/tmp/cda-v1'],
})
const R=[]; const ck=(l,c)=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}`)}
const errs=[]
const seedUser = () => {
  const u = { code:'CDA_00000001', status:'active', nickname:'自测用户', gender:'female',
    birthday:'1995-06-15', avatarHex:'#c9b8a8', styles:['s_minimal'], brands:['b_cos'],
    loginMethod:'phone', createdAt:new Date().toISOString(),
    privacy:{hideFromSearch:false,hideOnlineStatus:false,hideRegion:false,allowStrangerMessage:true},
    region:'中国', lastSeenAt:new Date().toISOString(), isOnline:true }
  try { localStorage.setItem('cda.user.v1', JSON.stringify(u)) } catch {}
}
const mk = async (extra) => {
  const p = await b.newPage(); await p.setViewport({width:390,height:844})
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)))
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,140)) })
  await p.evaluateOnNewDocument(`(${seedUser.toString()})();if(!window.__vSeeded){window.__vSeeded=1;${extra ?? ''}}`)
  return p
}

// ① 聊天：打字 → 发送 → 刷新后历史仍在
{
  const p = await mk()
  await p.goto('http://127.0.0.1:4173/#/pages/messages/messages',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,3500))
  await p.evaluate(()=>{const r=document.querySelector('.row'); if(r)r.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  // 等聊天视图真正渲染完（1200ms 时可能还是空白，上一版就因此误判为 0 条消息）
  await new Promise(r=>setTimeout(r,2000))
  ck('进入会话成功', await p.evaluate(()=>document.querySelector('.composer')!==null))
  ck('历史消息已渲染', (await p.evaluate(()=>document.querySelectorAll('.bubble').length)) > 0)
  // 不能用 click：uni-app 的 placeholder 层会拦截点击，
  // 必须直接 focus 内层 input（否则打字进不去）
  await p.evaluate(()=>{const e=document.querySelector('.composer .uni-input-input'); if(e)e.focus()})
  await p.keyboard.type('这是一条持久化测试消息', {delay:30})
  await new Promise(r=>setTimeout(r,600))
  const typed = await p.evaluate(()=>{const e=document.querySelector('.composer input'); return e?e.value:''})
  ck(`聊天框能打字（读到 "${typed.slice(0,6)}…"）`, typed.includes('持久化测试'))
  await p.evaluate(()=>{const e=document.querySelector('.send'); if(e)e.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  await new Promise(r=>setTimeout(r,1000))
  ck('消息已发出并显示', (await p.evaluate(()=>document.body.innerText)).includes('这是一条持久化测试消息'))
  // 刷新页面 —— 历史应仍在
  await p.reload({waitUntil:'networkidle2'})
  await new Promise(r=>setTimeout(r,3500))
  await p.evaluate(()=>{const r=document.querySelector('.row'); if(r)r.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  await new Promise(r=>setTimeout(r,2000))
  const after = await p.evaluate(()=>document.body.innerText)
  ck('刷新后历史消息仍在（已持久化）', after.includes('这是一条持久化测试消息'))
  await p.close()
}

// ② 三围输入 + 校验
{
  const p = await mk()
  await p.goto('http://127.0.0.1:4173/#/pages/register/register?step=3&draft=nickname:%E6%B5%8B,gender:female,birthday:1995-06-15,loginMethod:phone',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,3500))
  const hasInputs = await p.evaluate(()=>document.querySelectorAll('.ginput').length)
  ck(`三围已改为输入框（找到 ${hasInputs} 个）`, hasInputs === 3)
  ck('身高体重显示为大字数值', await p.evaluate(()=>document.querySelector('.hwnum')!==null))
  // 输入非法值 → 应报错
  await p.evaluate(()=>{
    const el=document.querySelectorAll('.ginput input')[0]
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set
    set.call(el,'999'); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}))
    el.dispatchEvent(new Event('blur',{bubbles:true}))
  })
  await new Promise(r=>setTimeout(r,900))
  const errTxt = await p.evaluate(()=>{const e=document.querySelector('.gerr'); return e?e.textContent.trim():''})
  ck(`非法三围被拦截并提示（"${errTxt}"）`, errTxt.length > 0)
  const blocked = await p.evaluate(()=>document.body.innerText.includes('三围填写有误'))
  ck('三围有误时禁止进入下一步', blocked)
  // 输入合法值 → 错误消失
  await p.evaluate(()=>{
    const el=document.querySelectorAll('.ginput input')[0]
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set
    set.call(el,'86'); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}))
    el.dispatchEvent(new Event('blur',{bubbles:true}))
  })
  await new Promise(r=>setTimeout(r,900))
  ck('改为合法值后错误消失', !(await p.evaluate(()=>document.querySelector('.gerr')!==null)))
  await p.close()
}

// ③ 版本更新弹窗
{
  const p = await mk()   // 不通过 evaluateOnNewDocument 注入版本号 ——
                         // 那个钩子每次刷新都会重跑，window 上的标志也不保留，
                         // 之前的写法等于每次刷新都把版本重置回 0.9.0。
  await p.goto('http://127.0.0.1:4173/#/pages/home/home',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,3500))

  // 先写入「上次看到 0.9.0」，再刷新，模拟一次真实升级
  await p.evaluate(()=>{ try{localStorage.setItem('cda.lastSeenVersion','0.9.0')}catch{} })
  await p.reload({waitUntil:'networkidle2'})
  await new Promise(r=>setTimeout(r,4000))
  const t = await p.evaluate(()=>document.body.innerText)
  ck('版本变化后弹出更新说明', t.includes('这次更新了什么'))
  ck('弹窗显示目标版本号 1.0.0-beta', t.includes('1.0.0-beta'))
  ck('弹窗列出更新要点', t.includes('6 步注册') || t.includes('穿搭社区'))

  await p.evaluate(()=>{const a=[...document.querySelectorAll('uni-view,uni-text,div,span')].filter(e=>e.textContent.trim()==='知道了'); if(a.length)a[a.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  await new Promise(r=>setTimeout(r,900))
  ck('点「知道了」后弹窗关闭', !(await p.evaluate(()=>document.body.innerText)).includes('这次更新了什么'))
  const saved = await p.evaluate(()=>localStorage.getItem('cda.lastSeenVersion'))
  ck(`已记录已读版本（${saved}）`, saved === '1.0.0-beta')

  await p.reload({waitUntil:'networkidle2'})
  await new Promise(r=>setTimeout(r,4000))
  ck('再次进入不再弹窗（这是真实用户升级后的行为）',
     !(await p.evaluate(()=>document.body.innerText)).includes('这次更新了什么'))
  await p.close()
}

console.log(`\n运行时报错: ${errs.length?errs.join(' | '):'无'}`)
console.log(`通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
