#!/usr/bin/env node
/**
 * 测试运行器。
 *
 *   node tests/run.mjs                     跑全部（L0→L4 顺序）
 *   node tests/run.mjs --level L0,L1       只跑指定级别
 *   node tests/run.mjs --module 注册        只跑指定模块（模糊匹配）
 *   node tests/run.mjs --impact auth,api    **按影响点跑**（改完代码最常用）
 *   node tests/run.mjs --list              只列出会跑哪些，不执行
 *   node tests/run.mjs --smoke             只跑 L0（改完先快速确认没砸）
 *
 * 设计取舍：
 *   - 每个测试文件是独立的 node 脚本，通过**退出码**表示成败，
 *     这样它们也能单独手动跑，不依赖这套运行器
 *   - runner 负责：起后端、托管前端、按需重置数据库、汇总结果
 *   - 需要浏览器的用例复用同一个 Chrome 实例（启动一次约 3 秒，
 *     每个用例都启一次会很慢）
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TESTS, LEVELS, testsForImpacts, testsForLevels } from './manifest.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * 用 TypeScript 写测试时不能直接 node 跑：
 * Node 的类型擦除能处理语法，但**解析不了无扩展名的导入**
 * （core 包内部大量 `from './types'`），会报 ERR_MODULE_NOT_FOUND。
 * 所以 .ts 测试先用 esbuild 打成单文件再执行 —— 这样测试代码可以用
 * 类型、可以 import 工作区源码，而运行器对 .mjs 的行为完全不变。
 */
let ESBUILD = null
function findEsbuild() {
  if (ESBUILD !== null) return ESBUILD
  try {
    const r = spawnSync('bash', ['-c',
      'find node_modules/.pnpm -maxdepth 5 -type f -name esbuild -path "*bin*" 2>/dev/null | head -1'],
      { cwd: ROOT, encoding: 'utf8' })
    ESBUILD = (r.stdout ?? '').trim() || false
  } catch {
    ESBUILD = false
  }
  return ESBUILD
}

/** .ts → 临时 .mjs；.mjs 原样返回 */
function prepareScript(file) {
  if (!file.endsWith('.ts')) return file
  const esb = findEsbuild()
  if (!esb) throw new Error('找不到 esbuild，无法运行 TypeScript 测试')
  const out = join(tmpdir(), `cda-test-${file.replace(/[^a-zA-Z0-9]/g, '_')}.mjs`)
  const r = spawnSync(esb, [file, '--bundle', '--format=esm', '--platform=node',
    `--outfile=${out}`, '--log-level=error'], { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`打包失败：${(r.stderr ?? '').slice(0, 300)}`)
  }
  return out
}
const PORT = Number(process.env.CDA_PORT ?? 8899)
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_USER = 'admin'
const ADMIN_PASS = 'AdminTest123456'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => {
  const i = argv.indexOf(n)
  return i >= 0 ? (argv[i + 1] ?? '') : ''
}

const C = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m',
  red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m',
}
const log = (s = '') => console.log(s)

// ── 选出要跑的用例 ──
let selected = TESTS
if (opt('--impact')) selected = testsForImpacts(opt('--impact').split(',').map((s) => s.trim()).filter(Boolean))
else if (opt('--level')) selected = testsForLevels(opt('--level').split(',').map((s) => s.trim()).filter(Boolean))
else if (opt('--module')) {
  const kw = opt('--module')
  selected = TESTS.filter((t) => t.module.includes(kw))
}
if (flag('--smoke')) selected = TESTS.filter((t) => t.level === 'L0')

// 按级别排序，L0 先跑（快速失败）
selected = [...selected].sort((a, b) => a.level.localeCompare(b.level))

if (!selected.length) {
  log(`${C.yellow}没有匹配的用例${C.reset}`)
  process.exit(0)
}

log(`${C.bold}CDA 测试${C.reset}  ${C.dim}共 ${selected.length} 个用例文件${C.reset}`)
log()
for (const lv of ['L0', 'L1', 'L2', 'L3', 'L4']) {
  const g = selected.filter((t) => t.level === lv)
  if (!g.length) continue
  log(`  ${C.cyan}${lv}${C.reset} ${LEVELS[lv].name}  ${C.dim}${LEVELS[lv].desc}${C.reset}`)
  for (const t of g) log(`     ${C.dim}·${C.reset} ${t.module.padEnd(10)} ${t.file}`)
}
log()

if (flag('--list')) process.exit(0)

// ── 起后端（需要 api / browser 用例时）──
const hasServerTests = selected.some((t) => t.runner === 'api' || t.runner === 'browser')
let server = null

