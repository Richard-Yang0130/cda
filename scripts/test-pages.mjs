/**
 * 全页面自测：逐页加载，捕获运行时报错与关键元素是否存在。
 * 用生产构建（4173）而不是开发服务器 —— 测的就是要发出去的那一份。
 */
import puppeteer from 'puppeteer-core'

const PAGES = [
  ['首页',        '#/pages/home/home',              ['搜单品、穿搭、用户']],
  ['帖子详情',    '#/pages/post/post?id=po2',        ['牛仔外套']],
  ['确认支付',    '#/pages/pay/pay?productId=p_denim_jacket', ['未接入真实支付', '跳转第三方平台', '微信支付']],
  ['注册-第1步',  '#/pages/register/register',       ['选择登录方式', '手机号', '微信']],
  ['消息页',      '#/pages/messages/messages',       ['搜索用户', '消息']],
  ['设置页',      '#/pages/settings/settings',       ['不被搜索到', '注销账号', '支付方式', '国家与地区']],
  ['个人主页',    '#/pages/profile/profile',         ['我的收藏', '我的关注', '浏览历史', '收货地址']],
  ['我的人偶',    '#/pages/persona/persona',         ['身高', '胸围', '肩宽']],
  ['衣橱',        '#/pages/wardrobe/wardrobe',       []],
  ['发布',        '#/pages/publish/publish',         ['发帖子', '卖闲置']],
]

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
         '--disable-crash-reporter', '--disable-breakpad', '--user-data-dir=/tmp/cda-selftest'],
})

let fail = 0
for (const [label, hash, expects] of PAGES) {
  const p = await b.newPage()
  await p.setViewport({ width: 390, height: 844 })
  // 主页面现在有鉴权守卫，先注入登录态再访问（否则会被引导到注册页）
  await p.evaluateOnNewDocument(() => {
    const u = {
      code: 'CDA_00000001', status: 'active', nickname: '自测用户', gender: 'female',
      birthday: '1995-06-15', avatarHex: '#c9b8a8', styles: ['s_minimal'], brands: ['b_cos'],
      loginMethod: 'phone', createdAt: new Date().toISOString(),
      privacy: { hideFromSearch: false, hideOnlineStatus: false, hideRegion: false, allowStrangerMessage: true },
      region: '中国', lastSeenAt: new Date().toISOString(), isOnline: true,
    }
    try { localStorage.setItem('cda.user.v1', JSON.stringify(u)) } catch {}
  })
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
  await p.goto('http://127.0.0.1:4173/' + hash, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3500))
  const body = await p.evaluate(() => document.body.innerText)
  const missing = expects.filter((t) => !body.includes(t))
  const ok = !errs.length && !missing.length
  if (!ok) fail++
  console.log(
    `${ok ? '✅' : '❌'} ${label.padEnd(10)}` +
    (errs.length ? `  报错: ${errs.join(' | ')}` : '') +
    (missing.length ? `  缺失元素: ${missing.join(', ')}` : ''),
  )
  await p.close()
}
await b.close()
console.log(fail === 0 ? '\n✅ 全部页面通过' : `\n❌ ${fail} 个页面有问题`)
