/**
 * L4 版本与聊天。
 *
 * ⚠️ 这个文件重写过一次：
 *   原版测的是「聊天记录存 localStorage」与硬编码的 1.0.0-beta 版本号。
 *   后来消息改成走后端、版本升到 1.0.0，原断言全部失效。
 *   教训：测试里不要硬编码会随版本变化的字符串；
 *        功能改了架构后，测试必须跟着改，不能只改实现。
 */
import puppeteer from 'puppeteer-core'

const BASE = process.env.CDA_BASE ?? 'http://127.0.0.1:4173'
const API = process.env.CDA_API ?? BASE
const R = []; const ck = (l, c, x = '') => { R.push(c); console.log(`${c ? '✅' : '❌'} ${l}${x ? '  ' + x : ''}`) }

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--no-sandbox','--disable-gpu','--enable-unsafe-swiftshader',
         '--disable-crash-reporter','--disable-breakpad','--user-data-dir=/tmp/cda-v1f'],
})
const errs = []
const mk = async () => {
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844 })
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
  return p
}
const txt = (p) => p.evaluate(() => document.body.innerText)
const tap = async (p, l) => {
  await p.evaluate((x) => {
    const a = [...document.querySelectorAll('uni-view,uni-text,div,span')].filter((e) => e.textContent.trim() === x)
    if (a.length) a[a.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, l)
  await new Promise((r) => setTimeout(r, 700))
}

// 造数据：两个用户 + 一条会话（后端架构下会话不会凭空出现）
const mkUser = (n, i) => api('POST', '/api/auth/register', {
  body: { inviteCode: `CDA-BETA-0${i}`, password: 'pw123456', nickname: n,
          phone: '136' + String(Date.now() + i).slice(-8), gender: 'female', birthday: '1995-06-15' },
})
const A = (await mkUser('聊天甲', 1)).data
const B = (await mkUser('聊天乙', 2)).data
await api('POST', `/api/conversations/${A.user.code}/messages`, { token: B.token, body: { text: '你好，这是历史消息' } })

const seed = async (p, token, user) => {
  await p.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 2000))
  await p.evaluate((t, u) => {
    localStorage.setItem('cda.token.v1', t)
    localStorage.setItem('cda.user.v1', u)
  }, token, JSON.stringify(user))
}

// ── 聊天：走后端 ──
{
  const p = await mk()
  await seed(p, A.token, A.user)
  await p.goto(BASE + '/#/pages/messages/messages', { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 5000))
  ck('消息页显示后端返回的会话', (await txt(p)).includes('聊天乙'))

  await p.evaluate(() => { const r = document.querySelector('.row'); if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await new Promise((r) => setTimeout(r, 3000))
  ck('进入会话成功', await p.evaluate(() => document.querySelector('.composer') !== null))
  ck('★ 能读到后端的历史消息', (await txt(p)).includes('你好，这是历史消息'))

  await p.evaluate(() => { const e = document.querySelector('.composer .uni-input-input'); if (e) e.focus() })
  await p.keyboard.type('这是新发的消息', { delay: 30 })
  await new Promise((r) => setTimeout(r, 600))
  const typed = await p.evaluate(() => { const e = document.querySelector('.composer .uni-input-input'); return e ? e.value : '' })
  ck(`聊天框能打字（读到 "${typed.slice(0, 6)}…"）`, typed.includes('新发的消息'))

  await p.evaluate(() => { const e = document.querySelector('.send'); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await new Promise((r) => setTimeout(r, 1500))
  ck('消息已发出并显示', (await txt(p)).includes('这是新发的消息'))

  await p.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 5000))
  await p.evaluate(() => { const r = document.querySelector('.row'); if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await new Promise((r) => setTimeout(r, 3000))
  const after = await txt(p)
  ck('★ 刷新后消息仍在（来自后端，换设备也在）', after.includes('这是新发的消息') && after.includes('你好，这是历史消息'))

  const peer = await api('GET', `/api/conversations/${A.user.code}/messages`, { token: B.token })
  ck('★ 对方也能读到这条消息（确认落在服务端）',
     (peer.data.messages ?? []).some((m) => m.text === '这是新发的消息'))
  await p.close()
}

// ── 版本更新弹窗 ──
{
  const p = await mk()
  await p.goto(BASE + '/#/pages/home/home', { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3000))
  await p.evaluate((t, u) => { localStorage.setItem('cda.token.v1', t); localStorage.setItem('cda.user.v1', u) }, A.token, JSON.stringify(A.user))
  await p.evaluate(() => { try { localStorage.setItem('cda.lastSeenVersion', '0.9.0') } catch { /* 忽略 */ } })
  await p.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 5000))
  const t = await txt(p)
  ck('版本变化后弹出更新说明', t.includes('这次更新了什么'))
  ck('弹窗显示了一个版本号', /\d+\.\d+\.\d+/.test(t))
  // ⚠️ 不要断言具体版本的文案 —— 每升一版这句就得改。
  // 改为断言「列出了一批要点」，与版本无关。
  const items = (t.match(/[•·]/g) ?? []).length
  ck('弹窗列出更新要点', items >= 3, `列出 ${items} 条`)

  await tap(p, '知道了')
  const saved = await p.evaluate(() => localStorage.getItem('cda.lastSeenVersion'))
  ck(`已记录已读版本（${saved}）`, !!saved && saved !== '0.9.0')
  await p.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 4500))
  ck('再次进入不再弹窗', !(await txt(p)).includes('这次更新了什么'))
  await p.close()
}

console.log(`\n运行时报错: ${errs.length ? errs.slice(0, 2).join(' | ') : '无'}`)
console.log(`通过 ${R.filter(Boolean).length}/${R.length}`)
await b.close()
process.exit(R.every(Boolean) ? 0 : 1)
