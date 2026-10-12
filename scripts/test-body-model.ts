/**
 * 人体耦合模型的验证脚本。
 *
 * 要证明的核心命题：拖动**任何一项**，全身按生理规律协同变化，
 * 而不是某一个几何参数单独动。这是「感觉像人在变」而不是「球在胀」的关键。
 *
 * 跑法：
 *   node_modules/.bin/esbuild scripts/test-body-model.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/tbm.mjs && node /tmp/tbm.mjs
 */
import {
  createBodyState, deriveProfile, setGirth, setWeight, setHeight, rangeOf,
  healthMetrics, weightAt, girthAt, type BodyState,
} from '../packages/core/src/body-model'

function snapshot(label: string, s: BodyState) {
  const p = deriveProfile(s)
  const m = healthMetrics(p)
  console.log(
    `${label.padEnd(20)} 体重 ${String(p.weightKg).padStart(5)}  胸 ${p.chestCm}  腰 ${p.waistCm}  ` +
      `臀 ${p.hipCm}  大腿 ${p.thighCircCm}  大臂 ${p.upperArmCircCm}  | ` +
      m.map((x) => `${x.label} ${x.display}(${x.note})`).join(' '),
  )
}

const base = createBodyState('female', 'average')
snapshot('初始 (体脂 0.35)', base)

// ── 命题 1：拖臀围，全身应该一起变 ──
console.log('\n【拖臀围 +8cm】')
const hipUp = setGirth(base, 'hipCm', deriveProfile(base).hipCm + 8)
snapshot('臀围 +8', hipUp)
const before = deriveProfile(base)
const after = deriveProfile(hipUp)
const deltas = {
  体重: +(after.weightKg - before.weightKg).toFixed(1),
  胸围: +(after.chestCm - before.chestCm).toFixed(1),
  腰围: +(after.waistCm - before.waistCm).toFixed(1),
  臀围: +(after.hipCm - before.hipCm).toFixed(1),
  大腿围: +(after.thighCircCm - before.thighCircCm).toFixed(1),
  大臂围: +(after.upperArmCircCm - before.upperArmCircCm).toFixed(1),
}
console.log('  各项变化量:', JSON.stringify(deltas))
const allMoved = Object.entries(deltas).every(([k, v]) => k === '臀围' || Math.abs(v as number) > 0.1)
console.log('  →', allMoved ? '✅ 全身协同变化' : '❌ 仍是单项变化')

// ── 命题 2：拖体重，围度必须一起变（体积不可能不变而体重上升）──
console.log('\n【拖体重 +12kg】')
const heavier = setWeight(base, deriveProfile(base).weightKg + 12)
snapshot('体重 +12', heavier)
const w2 = deriveProfile(heavier)
console.log(
  `  腰围 ${before.waistCm} → ${w2.waistCm}，臀围 ${before.hipCm} → ${w2.hipCm}，` +
    `体重 ${before.weightKg} → ${w2.weightKg}`,
)
console.log('  →', w2.waistCm > before.waistCm && w2.hipCm > before.hipCm
  ? '✅ 体重与体积同步' : '❌ 体重涨了体积没变')

// ── 命题 3：范围是派生的，越界拖不动 ──
console.log('\n【范围随身高重算】')
for (const h of [155, 165, 180]) {
  const s = setHeight(base, h)
  const wr = rangeOf(s, 'weightKg')
  const hip = rangeOf(s, 'hipCm')
  console.log(
    `  身高 ${h}cm → 体重可拖 [${wr.min}, ${wr.max}]kg，臀围可拖 [${hip.min}, ${hip.max}]cm，` +
      `当前 ${weightAt(s)}kg`,
  )
}

// ── 命题 4：超范围输入会被夹紧，而不是产生不存在的体型 ──
console.log('\n【越界输入被夹紧】')
const tooHeavy = setWeight(base, 500)
const tooThin = setWeight(base, 10)
console.log(`  输入 500kg → 实际 ${deriveProfile(tooHeavy).weightKg}kg`)
console.log(`  输入  10kg → 实际 ${deriveProfile(tooThin).weightKg}kg`)

// ── 命题 5：同一围度在男女身上的联动不一样（脂肪分布差异）──
console.log('\n【男性 vs 女性：同样加臀围，腰围变化应不同】')
const m0 = createBodyState('male', 'average')
const f0 = createBodyState('female', 'average')
const mUp = setGirth(m0, 'hipCm', deriveProfile(m0).hipCm + 8)
const fUp = setGirth(f0, 'hipCm', deriveProfile(f0).hipCm + 8)
console.log(`  男性 腰围 ${deriveProfile(m0).waistCm} → ${deriveProfile(mUp).waistCm}`)
console.log(`  女性 腰围 ${deriveProfile(f0).waistCm} → ${deriveProfile(fUp).waistCm}`)

// ── 命题 6：体脂提高时，腰高比应随之上升 ──
console.log('\n【体脂 0 → 1 的腰高比轨迹（应跨过 0.5 健康界值）】')
for (const f of [0, 0.25, 0.5, 0.75, 1]) {
  const s: BodyState = { ...base, adiposity: f }
  const p = deriveProfile(s)
  const whtr = p.waistCm / p.heightCm
  console.log(`  体脂 ${f.toFixed(2)}  腰 ${p.waistCm}cm  BMI ${(p.weightKg / 1.65 ** 2).toFixed(1)}  腰高比 ${whtr.toFixed(3)}`)
}

// ── 参考：某项在各体脂下的取值 ──
console.log('\n【臀围随体脂的变化曲线（女性）】')
console.log('  ' + [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => `${f}:${girthAt(base, 'hipCm', f)}`).join('  '))
