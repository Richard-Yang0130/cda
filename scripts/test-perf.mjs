/** L3 性能体验：接口耗时、分页、静态资源、数据体积 */
const BASE = process.env.CDA_API ?? 'http://127.0.0.1:8787'
const R=[]; const ck=(l,c,x='')=>{R.push(c);console.log(`${c?'✅':'❌'} ${l}${x?'  '+x:''}`)}
async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method, headers: { 'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(()=>({})) }
}
async function timed(fn) { const t=Date.now(); const r=await fn(); return { ms: Date.now()-t, r } }

// 造点数据：注册几个用户并发帖
const tokens = []
for (let i = 1; i <= 5; i++) {
  const r = await api('POST','/api/auth/register',{body:{
    inviteCode:`CDA-BETA-${String(i).padStart(2,'0')}`, password:'pw123456',
    nickname:`性能${i}`, phone:'138'+String(Date.now()+i).slice(-8), gender:'female', birthday:'1995-06-15',
  }})
  if (r.data.token) tokens.push(r.data.token)
}
ck('批量注册 5 个用户', tokens.length === 5, `${tokens.length} 个`)

for (const t of tokens) {
  for (let j = 0; j < 4; j++) await api('POST','/api/posts',{token:t, body:{ title:`性能测试帖 ${j}`, coverHex:'#ccc' }})
}
const T = tokens[0]

// ── 接口耗时 ──
const health = await timed(() => api('GET','/api/health'))
ck('健康检查 < 200ms', health.ms < 200, `${health.ms}ms`)

const list = await timed(() => api('GET','/api/posts?limit=20',{token:T}))
ck('帖子列表 < 500ms', list.ms < 500, `${list.ms}ms`)

const search = await timed(() => api('GET','/api/users?q=性能',{token:T}))
ck('用户搜索 < 500ms', search.ms < 500, `${search.ms}ms`)

// ── 分页正确性 ──
const p1 = await api('GET','/api/posts?limit=5&offset=0',{token:T})
const p2 = await api('GET','/api/posts?limit=5&offset=5',{token:T})
ck('分页返回指定条数', (p1.data.posts??[]).length === 5, `${(p1.data.posts??[]).length} 条`)
const ids1 = new Set((p1.data.posts??[]).map(p=>p.id))
const overlap = (p2.data.posts??[]).filter(p=>ids1.has(p.id)).length
ck('★ 两页之间没有重复项', overlap === 0, `重复 ${overlap} 个`)
ck('hasMore 字段存在', typeof p1.data.hasMore === 'boolean')
const big = await api('GET','/api/posts?limit=9999',{token:T})
ck('★ limit 被限制在 50 以内（防拉全表）', (big.data.posts??[]).length <= 50, `${(big.data.posts??[]).length} 条`)

// ── 数据体积 ──
const all = await api('GET','/api/posts?limit=50',{token:T})
const bytes = JSON.stringify(all.data).length
ck('单页响应 < 100KB（10 人规模足够）', bytes < 100*1024, `${(bytes/1024).toFixed(1)}KB`)

// ── 静态资源压缩 ──
try {
  const r = await fetch(`${BASE.replace(/\/api$/,'')}/static/models/female.obj`, { headers: { 'accept-encoding':'gzip' } })
  const raw = 877262
  const got = Number(r.headers.get('content-length') ?? 0)
  const enc = r.headers.get('content-encoding') ?? 'none'
  // 本地直连后端时没有 gzip（gzip 在 nginx 上），线上才有
  ck('网格可访问', r.ok, `HTTP ${r.status}  编码 ${enc}  ${got||'?'}B / 原 ${raw}B`)
} catch (e) {
  ck('网格可访问', false, String(e).slice(0,60))
}

console.log(`\n通过 ${R.filter(Boolean).length}/${R.length}`)
process.exit(R.every(Boolean)?0:1)
