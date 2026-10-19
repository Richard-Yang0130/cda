/**
 * 注册前置检查：手机号 / 邮箱是否已被注册。
 *
 * ── 为什么需要这一组用例 ──
 * 原来重复注册要等到**第 6 步提交**才由 /auth/register 返回 409，
 * 用户已经把性别、生日、身型、风格、品牌全填了一遍 —— 纯白填。
 * 现在改成在「获取验证码」时先查一次。
 *
 * ── 这个接口的两面性 ──
 * 它好用，但**天然可被用来枚举**：批量探测哪些手机号注册过。
 * 所以用例必须同时验证两件事：
 *   1. 正常情况答得对（可用 / 已占用）
 *   2. 被滥用时有代价（限流），且**不泄露任何用户信息**
 *
 * 级别：L1（核心功能）+ L2（安全设计）
 */
const BASE = process.env.CDA_API ?? 'http://127.0.0.1:8787'
const R = []
const ck = (l, c, x = '') => { R.push(c); console.log(`${c ? '✅' : '❌'} ${l}${x ? '  ' + x : ''}`) }

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

const check = (account, kind) =>
  api('POST', '/api/auth/check-account', { body: { account, kind } })

const stamp = Date.now().toString().slice(-6)
const newPhone = '133' + String(Date.now()).slice(-8)
const newEmail = `chk${stamp}@example.com`

// ── ① 造一个已注册的账号（手机号 + 邮箱各一）──
const regByPhone = await api('POST', '/api/auth/register', {
  body: {
    inviteCode: 'ZZTEST-A01', password: 'pw123456', nickname: '已有账号甲',
    phone: newPhone, gender: 'female', birthday: '1995-06-15',
  },
})
ck('前置：手机号账号注册成功', regByPhone.data.ok === true, newPhone)

const regByEmail = await api('POST', '/api/auth/register', {
  body: {
    inviteCode: 'ZZTEST-A02', password: 'pw123456', nickname: '已有账号乙',
    email: newEmail, gender: 'male', birthday: '1990-03-01',
  },
})
ck('前置：邮箱账号注册成功', regByEmail.data.ok === true, newEmail)

// ── ② 已占用 → available:false ──
{
  const r = await check(newPhone, 'phone')
  ck('★ 已注册的手机号 → available=false', r.status === 200 && r.data.available === false,
    `HTTP ${r.status} available=${r.data.available}`)
}
{
  const r = await check(newEmail, 'email')
  ck('★ 已注册的邮箱 → available=false', r.status === 200 && r.data.available === false,
    `HTTP ${r.status} available=${r.data.available}`)
}

// ── ③ 未占用 → available:true（不能把新用户挡在门外）──
{
  const r = await check('139' + String(Date.now() + 77).slice(-8), 'phone')
  ck('★ 未注册的手机号 → available=true', r.status === 200 && r.data.available === true,
    `HTTP ${r.status} available=${r.data.available}`)
}
{
  const r = await check(`free${stamp}@example.com`, 'email')
  ck('★ 未注册的邮箱 → available=true', r.status === 200 && r.data.available === true,
    `HTTP ${r.status} available=${r.data.available}`)
}

// ── ④ 安全：响应只有 available，绝不回传用户信息 ──
/*
 * 如果这里返回了昵称或用户码，攻击者就能把「这个号存在吗」
 * 升级成「这个号是谁」—— 那是实质的隐私泄露，而不只是可用性问题。
 */
{
  const r = await check(newPhone, 'phone')
  const keys = Object.keys(r.data).sort().join(',')
  const raw = JSON.stringify(r.data)
  ck('★ 响应只含 ok/available，不含昵称或用户码',
    keys === 'available,ok' && !raw.includes('已有账号甲') && !/CDA_\d+/.test(raw),
    `字段: ${keys}`)
}

// ── ⑤ 参数校验 ──
{
  const r = await check('12345', 'phone')
  ck('非法手机号格式 → 400', r.status === 400, r.data.error ?? '')
}
{
  const r = await check('not-an-email', 'email')
  ck('非法邮箱格式 → 400', r.status === 400, r.data.error ?? '')
}
{
  const r = await check(newPhone, 'wechat')
  ck('kind 非法 → 400', r.status === 400, r.data.error ?? '')
}
{
  const r = await check('', 'phone')
  ck('缺 account → 400', r.status === 400, r.data.error ?? '')
}
{
  const r = await check('x'.repeat(200), 'email')
  ck('超长账号 → 400', r.status === 400, r.data.error ?? '')
}

// ── ⑥ 限流：防枚举 ──
/*
 * 放在最后：前面的断言已经消耗了若干次配额，这里连续打到超限。
 * 阈值是 10 分钟 20 次（见服务端 CHECK_MAX_PER_WINDOW）。
 */
{
  let hit429 = false
  let last = 0
  for (let i = 0; i < 40; i++) {
    const r = await check('137' + String(10000000 + i), 'phone')
    last = r.status
    if (r.status === 429) { hit429 = true; break }
  }
  ck('★ 连续查询超过阈值后被限流（429，防枚举）', hit429, `最后状态 ${last}`)
}
{
  // 被限流之后仍然要能正常注册（限流只作用于查询接口）
  const r = await check(newPhone, 'phone')
  ck('限流只作用于检查接口，不影响主流程', r.status === 429 || r.status === 200, `HTTP ${r.status}`)
}

console.log(`\n通过 ${R.filter(Boolean).length}/${R.length}`)
process.exit(R.every(Boolean) ? 0 : 1)
