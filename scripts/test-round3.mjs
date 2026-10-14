/** 自测本轮三项：跳过品牌 / 三围估算 / 已穿衣服点击脱下 */
import puppeteer from 'puppeteer-core'
const BASE = process.env.CDA_BASE ?? 'http://127.0.0.1:4173'
const b = await puppeteer.launch({
  executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,
  args:['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader','--disable-crash-reporter','--disable-breakpad','--user-data-dir=/tmp/cda-r3'],
})
const R=[]; const ck=(l,c)=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}`)}
const errs=[]
const mk = async () => {
  const p = await b.newPage(); await p.setViewport({width:390,height:844})
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)))
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,140)) })
  await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('cda.user.v1',JSON.stringify({code:'CDA_00000001',status:'active',nickname:'T',gender:'female',birthday:'1995-06-15',avatarHex:'#c9b8a8',styles:[],brands:[],loginMethod:'phone',createdAt:new Date().toISOString(),privacy:{hideFromSearch:false,hideOnlineStatus:false,hideRegion:false,allowStrangerMessage:true},region:'中国',lastSeenAt:new Date().toISOString(),isOnline:true}))}catch{}})
  return p
}
const txt = (p)=>p.evaluate(()=>document.body.innerText)
const tap = async (p,l)=>{ await p.evaluate(x=>{const a=[...document.querySelectorAll('uni-view,uni-text,div,span')].filter(e=>e.textContent.trim()===x); if(a.length)a[a.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true}))},l); await new Promise(r=>setTimeout(r,800)) }

// ① 第 5 步：有「跳过」且可跳
{
  const p = await mk()
  await p.goto(BASE + '/#/pages/register/register?step=5&draft=nickname:%E6%B5%8B,gender:female,birthday:1995-06-15,loginMethod:phone,styles:s_minimal',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,3500))
  ck('第 5 步出现「跳过」按钮', (await txt(p)).includes('跳过'))
  ck('未选品牌时提示可跳过', (await txt(p)).includes('可以跳过'))
  await tap(p,'跳过')
  ck('点跳过后进入第 6 步（不再强制选品牌）', (await txt(p)).includes('上传头像'))
  await p.close()
}

// ② 第 3 步：按身高体重估算三围
{
  const p = await mk()
  await p.goto(BASE + '/#/pages/register/register?step=3&draft=nickname:%E6%B5%8B,gender:female,birthday:1995-06-15,loginMethod:phone,heightCm:160,weightKg:55',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,3500))
  ck('出现「按身高体重估算三围」按钮', (await txt(p)).includes('按身高体重估算'))
  const before = await p.evaluate(()=>[...document.querySelectorAll('.ginput input')].map(e=>e.value).join('/'))
  await tap(p,'按身高体重估算三围')
  await new Promise(r=>setTimeout(r,900))
  const after = await p.evaluate(()=>[...document.querySelectorAll('.ginput input')].map(e=>e.value).join('/'))
  ck(`估算后三围被填入（${before} → ${after}）`, before !== after && after.split('/').every(v=>Number(v)>0))
  ck('显示 BMI', (await txt(p)).includes('BMI'))
  ck('估算值通过校验（无红框报错）', !(await p.evaluate(()=>document.querySelector('.gbox.bad')!==null)))
  await p.close()
}

// ③ 衣橱列表现已支持「再点一下脱下」
{
  const p = await mk()
  await p.goto(BASE + '/#/pages/index/index',{waitUntil:'networkidle2',timeout:60000})
  await new Promise(r=>setTimeout(r,16000)) // 等 3D 网格与衣橱渲染
  const items = await p.evaluate(()=>document.querySelectorAll('.wardrobe-item').length)
  ck(`衣橱列表已渲染（${items} 件）`, items > 0)
  if (items > 0) {
    await p.evaluate(()=>{const e=document.querySelector('.wardrobe-item'); if(e)e.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
    await new Promise(r=>setTimeout(r,3500))
    const wornCount = await p.evaluate(()=>document.querySelectorAll('.wardrobe-item.worn').length)
    ck(`第一次点击穿上（已穿 ${wornCount} 件）`, wornCount === 1)
    // 再点同一件 → 应脱下
    await p.evaluate(()=>{const e=document.querySelector('.wardrobe-item'); if(e)e.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
    await new Promise(r=>setTimeout(r,2500))
    const wornAfter = await p.evaluate(()=>document.querySelectorAll('.wardrobe-item.worn').length)
    ck(`再点一下脱下（已穿 ${wornAfter} 件，应为 0）`, wornAfter === 0)
  }
  await p.close()
}

console.log(`\n运行时报错: ${errs.length?errs.slice(0,3).join(' | '):'无'}`)
console.log(`通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
