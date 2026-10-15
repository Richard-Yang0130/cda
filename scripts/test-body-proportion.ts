/**
 * 照片比例估算的核心算法测试（不含浏览器）。
 *
 * 为什么单独测算法：图像推理只能靠肉眼和真机，但**从关键点到参数的换算**
 * 是纯数学，可以用合成数据穷举验证 —— 这部分的错误才是会让每个人偶都错的。
 *
 * 级别：L1（核心功能）+ L2（边界与拒绝）
 */
import {
  applyBodyProportionEstimate,
  createBodyState,
  deriveProfile,
  estimateBodyProportion,
  hasBlockingIssue,
  FRAME_RANGES,
  HEIGHT_RANGE,
  PROPORTION_ALGO_VERSION,
  type FrameKey,
  type PosePoint,
} from '../packages/core/src/index'

const R: boolean[] = []
const ck = (label: string, pass: boolean, extra = ''): void => {
  R.push(pass)
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`)
}

/**
 * 造一副「标准站姿」的合成关键点。
 *
 * 关键：所有比例都从 heightCm 反推，所以这些点是**按真实人体比例**生成的，
 * 算法算出来的值应当能回到我们设定的真实尺寸 —— 这是端到端的数值自洽检验。
 */
function synthPose(opts: {
  heightCm: number
  /** 像素高度（归一化）。越大表示人离镜头越近 */
  span?: number
  /** 肩宽（cm） */
  shoulderCm?: number
  top?: number
  /** 侧身程度：0 = 正对，越大越侧 */
  yaw?: number
  /** 手臂是否贴身体 */
  armsDown?: boolean
  /** 图片宽高比 width/height，用于把厘米换算到归一化 x */
  aspectScale?: number
}): { lm: PosePoint[]; aspect: number; bounds: { top: number; bottom: number; left: number; right: number } } {
  const span = opts.span ?? 0.9
  const aspect = opts.aspectScale ?? 0.5625
  const top = opts.top ?? 0.05
  const shoulderCm = opts.shoulderCm ?? 40
  const yaw = opts.yaw ?? 0
  const H = opts.heightCm
  // 1cm 对应多少归一化高度
  const u = span / H
  /*
   * ⚠️ 水平方向必须换算：归一化坐标里 x 是「宽度占比」、y 是「高度占比」，
   * 两者尺度不同。同一个 1cm，在 y 方向是 u，在 x 方向是 u/aspect。
   *
   * 这个坑最初就踩了 —— 生成器把 y 方向的量直接写进 x 坐标，
   * 于是「42cm 肩宽」算出来只有 23.6cm。**恰恰证明算法里的 ×aspect 是必需的**，
   * 少了它每个人的肩宽都会算错三成以上。
   */
  const ux = u / aspect
  const y = (cmFromTop: number) => top + cmFromTop * u
  const cx = 0.5

  const lm: PosePoint[] = Array.from({ length: 33 }, () => ({ x: cx, y: 0.5, z: 0, visibility: 1 }))
  const set = (i: number, x: number, yy: number, z = 0, visibility = 1): void => {
    lm[i] = { x, y: yy, z, visibility }
  }

  // 身体各段的解剖位置（占身高比例，成人常用值）
  const headTop = 0
  const eyeCm = 11
  const earCm = 13
  const shoulderCmY = 20
  const hipCmY = 20 + 0.30 * H // 躯干长约 0.30H
  const kneeCmY = H * 0.72
  const ankleCmY = H * 0.96
  const elbowCmY = shoulderCmY + 0.19 * H
  const wristCmY = shoulderCmY + 0.34 * H

  const halfShoulder = (shoulderCm / 2) * ux * (1 - yaw * 0.5)
  const shoulderDepth = yaw * 0.5

  // 耳朵（近似头颈交界）
  set(7, cx - 3.5 * ux, y(earCm), 0)
  set(8, cx + 3.5 * ux, y(earCm), 0)
  set(0, cx, y(eyeCm + 1), 0)

  // 肩
  set(11, cx - halfShoulder, y(shoulderCmY), -shoulderDepth)
  set(12, cx + halfShoulder, y(shoulderCmY), shoulderDepth)

  // 髋（宽度约 0.7 肩宽）
  const halfHip = halfShoulder * 0.7
  set(23, cx - halfHip, y(hipCmY), 0)
  set(24, cx + halfHip, y(hipCmY), 0)

  // 肘 / 腕：手臂放下时贴近身体，张开时向外
  /*
   * 手臂位置用厘米表示再换算成归一化 x。
   * armsDown 时把手腕放到**髋宽以内**，才真的等价于「手臂贴着身体」；
   * 只是「比自然下垂稍微内收」并不算贴身，旧用例就是因此误判的。
   */
  const armOut = (opts.armsDown ? -7 : 12) * ux
  set(13, cx - halfShoulder - armOut, y(elbowCmY), 0)
  set(14, cx + halfShoulder + armOut, y(elbowCmY), 0)
  set(15, cx - halfShoulder - armOut * 1.2, y(wristCmY), 0)
  set(16, cx + halfShoulder + armOut * 1.2, y(wristCmY), 0)

  // 膝 / 踝
  set(25, cx - halfHip * 0.6, y(kneeCmY), 0)
  set(26, cx + halfHip * 0.6, y(kneeCmY), 0)
  set(27, cx - halfHip * 0.6, y(ankleCmY), 0)
  set(28, cx + halfHip * 0.6, y(ankleCmY), 0)
  set(29, cx - halfHip * 0.6, y(ankleCmY + 2), 0)
  set(30, cx + halfHip * 0.6, y(ankleCmY + 2), 0)

  void headTop
  return {
    lm,
    aspect,   // 用已解析的值，不能直接回传 opts.aspectScale（可能是 undefined）
    bounds: { top: y(headTop), bottom: y(H), left: cx - 0.15, right: cx + 0.15 },
  }
}

// ── ① 比例换算的自洽性 ──
{
  const heightCm = 170
  const shoulderCm = 42
  const s = synthPose({ heightCm, shoulderCm })
  const r = estimateBodyProportion({
    landmarks: s.lm, personCount: 1, aspect: s.aspect, heightCm, gender: 'male', bounds: s.bounds,
  })

  ck('能产出估算结果', r.frames.length > 0, `${r.frames.length} 项`)
  ck('算法版本已标注', r.version === PROPORTION_ALGO_VERSION)

  const get = (k: FrameKey) => r.frames.find((f) => f.key === k)
  const sh = get('shoulderWidthCm')
  ck('★ 肩宽估算接近设定值（±8%）',
    !!sh && Math.abs(sh.valueCm - shoulderCm) / shoulderCm < 0.08,
    sh ? `算出 ${sh.valueCm}，设定 ${shoulderCm}` : '缺项')

  const torso = get('torsoLengthCm')
  ck('★ 躯干长接近 0.30×身高',
    !!torso && Math.abs(torso.valueCm - heightCm * 0.30) / (heightCm * 0.30) < 0.1,
    torso ? `算出 ${torso.valueCm}，参考 ${(heightCm * 0.30).toFixed(1)}` : '缺项')

  const thigh = get('thighCm')
  const calf = get('calfCm')
  ck('大腿长 > 小腿长', !!thigh && !!calf && thigh.valueCm > calf.valueCm,
    thigh && calf ? `${thigh.valueCm} vs ${calf.valueCm}` : '缺项')

  const neck = get('neckLengthCm')
  ck('颈长在合理范围（6–15cm）', !!neck && neck.valueCm >= 6 && neck.valueCm <= 15,
    neck ? `${neck.valueCm}` : '缺项')
}

// ── ② 尺度无关性：同一个人远近不同，结果应一致 ──
{
  const near = synthPose({ heightCm: 170, span: 0.95 })
  const far = synthPose({ heightCm: 170, span: 0.6 })
  const a = estimateBodyProportion({ landmarks: near.lm, personCount: 1, aspect: near.aspect, heightCm: 170, gender: 'male', bounds: near.bounds })
  const b = estimateBodyProportion({ landmarks: far.lm, personCount: 1, aspect: far.aspect, heightCm: 170, gender: 'male', bounds: far.bounds })
  const av = (r: typeof a, k: FrameKey) => r.frames.find((f) => f.key === k)?.valueCm ?? 0
  ck('★ 人物远近不影响肩宽估算（尺度无关）',
    Math.abs(av(a, 'shoulderWidthCm') - av(b, 'shoulderWidthCm')) < 1.0,
    `${av(a, 'shoulderWidthCm')} vs ${av(b, 'shoulderWidthCm')}`)
}

// ── ③ 身高不同 → 比例按比例放大 ──
{
  const short = synthPose({ heightCm: 160 })
  const tall = synthPose({ heightCm: 185 })
  const a = estimateBodyProportion({ landmarks: short.lm, personCount: 1, aspect: short.aspect, heightCm: 160, gender: 'male', bounds: short.bounds })
  const b = estimateBodyProportion({ landmarks: tall.lm, personCount: 1, aspect: tall.aspect, heightCm: 185, gender: 'male', bounds: tall.bounds })
  const av = (r: typeof a, k: FrameKey) => r.frames.find((f) => f.key === k)?.valueCm ?? 0
  ck('★ 更高的人躯干长更长', av(b, 'torsoLengthCm') > av(a, 'torsoLengthCm'),
    `${av(a, 'torsoLengthCm')} → ${av(b, 'torsoLengthCm')}`)
}

// ── ④ 拒绝类：必须明确拦住，不能硬算 ──
{
  const s = synthPose({ heightCm: 170 })
  const noPerson = estimateBodyProportion({ landmarks: [], personCount: 0, aspect: s.aspect, heightCm: 170, gender: 'male' })
  ck('★ 没检测到人 → 阻断', hasBlockingIssue(noPerson) && noPerson.frames.length === 0)

  const two = estimateBodyProportion({ landmarks: s.lm, personCount: 2, aspect: s.aspect, heightCm: 170, gender: 'male', bounds: s.bounds })
  ck('★ 画面里多人 → 阻断', hasBlockingIssue(two), two.quality[0]?.message ?? '')

  const tooFar = synthPose({ heightCm: 170, span: 0.4 })
  const far = estimateBodyProportion({ landmarks: tooFar.lm, personCount: 1, aspect: tooFar.aspect, heightCm: 170, gender: 'male', bounds: { top: 0.3, bottom: 0.7, left: 0.3, right: 0.7 } })
  ck('★ 人太小 → 阻断', hasBlockingIssue(far), far.quality.map((q) => q.code).join(','))

  const badHeight = estimateBodyProportion({ landmarks: s.lm, personCount: 1, aspect: s.aspect, heightCm: 150, gender: 'male', bounds: s.bounds })
  ck('★ 身高低于模型区间 → 阻断（不静默夹紧）',
    hasBlockingIssue(badHeight) && badHeight.quality.some((q) => q.code === 'height_out_of_range'))

  const okF = estimateBodyProportion({ landmarks: s.lm, personCount: 1, aspect: s.aspect, heightCm: 160, gender: 'female', bounds: s.bounds })
  ck('女性 160cm 在区间内，可通过', !hasBlockingIssue(okF))
}

// ── ⑤ 告警类：能继续，但要提示 ──
{
  const yawed = synthPose({ heightCm: 170, yaw: 0.9 })
  const r = estimateBodyProportion({ landmarks: yawed.lm, personCount: 1, aspect: yawed.aspect, heightCm: 170, gender: 'male', bounds: yawed.bounds })
  ck('侧身 → 给出告警（非阻断）',
    r.quality.some((q) => q.code === 'not_frontal' && q.severity === 'warn') && !hasBlockingIssue(r),
    r.quality.map((q) => q.code).join(','))

  const armsDown = synthPose({ heightCm: 170, armsDown: true })
  const r2 = estimateBodyProportion({ landmarks: armsDown.lm, personCount: 1, aspect: armsDown.aspect, heightCm: 170, gender: 'male', bounds: armsDown.bounds })
  ck('身体贴着的手臂 → 给出告警', r2.quality.some((q) => q.code === 'arms_not_apart'))
}

// ── ⑥ 夹紧：超出模型区间的估算值要被标出并夹紧 ──
{
  const extreme = synthPose({ heightCm: 195, shoulderCm: 60 })
  const r = estimateBodyProportion({ landmarks: extreme.lm, personCount: 1, aspect: extreme.aspect, heightCm: 195, gender: 'male', bounds: extreme.bounds })
  const sh = r.frames.find((f) => f.key === 'shoulderWidthCm')
  ck('★ 超范围肩宽被夹紧并标记', !!sh && sh.clamped && sh.clampedCm === FRAME_RANGES.shoulderWidthCm.max,
    sh ? `${sh.valueCm} → ${sh.clampedCm} clamped=${sh.clamped}` : '缺项')
  ck('★ 被夹紧的字段置信度被下调', !!sh && sh.confidence < 0.95, sh ? `${sh.confidence}` : '')
}

// ── ⑦ 应用：只改 frame，不动体脂与形体风格 ──
{
  const base = createBodyState('male', 'muscular', 170)
  const before = deriveProfile(base)
  const s = synthPose({ heightCm: 178, shoulderCm: 46 })
  const r = estimateBodyProportion({ landmarks: s.lm, personCount: 1, aspect: s.aspect, heightCm: 178, gender: 'male', bounds: s.bounds })
  const out = applyBodyProportionEstimate(base, r)

  ck('★ 身高已应用', out.state.heightCm === 178, `${out.state.heightCm}`)
  ck('★ 体脂水平未被照片改动（不伪造围度）', out.state.adiposity === base.adiposity,
    `${base.adiposity} → ${out.state.adiposity}`)
  ck('★ 形体风格未被改动', out.state.build === 'muscular', out.state.build)
  ck('应用了部分字段', out.applied.length > 0, out.applied.join(','))
  const after = deriveProfile(out.state)
  ck('围度只因身高缩放而变化，未被照片直接改',
    Math.abs(after.chestCm - before.chestCm) < 40 && after.chestCm > 0,
    `胸围 ${before.chestCm} → ${after.chestCm}`)
}

// ── ⑧ 低置信度字段应被跳过 ──
{
  const base = createBodyState('female', 'average', 160)
  const s = synthPose({ heightCm: 160 })
  // 人为把膝、踝可见度打到 0，小腿应当估不出来
  s.lm[25] = { ...s.lm[25]!, visibility: 0 }
  s.lm[26] = { ...s.lm[26]!, visibility: 0 }
  s.lm[27] = { ...s.lm[27]!, visibility: 0 }
  s.lm[28] = { ...s.lm[28]!, visibility: 0 }
  const r = estimateBodyProportion({ landmarks: s.lm, personCount: 1, aspect: s.aspect, heightCm: 160, gender: 'female', bounds: s.bounds })
  const out = applyBodyProportionEstimate(base, r, { minConfidence: 0.6 })
  const calfKept = out.state.frame.calfCm === base.frame.calfCm
  ck('★ 看不清的小腿保留了原值（不被瞎猜覆盖）', calfKept,
    `原 ${base.frame.calfCm} → 现 ${out.state.frame.calfCm}`)
}

// ── ⑨ 身高区间：应用时不得越界 ──
{
  const base = createBodyState('female', 'average', 160)
  const s = synthPose({ heightCm: 158 })
  const r = estimateBodyProportion({ landmarks: s.lm, personCount: 1, aspect: s.aspect, heightCm: 158, gender: 'female', bounds: s.bounds })
  const out = applyBodyProportionEstimate(base, r)
  const hr = HEIGHT_RANGE.female
  ck('应用后身高仍在模型区间内', out.state.heightCm >= hr.min && out.state.heightCm <= hr.max, `${out.state.heightCm}`)
}

console.log(`\n通过 ${R.filter(Boolean).length}/${R.length}`)
process.exit(R.every(Boolean) ? 0 : 1)
