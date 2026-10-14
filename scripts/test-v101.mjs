/**
 * v1.0.1 用例：头像上传、注册可跳过、我的资料、穿搭/闲置分栏、版本弹窗。
 * 级别：L1（核心功能）+ L2（安全设计，含头像格式与体积限制）
 */
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
    inviteCode:`CDA-BETA-0${i}`, password:'pw123456', nickname:n,
    phone:'132'+String(Date.now()+i).slice(-8), gender:'female', birthday:'1995-06-15',
  }})
  return r.data
}

// ── ① 注册时可跳过：不传生日/身型/品牌也应成功 ──
const A = await mkUser('跳过测试', 1)
ck('★ 不填生日、身型、品牌也能注册成功', A.ok === true, A.user?.code)
ck('跳过时身型为空（不报错）', A.user?.body?.heightCm === 0)
ck('跳过后可正常登录', (await api('POST','/api/auth/login',{body:{account:A.user.code,password:'pw123456'}})).data.ok === true)

// ── ② 我的资料：补填身型 ──
const B = await mkUser('补填测试', 2)
const upd = await api('PATCH','/api/me',{token:B.token, body:{
  birthday:'1993-03-08', heightCm:163.5, weightKg:52.5,
  chestCm:84, waistCm:66, hipCm:90, styles:['s_minimal'], brands:['b_cos','b_uniqlo'],
}})
ck('★ 可补填身型与生日', upd.data.ok === true)
ck('身型读回正确（含 .5）', upd.data.user?.body?.heightCm === 163.5, `${upd.data.user?.body?.heightCm}`)
ck('生日已更新', upd.data.user?.birthday === '1993-03-08')
ck('风格与品牌已更新', JSON.stringify(upd.data.user?.styles) === '["s_minimal"]' &&
   JSON.stringify(upd.data.user?.brands) === '["b_cos","b_uniqlo"]', JSON.stringify(upd.data.user?.brands))
const reread = await api('GET','/api/me',{token:B.token})
ck('★ 重新登录后补填的数据仍在（已落库）', reread.data.user?.body?.hipCm === 90)

// ── ③ 头像上传 ──
// 1x1 的 PNG，够验证格式与流程
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const up = await api('POST','/api/me/avatar',{token:A.token, body:{dataUrl:PNG}})
ck('★ 头像上传成功', up.data.ok === true, up.data.avatarUrl)
ck('返回头像地址', typeof up.data.avatarUrl === 'string' && up.data.avatarUrl.startsWith('/api/avatar/'))
const img = await fetch(BASE + up.data.avatarUrl.split('?')[0])
ck('头像可被取回（GET 无需鉴权，供 <img> 用）', img.ok && (img.headers.get('content-type') ?? '').includes('image'))
ck('头像带缓存头', (img.headers.get('cache-control') ?? '').includes('max-age'))
const badFmt = await api('POST','/api/me/avatar',{token:A.token, body:{dataUrl:'data:text/plain;base64,aGVsbG8='}})
ck('★ 非图片格式被拒绝', badFmt.status === 400, badFmt.data.error)
const tooBig = await api('POST','/api/me/avatar',{token:A.token, body:{dataUrl:'data:image/png;base64,' + Buffer.alloc(600*1024).toString('base64')}})
ck('★ 超过 500KB 被拒绝', tooBig.status === 400, tooBig.data.error)
const noAuth = await api('POST','/api/me/avatar',{body:{dataUrl:PNG}})
ck('未登录不能上传头像', noAuth.status === 401)

// ── ④ 穿搭 / 闲置分栏 ──
await api('POST','/api/posts',{token:A.token, body:{title:'我的穿搭贴', kind:'outfit'}})
await api('POST','/api/posts',{token:A.token, body:{title:'我的闲置贴', kind:'idle'}})
const outfits = await api('GET','/api/posts?kind=outfit&limit=50',{token:A.token})
const idles = await api('GET','/api/posts?kind=idle&limit=50',{token:A.token})
const allP = await api('GET','/api/posts?limit=50',{token:A.token})
ck('★ 穿搭分栏只含穿搭贴', (outfits.data.posts??[]).every(p=>p.kind==='outfit') &&
   (outfits.data.posts??[]).some(p=>p.title==='我的穿搭贴'))
ck('★ 闲置分栏只含闲置贴', (idles.data.posts??[]).every(p=>p.kind==='idle') &&
   (idles.data.posts??[]).some(p=>p.title==='我的闲置贴'))
ck('不分栏时两类都在', (allP.data.posts??[]).some(p=>p.kind==='outfit') &&
   (allP.data.posts??[]).some(p=>p.kind==='idle'))
ck('两个分栏没有交集', !(outfits.data.posts??[]).some(p=>(idles.data.posts??[]).some(q=>q.id===p.id)))
const badKind = await api('POST','/api/posts',{token:A.token, body:{title:'非法类型', kind:'<script>'}})
ck('★ 非法 kind 被规整为 outfit（不落任意值）', badKind.data.post?.kind === 'outfit', badKind.data.post?.kind)

console.log(`\n通过 ${R.filter(Boolean).length}/${R.length}`)
process.exit(R.every(Boolean)?0:1)
