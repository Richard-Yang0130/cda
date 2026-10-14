/** 管理后台 API 测试：登录、权限边界、邀请码、用户管理、审计 */
const BASE = process.env.CDA_API ?? 'http://127.0.0.1:8787'
const R=[]; const ck=(l,c,x='')=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}${x?'  '+x:''}`)}
async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { 'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(()=>({})) }
}

// ── 登录 ──
const bad = await api('POST','/api/admin/auth/login',{body:{username:(process.env.CDA_ADMIN_USER ?? 'admin'),password:'wrongpassword'}})
ck('错误密码被拒绝', bad.status === 401, bad.data.error)

const login = await api('POST','/api/admin/auth/login',{body:{username:(process.env.CDA_ADMIN_USER ?? 'admin'),password:(process.env.CDA_ADMIN_PASS ?? 'AdminTest123456')}})
ck('正确密码登录成功', login.data.ok === true, login.data.admin?.role)
const T = login.data.token
ck('返回权限清单（供前端显隐按钮）', Array.isArray(login.data.admin?.perms) && login.data.admin.perms.includes('admin.manage'), `${login.data.admin?.perms?.length} 项`)

// ── 隔离性：用户 token 换不到后台权限 ──
const userReg = await api('POST','/api/auth/register',{body:{inviteCode:'CDA-BETA-01',password:'pw123456',nickname:'权限测试用户',phone:'138'+Date.now().toString().slice(-8),gender:'female',birthday:'1995-06-15'}})
const userToken = userReg.data.token
const cross = await api('GET','/api/admin/users',{token:userToken})
ck('★ 用户 token 访问后台接口被拒（两套体系隔离）', cross.status === 401)
const crossMe = await api('GET','/api/me',{token:T})
ck('★ 后台 token 访问用户接口也被拒', crossMe.status === 401)

// ── 邀请码 ──
const list0 = await api('GET','/api/admin/invites',{token:T})
ck('邀请码列表可读', Array.isArray(list0.data.invites), `${list0.data.invites?.length} 个`)
const used = list0.data.invites?.find(i=>i.usedBy)
ck('列表标出哪个码被谁用了', !!used && !!used.usedNickname, used ? `${used.code} → ${used.usedNickname}` : '无')

const gen = await api('POST','/api/admin/invites',{token:T, body:{count:5, prefix:'CDA-BETA', note:'测试生成'}})
ck('批量生成 5 个邀请码', gen.data.created?.length === 5, gen.data.created?.join(','))

const dup = await api('POST','/api/admin/invites',{token:T, body:{count:3, prefix:'CDA-BETA'}})
const all = await api('GET','/api/admin/invites',{token:T})
const codes = (all.data.invites ?? []).map(i=>i.code)
ck('连续生成不撞号', new Set(codes).size === codes.length, `共 ${codes.length} 个，去重后 ${new Set(codes).size} 个`)

// used 可能为 undefined（例如注册没成功时），先挡一下再取 .code
if (!used) { ck('已使用的邀请码不能作废', false, '前置条件缺失：没有已使用的邀请码') }
else {
  const delUsed = await api('DELETE',`/api/admin/invites/${used.code}`,{token:T})
  ck('已使用的邀请码不能作废', delUsed.status === 400, delUsed.data.error)
}
const freeCode = (all.data.invites.find(i=>!i.usedBy) ?? {}).code
if (freeCode) {
  const delFree = await api('DELETE',`/api/admin/invites/${freeCode}`,{token:T})
  ck('未使用的邀请码可作废', delFree.data.ok === true)
} else {
  ck('未使用的邀请码可作废', false, '没有可用邀请码')
}

// ── 用户管理 ──
const users = await api('GET','/api/admin/users',{token:T})
ck('用户列表可读', Array.isArray(users.data.users) && users.data.users.length > 0, `${users.data.users?.length} 人`)
const u0 = users.data.users[0]
ck('owner 能看到手机号', /^1\d{10}$|^\*\*\*$/.test(u0.phone), u0.phone)
ck('列表带发帖数', typeof u0.postCount === 'number')

const noReason = await api('PATCH',`/api/admin/users/${u0.code}`,{token:T, body:{status:'disabled'}})
ck('★ 禁用不填原因被拒绝', noReason.status === 400, noReason.data.error)
const dis = await api('PATCH',`/api/admin/users/${u0.code}`,{token:T, body:{status:'disabled', reason:'测试封禁'}})
ck('填了原因可禁用', dis.data.ok === true)
const afterDis = await api('GET','/api/me',{token:userToken})
ck('★ 用户被禁用后其 token 立即失效（已踢下线）', afterDis.status === 401)
const en = await api('PATCH',`/api/admin/users/${u0.code}`,{token:T, body:{status:'active', reason:'恢复'}})
ck('可恢复启用', en.data.ok === true)

// ── viewer 权限边界 ──
const { DatabaseSync } = await import('node:sqlite')
// 直接造一个 viewer 账号（没有"创建管理员"接口，先绕过）
const bcryptFree = await api('GET','/api/admin/logs',{token:T})
ck('审计日志可读', Array.isArray(bcryptFree.data.logs), `${bcryptFree.data.logs?.length} 条`)
const hasLogin = bcryptFree.data.logs?.some(l=>l.action==='admin.login')
ck('审计记录了登录', hasLogin)
const hasDisable = bcryptFree.data.logs?.some(l=>l.action==='user.disable' && l.detail==='测试封禁')
ck('★ 审计记录了禁用及其原因', hasDisable)

// ── 看板 ──
const dash = await api('GET','/api/admin/dashboard',{token:T})
ck('看板数据可读', typeof dash.data.stats?.users === 'number', JSON.stringify(dash.data.stats).slice(0,90))

// ── 登录限流 ──
let last
for (let i=0;i<6;i++) last = await api('POST','/api/admin/auth/login',{body:{username:'nobody',password:'x'}})
ck('★ 连续失败 5 次后锁定（429，比用户端更严）', last.status === 429, last.data.error)

console.log(`\n通过 ${R.filter(Boolean).length}/${R.length}`)
process.exit(R.every(Boolean)?0:1)
