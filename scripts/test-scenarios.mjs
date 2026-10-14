/** L4 多状态转换复杂场景：状态流转、级联、并发、一致性 */
const BASE = process.env.CDA_API ?? 'http://127.0.0.1:8787'
const R=[]; const ck=(l,c,x='')=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}${x?'  '+x:''}`)}
async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { 'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(()=>({})) }
}
const stamp = Date.now().toString().slice(-6)
async function mkUser(n, i) {
  const r = await api('POST','/api/auth/register',{body:{
    inviteCode:`CDA-BETA-${String(i).padStart(2,'0')}`, password:'pw123456',
    nickname:n, phone:'139'+String(Date.now()+i).slice(-8), gender:'female', birthday:'1995-06-15',
  }})
  return r.data
}
const A = await mkUser('场景甲', 1)
const B = await mkUser('场景乙', 2)
const C = await mkUser('场景丙', 3)

// ── 场景 1：拉黑后的完整行为链 ──
await api('POST',`/api/users/${B.user.code}/follow`,{token:A.token})
const beforeMsg = await api('POST',`/api/conversations/${A.user.code}/messages`,{token:B.token, body:{text:'拉黑前可以发'}})
ck('拉黑前：乙能关注甲、能给甲发消息', beforeMsg.data.ok === true)

await api('POST',`/api/users/${B.user.code}/block`,{token:A.token})
const afterFollow = await api('GET',`/api/users/${B.user.code}`,{token:A.token})
const afterMsg = await api('POST',`/api/conversations/${A.user.code}/messages`,{token:B.token, body:{text:'拉黑后'}})
const bFollowA = await api('POST',`/api/users/${A.user.code}/follow`,{token:B.token})
ck('★ 拉黑后：乙无法给甲发消息', afterMsg.status === 403)
ck('★ 拉黑后：乙无法关注甲', bFollowA.status === 403)
ck('★ 拉黑会解除双方的关注关系', afterFollow.data.followers === 0, `粉丝 ${afterFollow.data.followers}`)
const unblock = await api('POST',`/api/users/${B.user.code}/unblock`,{token:A.token})
const afterUnblock = await api('POST',`/api/conversations/${A.user.code}/messages`,{token:B.token, body:{text:'解除后'}})
ck('★ 解除拉黑后恢复可发消息', afterUnblock.data.ok === true)

// ── 场景 2：隐私设置切换后可见性变化 ──
const s1 = await api('GET',`/api/users?q=场景丙`,{token:A.token})
ck('默认可被搜到', (s1.data.users??[]).some(u=>u.code===C.user.code))
await api('PATCH','/api/me',{token:C.token, body:{privacy:{hideFromSearch:true,hideOnlineStatus:false,hideRegion:false,allowStrangerMessage:true}}})
const s2 = await api('GET',`/api/users?q=场景丙`,{token:A.token})
ck('★ 开启「不被搜索到」后搜不到', !(s2.data.users??[]).some(u=>u.code===C.user.code))
await api('PATCH','/api/me',{token:C.token, body:{privacy:{hideFromSearch:false,hideOnlineStatus:false,hideRegion:false,allowStrangerMessage:true}}})
const s3 = await api('GET',`/api/users?q=场景丙`,{token:A.token})
ck('★ 关闭后又能搜到（可逆）', (s3.data.users??[]).some(u=>u.code===C.user.code))

// ── 场景 3：邀请码一次性 + 并发注册 ──
const code = 'CDA-BETA-10'
const [r1, r2] = await Promise.all([
  api('POST','/api/auth/register',{body:{inviteCode:code,password:'pw123456',nickname:'并发一',phone:'137'+stamp+'1',gender:'male',birthday:'1995-01-01'}}),
  api('POST','/api/auth/register',{body:{inviteCode:code,password:'pw123456',nickname:'并发二',phone:'137'+stamp+'2',gender:'male',birthday:'1995-01-01'}}),
])
const okCount = [r1,r2].filter(r=>r.data.ok).length
ck('★ 同一邀请码并发注册只成功一次', okCount <= 1, `成功 ${okCount} 次`)

// ── 场景 4：禁用 → 启用 → 再登录的状态流转 ──
const admin = await api('POST','/api/admin/auth/login',{body:{username:process.env.CDA_ADMIN_USER??'admin',password:process.env.CDA_ADMIN_PASS??'AdminTest123456'}})
const AT = admin.data.token
ck('管理员可登录', !!AT)

const login0 = await api('POST','/api/auth/login',{body:{account:A.user.code, password:'pw123456'}})
ck('禁用前：能登录', login0.data.ok === true)

await api('PATCH',`/api/admin/users/${C.user.code}`,{token:AT, body:{status:'disabled', reason:'场景测试'}})
const loginDisabled = await api('POST','/api/auth/login',{body:{account:C.user.code, password:'pw123456'}})
ck('★ 禁用后：登录被拒绝', loginDisabled.status === 403, loginDisabled.data.error)
const tokenStillWorks = await api('GET','/api/me',{token:C.token})
ck('★ 禁用后：他原有的 token 立即失效', tokenStillWorks.status === 401)

await api('PATCH',`/api/admin/users/${C.user.code}`,{token:AT, body:{status:'active', reason:'恢复'}})
const loginBack = await api('POST','/api/auth/login',{body:{account:C.user.code, password:'pw123456'}})
ck('★ 启用后：可重新登录（状态可逆）', loginBack.data.ok === true)
// ⚠️ 禁用时旧 token 已被作废，后续操作必须用重登拿到的新 token
C.token = loginBack.data.token

// ── 场景 5：重复点赞/收藏的幂等性 ──
const post = await api('POST','/api/posts',{token:A.token, body:{title:'幂等测试帖'}})
const pid = post.data.post.id
const l1 = await api('POST',`/api/posts/${pid}/like`,{token:B.token})
const l2 = await api('POST',`/api/posts/${pid}/like`,{token:B.token})
ck('★ 重复点赞是切换而非累加', l1.data.liked === true && l2.data.liked === false, `likes ${l1.data.likes}→${l2.data.likes}`)
const f1 = await api('POST',`/api/posts/${pid}/favorite`,{token:B.token})
const favs1 = await api('GET','/api/me/favorites',{token:B.token})
await api('POST',`/api/posts/${pid}/favorite`,{token:B.token})
const favs2 = await api('GET','/api/me/favorites',{token:B.token})
ck('★ 重复收藏不会产生两条记录',
   (favs1.data.posts??[]).filter(p=>p.id===pid).length === 1 &&
   (favs2.data.posts??[]).filter(p=>p.id===pid).length === 0,
   `收藏后 ${(favs1.data.posts??[]).length} 条 → 取消后 ${(favs2.data.posts??[]).length} 条`)

// ── 场景 6：一对人只应有一条会话 ──
await api('POST',`/api/conversations/${B.user.code}/messages`,{token:A.token, body:{text:'甲→乙'}})
await api('POST',`/api/conversations/${A.user.code}/messages`,{token:B.token, body:{text:'乙→甲'}})
const convA = await api('GET','/api/conversations',{token:A.token})
const withB = (convA.data.conversations??[]).filter(c=>c.peer?.code===B.user.code)
ck('★ A→B 与 B→A 只产生一条会话（不分裂）', withB.length === 1, `${withB.length} 条`)
const msgs = await api('GET',`/api/conversations/${B.user.code}/messages`,{token:A.token})
ck('★ 双向消息在同一个会话里', (msgs.data.messages??[]).length >= 2, `${(msgs.data.messages??[]).length} 条`)

// ── 场景 7：删号后关联数据一并清理 ──
const p = await api('POST','/api/posts',{token:C.token, body:{title:'待清理帖子'}})
await api('POST','/api/posts',{token:C.token, body:{title:'待清理2'}})
const feedBefore = await api('GET','/api/posts?limit=50',{token:A.token})
const hasC = (feedBefore.data.posts??[]).some(x=>x.authorCode===C.user.code)
ck('删号前：能看到该用户的帖子', hasC)
await api('DELETE',`/api/admin/users/${C.user.code}`,{token:AT, body:{reason:'场景测试清理'}})
const feedAfter = await api('GET','/api/posts?limit=50',{token:A.token})
const stillC = (feedAfter.data.posts??[]).some(x=>x.authorCode===C.user.code)
ck('★ 删号后：其帖子被级联清理（不留悬空）', !stillC)
const cLogin = await api('POST','/api/auth/login',{body:{account:C.user.code, password:'pw123456'}})
ck('★ 删号后：无法再登录', cLogin.status === 401)

console.log(`\n通过 ${R.filter(Boolean).length}/${R.length}`)
process.exit(R.every(Boolean)?0:1)