async function waitHealth(ms = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return true
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

/**
 * 重置数据库并重启后端。
 *
 * ⚠️ **每个用例文件跑之前都要调一次。**
 * 起初是整套起一次服务，结果「单跑全过、全跑全挂」——
 * 因为邀请码是一次性的，第一个用例用掉 CDA-BETA-01 后，
 * 后面的用例全部注册失败。这不是代码问题，是测试互相污染。
 * 隔离的代价是每个文件多约 2 秒启动时间，完全值得。
 */
async function restartServer() {
  stopServer()
  await new Promise((r) => setTimeout(r, 300))
  const dataDir = join(ROOT, 'apps/server/data')
  rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })

  const webDir = join(ROOT, 'apps/client/dist/build/h5')
  if (!existsSync(join(webDir, 'index.html'))) {
    log(`${C.yellow}前端未构建，先 build…${C.reset}`)
    spawnSync('./node_modules/.bin/uni', ['build'], { cwd: join(ROOT, 'apps/client'), stdio: 'ignore' })
  }

  server = spawn('node', ['--experimental-strip-types', 'src/index.ts'], {
    cwd: join(ROOT, 'apps/server'),
    env: {
      ...process.env,
      CDA_PORT: String(PORT),
      CDA_DB: './data/test.db',
      CDA_WEB: '../client/dist/build/h5',
      CDA_ADMIN_USER: ADMIN_USER,
      CDA_ADMIN_PASS: ADMIN_PASS,
      /*
       * 各测试脚本历史上用了不同的邀请码格式，运行器要**全部供给**，
       * 否则会因「邀请码无效」大面积失败 —— 而这看起来像功能坏了，
       * 实际只是测试数据没对齐。
       */
      CDA_INVITES: [
        ...Array.from({ length: 32 }, (_, i) => `CDA-BETA-${String(i + 1).padStart(2, '0')}`),
        ...Array.from({ length: 8 }, (_, i) => `BETA-00${i + 1}`),
        ...Array.from({ length: 8 }, (_, i) => `E2E-00${i + 1}`),
      ].join(','),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', () => {})
  server.stderr.on('data', () => {})

  if (!(await waitHealth())) {
    log(`${C.red}后端启动失败${C.reset}`)
    stopServer()
    return false
  }
  return true
}

function stopServer() {
  if (server && !server.killed) {
    server.kill('SIGKILL')
    server = null
  }
  // 保险：按端口兜底清理（相对路径启动的进程 pgrep 匹配不到）
  spawnSync('bash', ['-c', `for p in $(lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t 2>/dev/null); do kill -9 $p 2>/dev/null; done`])
}

// ── 跑 ──
const results = []

async function main() {

  for (const t of selected) {
    const label = `${t.level} ${t.module}`
    process.stdout.write(`${C.bold}${label.padEnd(16)}${C.reset} ${C.dim}${t.file}${C.reset}\n`)
    // 每个用例都用全新的库，避免邀请码/手机号被前一个用例消耗掉
    if (t.runner === 'api' || t.runner === 'browser') {
      const okStart = await restartServer()
      if (!okStart) {
        results.push({ t, pass: false, ms: 0, sum: '后端启动失败' })
        log(`   ${C.red}✗ 后端启动失败${C.reset}\n`)
        continue
      }
    }
    const t0 = Date.now()
    let script
    try {
      script = prepareScript(t.file)
    } catch (e) {
      log(`   ${C.red}✗ ${e.message}${C.reset}\n`)
      results.push({ t, pass: false, ms: 0, sum: '打包失败' })
      continue
    }
    const r = spawnSync('node', [script], {
      cwd: ROOT,
      env: { ...process.env, CDA_API: BASE, CDA_BASE: BASE, CDA_ADMIN_USER: ADMIN_USER, CDA_ADMIN_PASS: ADMIN_PASS },
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
    })
    const ms = Date.now() - t0
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`

    /*
     * 成败判定：**不能只看退出码**。
     * 有些测试文件没写 process.exit，断言失败了也返回 0 ——
     * 结果是明细里明明有 ❌，汇总却显示「全部通过」。
     * 所以同时解析用例自己打印的「通过 X/Y」汇总行，
     * 只要 X < Y 就判失败；退出码非 0 也判失败。
     */
    const sumLine = out.split('\n').find((l) => /通过 \d+\/\d+/.test(l))
    const m = sumLine?.match(/通过 (\d+)\/(\d+)/)
    const bySummary = m ? Number(m[1]) === Number(m[2]) : null
    const hasFailMark = /❌/.test(out)
    const pass = r.status === 0 && bySummary !== false && !hasFailMark

    // 打印用例自身的断言明细（缩进一层，便于扫读）
    for (const line of out.split('\n')) {
      if (/[✅❌]/.test(line)) log(`   ${line.trim()}`)
    }
    // 汇总行单独抓出来
    results.push({ t, pass, ms, sum: sumLine?.trim() ?? '' })
    log(`   ${pass ? C.green + '✓ 通过' : C.red + '✗ 失败'}${C.reset} ${C.dim}${(ms / 1000).toFixed(1)}s${C.reset}  ${sumLine?.trim() ?? ''}`)
    log()
  }
}

main()
  .then(() => {
    stopServer()
    const ok = results.filter((r) => r.pass).length
    log(`${C.bold}════ 汇总 ════${C.reset}`)
    for (const lv of ['L0', 'L1', 'L2', 'L3', 'L4']) {
      const g = results.filter((r) => r.t.level === lv)
      if (!g.length) continue
      const p = g.filter((r) => r.pass).length
      const color = p === g.length ? C.green : C.red
      log(`  ${lv} ${LEVELS[lv].name}  ${color}${p}/${g.length}${C.reset}`)
    }
    log()
    if (ok === results.length) {
      log(`${C.green}${C.bold}全部通过（${ok}/${results.length}）${C.reset}`)
      process.exit(0)
    }
    log(`${C.red}${C.bold}失败 ${results.length - ok} 个${C.reset}`)
    for (const r of results.filter((x) => !x.pass)) log(`  ${C.red}✗${C.reset} ${r.t.level} ${r.t.module}  ${r.t.file}`)
    process.exit(1)
  })
  .catch((e) => {
    stopServer()
    console.error(e)
    process.exit(1)
  })
