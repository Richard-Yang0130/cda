/** 后端 API 端到端自测：重点是**跨用户数据是否真的互通** */
const BASE = process.env.CDA_API ?? 'http://127.0.0.1:8787'
const R=[]; const ck=(l,c,extra='')=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}${extra?'  '+extra:''}`)}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
// 手机号必须 11 位（1 开头 + 10 位），这里取时间戳后 8 位补足
const stamp = Date.now().toString().slice(-6)
const phoneA = '138' + Date.now().toString().slice(-8)
const phoneB = '137' + Date.now().toString().slice(-8)

// ── 注册：邀请码 ──
const badInvite = await api('POST','/api/auth/register',{body:{inviteCode:'WRONG',password:'pw123456',nickname:'格式测试',phone:'13900000001'}})
ck('无效邀请码被拒绝', badInvite.status === 403, badInvite.data.error)

const a = await api('POST','/api/auth/register',{body:{
  inviteCode:'BETA-001', password:'pw123456', nickname:'阿林', phone:phoneA,
  gender:'female', birthday:'1995-06-15', styles:['s_minimal'], brands:['b_cos','b_uniqlo'],
  privacy:{hideFromSearch:false,hideOnlineStatus:false,hideRegion:false,allowStrangerMessage:true},
}})
ck('用户A 注册成功', a.data.ok === true, a.data.user?.code)
const tokenA = a.data.token, codeA = a.data.user?.code

const badPhone = await api('POST','/api/auth/register',{body:{password:'pw123456',nickname:'格式测试',phone:'12345'}})
ck('注册时非法手机号被拒绝', badPhone.status === 400, badPhone.data.error)

const reuse = await api('POST','/api/auth/register',{body:{inviteCode:'BETA-001',password:'pw123456',nickname:'重复邀请码测试',phone:'13900000009'}})
ck('已用过的邀请码不能再用', reuse.status === 403, reuse.data.error)

const b = await api('POST','/api/auth/register',{body:{
  inviteCode:'BETA-002', password:'pw123456', nickname:'阿泽', phone:phoneB,
  gender:'male', styles:['s_sport'], brands:['b_nike'],
}})
ck('用户B 注册成功', b.data.ok === true, b.data.user?.code)
const tokenB = b.data.token, codeB = b.data.user?.code
ck('两个用户码不同且格式正确', codeA !== codeB && /^CDA_\d{8}$/.test(codeA), `${codeA} / ${codeB}`)

// ── 登录 ──
const login = await api('POST','/api/auth/login',{body:{account:phoneA, password:'pw123456'}})
ck('用手机号登录成功', login.data.ok === true)
const wrong = await api('POST','/api/auth/login',{body:{account:phoneA, password:'wrongpw'}})
ck('错误密码被拒绝', wrong.status === 401)

// ── 未授权访问 ──
const noAuth = await api('GET','/api/me')
ck('无 token 访问受保护接口被拒', noAuth.status === 401)

// ── 发帖 + 跨用户可见（这是要后端的核心理由）──
const post = await api('POST','/api/posts',{token:tokenA, body:{
  title:`后端联调帖 ${stamp}`, coverHex:'#8fa3b0', tags:['叠穿'], ratio:1.2, linkedProductId:'p_denim_jacket',
}})
ck('用户A 发帖成功', post.data.ok === true, post.data.post?.id)
const postId = post.data.post?.id

const feedB = await api('GET','/api/posts',{token:tokenB})
const seenByB = (feedB.data.posts ?? []).some(p => p.id === postId)
ck('★ 用户B 能看到用户A 发的帖（跨用户互通）', seenByB)
const withAuthor = (feedB.data.posts ?? []).find(p => p.id === postId)
ck('帖子带上了作者昵称', withAuthor?.author === '阿林', withAuthor?.author)

const detail = await api('GET',`/api/posts/${postId}`,{token:tokenB})
ck('用户B 能打开帖子详情', detail.data.post?.id === postId)

// ── 点赞是每用户独立的 ──
const like1 = await api('POST',`/api/posts/${postId}/like`,{token:tokenB})
const like2 = await api('POST',`/api/posts/${postId}/like`,{token:tokenB})
ck('B 点赞后取消（计数回到原值）', like1.data.liked === true && like2.data.liked === false)

// ── 私聊：真正的跨用户 ──
const send = await api('POST',`/api/conversations/${codeA}/messages`,{token:tokenB, body:{text:`你好，我是阿泽 ${stamp}`}})
ck('B 给 A 发消息成功', send.data.ok === true)
const inboxA = await api('GET','/api/conversations',{token:tokenA})
const conv = (inboxA.data.conversations ?? [])[0]
ck('★ A 的会话列表里出现了 B', !!conv && conv.peer?.code === codeB, conv?.peer?.nickname)
ck('会话带未读数', conv?.unread >= 1, `unread=${conv?.unread}`)
const msgs = await api('GET',`/api/conversations/${codeB}/messages`,{token:tokenA})
ck('★ A 能读到 B 发来的消息', (msgs.data.messages ?? []).some(m => m.text.includes(stamp)))
ck('消息方向正确（fromMe=false）', msgs.data.messages?.[0]?.fromMe === false)
const after = await api('GET','/api/conversations',{token:tokenA})
ck('读完后未读清零', (after.data.conversations ?? [])[0]?.unread === 0)

// ── 关注 / 拉黑 ──
await api('POST',`/api/users/${codeA}/follow`,{token:tokenB})
const uA = await api('GET',`/api/users/${codeA}`,{token:tokenB})
ck('B 关注 A 后 isFollowing=true', uA.data.isFollowing === true, `粉丝 ${uA.data.followers}`)
const following = await api('GET','/api/me/following',{token:tokenB})
ck('B 的关注列表里有 A', (following.data.users ?? []).some(u => u.code === codeA))
await api('POST',`/api/users/${codeA}/block`,{token:tokenB})
const blockedSend = await api('POST',`/api/conversations/${codeB}/messages`,{token:tokenA, body:{text:'还能发吗'}})
ck('被拉黑后无法发消息', blockedSend.status === 403, blockedSend.data.error)

// ── 用户搜索 + 隐私 ──
const search = await api('GET',`/api/users?q=${encodeURIComponent('阿林')}`,{token:tokenB})
ck('按昵称搜索到 A', (search.data.users ?? []).some(u => u.code === codeA))
const searchByCode = await api('GET',`/api/users?q=${codeA}`,{token:tokenB})
ck('按用户码搜索到 A', (searchByCode.data.users ?? []).some(u => u.code === codeA))
await api('PATCH','/api/me',{token:tokenA, body:{privacy:{hideFromSearch:true,hideOnlineStatus:false,hideRegion:false,allowStrangerMessage:true}}})
const hidden = await api('GET',`/api/users?q=${encodeURIComponent('阿林')}`,{token:tokenB})
ck('开启「不被搜索到」后搜不到', !(hidden.data.users ?? []).some(u => u.code === codeA))

// ── 地址 ──
const addr = await api('POST','/api/addresses',{token:tokenA, body:{
  name:'阿林', phone:phoneA, province:'广东省', city:'深圳市', district:'南山区',
  detail:'科技园路 1 号', isDefault:true, tag:'公司',
}})
ck('新增收货地址成功', (addr.data.addresses ?? []).length === 1)
const badAddr = await api('POST','/api/addresses',{token:tokenA, body:{name:'X', phone:'123', province:'粤', detail:'aaa'}})
ck('非法手机号的地址被拒绝', badAddr.status === 400, badAddr.data.error)

// ── 衣橱 + 收藏 + 浏览历史 ──
await api('POST','/api/wardrobe',{token:tokenA, body:{productId:'p_denim_jacket', colorId:'c1', size:'M'}})
const wd = await api('GET','/api/wardrobe',{token:tokenA})
ck('衣橱写入并读回', (wd.data.items ?? []).some(i => i.productId === 'p_denim_jacket'))
await api('POST',`/api/posts/${postId}/favorite`,{token:tokenB})
const favs = await api('GET','/api/me/favorites',{token:tokenB})
ck('收藏列表有该帖', (favs.data.posts ?? []).some(p => p.id === postId))
const hist = await api('GET','/api/me/history',{token:tokenB})
ck('浏览历史记录了看过的帖', (hist.data.posts ?? []).some(p => p.id === postId))

// ── 登出 ──
await api('POST','/api/auth/logout',{token:tokenB})
const afterLogout = await api('GET','/api/me',{token:tokenB})
ck('登出后 token 失效', afterLogout.status === 401)

console.log(`\n通过 ${R.filter(Boolean).length}/${R.length}`)
process.exit(R.every(Boolean) ? 0 : 1)
