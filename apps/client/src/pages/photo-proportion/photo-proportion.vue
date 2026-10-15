<template>
  <view class="page">
    <view class="head">
      <text class="title">从照片估算比例</text>
      <text class="sub">拍一张全身照，自动填好身高比例，不用一个个量</text>
      <!--
        期望管理必须在拍照之前说清（放在结果区等于让用户先误会再纠正），
        而「不测三围」是这张图能力边界里最容易被误解的一条。
      -->
      <view class="scope">
        <text class="scope-t">这张照片能估：肩宽、躯干长、四肢长度</text>
        <text class="scope-s">
          不能测三围。单张正面照看不到身体厚度，硬猜会把你估胖或估瘦一到两个尺码。
          围度仍由身高体重推算，可在「我的人偶」里继续微调。
        </text>
      </view>
    </view>

    <!-- 隐私说明放在最前：全身照比头像敏感，用户有权先知道照片去哪了 -->
    <view class="privacy">
      <text class="pv-t">照片不会上传</text>
      <text class="pv-s">
        全部识别在你的手机/浏览器里完成。我们只保存算出来的比例数字，
        原图和识别中间结果都不会离开你的设备，也不会写进服务器。
      </text>
    </view>

    <!-- 第一步：身高 -->
    <text class="group">1 · 你的真实身高</text>
    <text class="hint">
      照片只能给出比例，必须有真实身高才能换算成厘米。这也是唯一必须填的数字。
    </text>
    <view class="row">
      <input
        v-model="heightText"
        class="inp"
        type="digit"
        :placeholder="`${range.min}–${range.max}`"
        placeholder-class="ph"
      />
      <text class="unit">cm</text>
    </view>
    <text v-if="heightError" class="err">{{ heightError }}</text>

    <!-- 第二步：拍摄要求 -->
    <text class="group">2 · 按这个要求拍</text>
    <view class="tips">
      <text v-for="t in shootTips" :key="t" class="tip">· {{ t }}</text>
    </view>

    <!-- 第三步：选图 -->
    <text class="group">3 · 选照片</text>
    <view class="pickers">
      <view class="pick" @click="pickPhoto('camera')"><text>拍照</text></view>
      <view class="pick ghost" @click="pickPhoto('album')"><text>从相册选</text></view>
    </view>

    <view v-if="preview" class="preview">
      <image class="preview-img" :src="preview" mode="widthFix" />
      <text class="redo" @click="reset">换一张</text>
    </view>

    <!-- 状态 -->
    <view v-if="busy" class="busy">
      <text class="busy-t">{{ busyText }}</text>
      <text class="busy-s">首次使用需要加载识别模型（约 6MB），之后会缓存</text>
    </view>

    <text v-if="fatal" class="fatal">{{ fatal }}</text>

    <!-- 质量问题 -->
    <view v-if="issues.length" class="issues">
      <view v-for="(q, i) in issues" :key="i" class="issue" :class="q.severity">
        <text class="iq-mark">{{ q.severity === 'block' ? '✕' : '!' }}</text>
        <text class="iq-text">{{ q.message }}</text>
      </view>
    </view>

    <!-- 结果 -->
    <template v-if="result && !blocked">
      <text class="group">4 · 估算结果</text>
      <text class="hint">
        置信度高的可以直接用；低的建议自己核对。
        这里只改比例，围度仍由身高体重推算。
      </text>

      <view class="table">
        <view v-for="f in rows" :key="f.key" class="trow">
          <text class="tc-name">{{ f.label }}</text>
          <text class="tc-val">{{ f.clampedCm }}<text class="tc-unit">cm</text></text>
          <view class="tc-conf">
            <view class="bar"><view class="bar-in" :style="{ width: pct(f.confidence), background: confColor(f.confidence) }" /></view>
            <text class="cc-text">{{ confText(f.confidence) }}</text>
          </view>
          <text v-if="f.clamped" class="tc-warn">已按模型范围调整</text>
        </view>
        <view v-if="!rows.length" class="tempty"><text>没能测出任何比例</text></view>
      </view>

      <text class="summary">综合可信度 {{ Math.round(result.confidence * 100) }}%</text>

      <view class="apply" :class="{ dis: !rows.length }" @click="apply">
        <text>{{ applying ? '应用中…' : '应用到人偶' }}</text>
      </view>
      <text class="apply-note">
        只修改人偶的比例（肩宽、躯干、四肢长度）。体脂与围度保持不变，
        之后仍可在「我的人偶」里手动微调。
      </text>
    </template>

    <view v-if="applied" class="done">
      <text class="done-t">已应用</text>
      <text class="done-s">回到「我的人偶」即可看到更新后的比例</text>
      <view class="done-btn" @click="goPersona"><text>去看人偶</text></view>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * 照片比例估算页（PoC，开发分支）。
 *
 * 设计要点：
 *   1. **照片不出设备** —— 推理在浏览器里跑，只把算出来的数字写进本地状态。
 *      全身照比头像敏感，这一点必须在 UI 上明说，而不是藏在协议里。
 *   2. **先给身高** —— 没有绝对尺度就没有厘米，这是唯一的必填项。
 *   3. **只改比例，不猜围度** —— 单张正面照看不到厚度，硬猜围度等于伪造数据。
 *   4. **低置信字段不覆盖原值** —— 宁可少改，不可改错。
 *   5. 推理库**动态加载** —— 不让 6MB 模型拖累其它页面的首屏。
 */
import { computed, onMounted, ref } from 'vue'
import {
  HEIGHT_RANGE, applyBodyProportionEstimate, estimateBodyProportion,
  hasBlockingIssue, type FrameKey, type ProportionResult, type QualityIssue,
} from '@cda/core'
/*
 * ⚠️ 必须**静态导入**，不能用 `await import('@mediapipe/tasks-vision')`。
 *
 * uni-app 的 H5 构建处理「对依赖的动态 import」时会生成畸形的 chunk 路径
 * （实测得到 `..-node_modules-@mediapipe-tasks-vision-vision_bundle.xxxx.js`
 * 这种无法解析的模块说明符），页面一跑就报
 * 「Failed to resolve module specifier」，真机上直接不可用。
 *
 * 代价很小：MediaPipe 的 JS 包装只有约 330KB，
 * 真正大的 30MB 是运行时才去取的 WASM 与模型文件 ——
 * 那部分无论静态还是动态导入都一样。
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { store, commitBodyState, restoreBodyState } from '@/store/app-store'

const FACING = ['正面', '侧面'] as const

const shootTips = [
  '全身都要拍到，头顶和脚底不要被裁掉',
  '正对镜头站直，不要侧身或低头',
  '手臂稍微离开身体，不要贴着大腿',
  '穿贴身衣物（外套、长裙会影响判断）',
  '手机放在腰部高度，保持垂直，别用广角',
  '背景尽量干净，画面里只站你一个人',
]

const gender = computed(() => store.bodyState.gender)
const range = computed(() => HEIGHT_RANGE[gender.value])
const heightText = ref('')
const preview = ref('')
const busy = ref(false)
const busyText = ref('')
const fatal = ref('')
const result = ref<ProportionResult | null>(null)
const applying = ref(false)
const applied = ref(false)

const issues = computed<QualityIssue[]>(() => result.value?.quality ?? [])
const blocked = computed(() => (result.value ? hasBlockingIssue(result.value) : false))

const LABEL: Record<FrameKey, string> = {
  shoulderWidthCm: '肩宽',
  neckLengthCm: '颈长',
  torsoLengthCm: '躯干长',
  upperArmCm: '大臂长',
  forearmCm: '小臂长',
  thighCm: '大腿长',
  calfCm: '小腿长',
}

/** 置信度低于这个值的字段不展示为「可用」，也不写入人偶 */
const MIN_CONF = 0.5

const rows = computed(() =>
  (result.value?.frames ?? [])
    .filter((f) => f.confidence >= MIN_CONF)
    .map((f) => ({ ...f, label: LABEL[f.key] })),
)

const heightError = computed(() => {
  const t = heightText.value.trim()
  if (!t) return ''
  const v = Number(t)
  if (!Number.isFinite(v)) return '请输入数字'
  const r = range.value
  if (v < r.min || v > r.max) return `当前人偶支持 ${r.min}–${r.max}cm`
  return ''
})

function pct(c: number): string {
  return `${Math.round(c * 100)}%`
}
function confText(c: number): string {
  return c >= 0.75 ? '高' : c >= MIN_CONF ? '中' : '低'
}
function confColor(c: number): string {
  return c >= 0.75 ? '#4a9d4a' : c >= MIN_CONF ? '#d9a441' : '#c0504d'
}

function reset(): void {
  preview.value = ''
  result.value = null
  fatal.value = ''
  applied.value = false
}

function pickPhoto(source: 'camera' | 'album'): void {
  if (heightError.value) {
    uni.showToast({ title: '请先填写正确的身高', icon: 'none' })
    return
  }
  reset()
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: [source],
    success: (r) => {
      const path = (r.tempFilePaths as string[])[0]
      if (path) {
        preview.value = path
        void analyse(path)
      }
    },
  })
}

let landmarker: any = null

async function ensureLandmarker(): Promise<any> {
  if (landmarker) return landmarker
  busyText.value = '正在加载识别模型…'
  // 同源加载 WASM 与模型，不依赖任何第三方 CDN
  const fileset = await FilesetResolver.forVisionTasks('/static/vision')
  landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/static/vision/pose_landmarker_lite.task' },
    runningMode: 'IMAGE',
    numPoses: 2, // 故意允许 2：多人才好识别出来并拒绝，而不是静默只取一个
    outputSegmentationMasks: true,
  })
  return landmarker
}

/** 把本地路径读成 <img>，供 MediaPipe 与画布使用 */
function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片读取失败'))
    img.src = path
  })
}

/** 从分割掩膜求人体外接框（归一化）。拿不到就返回 undefined，退回关键点外推 */
function maskBounds(mask: any): { top: number; bottom: number; left: number; right: number } | undefined {
  try {
    const w = mask.width as number
    const h = mask.height as number
    const data = mask.getAsFloat32Array() as Float32Array
    if (!w || !h || !data?.length) return undefined
    let top = h, bottom = -1, left = w, right = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[y * w + x]! > 0.5) {
          if (y < top) top = y
          if (y > bottom) bottom = y
          if (x < left) left = x
          if (x > right) right = x
        }
      }
    }
    if (bottom < 0) return undefined
    return { top: top / h, bottom: bottom / h, left: left / w, right: right / w }
  } catch {
    return undefined
  }
}

async function analyse(path: string): Promise<void> {
  busy.value = true
  try {
    const img = await loadImage(path)
    busyText.value = '正在识别…'
    const lm = await ensureLandmarker()
    const raw = lm.detect(img)

    const poses: any[][] = raw?.landmarks ?? []
    const flat = poses[0] ?? []
    const bounds = raw?.segmentationMasks?.[0] ? maskBounds(raw.segmentationMasks[0]) : undefined

    const est = estimateBodyProportion({
      landmarks: flat.map((p: any) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })),
      personCount: poses.length,
      aspect: img.naturalWidth / Math.max(1, img.naturalHeight),
      heightCm: Number(heightText.value),
      gender: gender.value,
      bounds,
    })
    result.value = est
    if (hasBlockingIssue(est)) {
      fatal.value = ''
    }
  } catch (e) {
    /*
     * 失败要明确报出来，**绝不降级成"按图片哈希生成一个看起来合理的结果"**。
     * 那会让用户以为测准了，从而基于假数据做人偶 —— 比直接报错有害得多。
     */
    fatal.value = `识别失败：${(e as Error).message}。若提示模型加载失败，请先运行 node scripts/fetch-vision-assets.mjs`
  } finally {
    busy.value = false
  }
}

function apply(): void {
  const r = result.value
  if (!r || applying.value || !rows.value.length) return
  applying.value = true
  const report = applyBodyProportionEstimate(store.bodyState, r, { minConfidence: MIN_CONF })
  commitBodyState(report.state)
  applying.value = false
  applied.value = true
  uni.showToast({ title: `已更新 ${report.applied.length} 项`, icon: 'none' })
}

function goPersona(): void {
  uni.reLaunch({ url: '/pages/persona/persona' })
}

onMounted(() => {
  restoreBodyState()
  // 身高默认取用户资料里填过的，其次取人偶当前值
  const fromUser = store.user?.body?.heightCm
  const h = fromUser && fromUser > 0 ? fromUser : store.bodyState.heightCm
  heightText.value = String(h)
  void FACING

  /*
   * ── 自动化验证用注入口 ──
   *
   * 为什么要开这个口子：uni.chooseImage 的文件选择在自动化里驱动不了
   * （CDP 的 setFileInputFiles 不触发它监听的 change，页面内派发 change
   * 也无响应）。而最初的端侧用例因此绕过应用自己的导入路径、
   * 在 page.evaluate 里直接用 CDN 验证 —— **结果漏掉了一个真机必现的 bug**：
   * 动态 import 被 uni-app 构建成畸形 chunk 路径，页面一跑就崩。
   *
   * 所以这里留一个明确的最小注入口：外部若先设置 window.__CDA_DEMO_IMAGE，
   * 就直接拿它跑**与用户操作完全相同的那条分析链路**。
   * 它不影响任何正常流程，也不会在无注入时产生任何行为。
   */
  const injected = (window as unknown as { __CDA_DEMO_IMAGE?: string }).__CDA_DEMO_IMAGE
  if (typeof injected === 'string' && injected) {
    preview.value = injected
    void analyse(injected)
  }
})
</script>

<style scoped>
.page { min-height: 100vh; background: #fbfbfb; padding: 18px 16px 44px; }
.head { margin-bottom: 16px; }
.title { font-size: 20px; font-weight: 700; display: block; }
.sub { font-size: 12px; color: #9a9a9a; display: block; margin-top: 5px; }

.privacy { background: #eef4f8; border-left: 3px solid #4a7fa5; border-radius: 10px; padding: 12px 14px; margin-bottom: 6px; }
.pv-t { font-size: 13px; font-weight: 700; color: #2f5d7c; display: block; }
.pv-s { font-size: 11.5px; color: #4a6f88; line-height: 17px; display: block; margin-top: 4px; }

.scope { margin-top: 12px; background: #fff; border-radius: 11px; padding: 12px 14px; }
.scope-t { display: block; font-size: 12.5px; font-weight: 600; color: #333; }
.scope-s { display: block; font-size: 11px; color: #8a8a8a; line-height: 16px; margin-top: 5px; }
.group { display: block; font-size: 13px; font-weight: 700; color: #222; margin: 20px 0 8px; }
.hint { display: block; font-size: 11px; color: #9a9a9a; line-height: 16px; margin-bottom: 8px; }
.row { display: flex; align-items: center; gap: 8px; }
.inp { flex: 1; height: 44px; background: #fff; border-radius: 11px; padding: 0 14px; font-size: 16px; box-sizing: border-box; }
.unit { font-size: 13px; color: #8a8a8a; }
.ph { color: #b8b8b8; }
.err { display: block; font-size: 11.5px; color: #c0504d; margin-top: 6px; }

.tips { background: #fff; border-radius: 12px; padding: 12px 14px; }
.tip { display: block; font-size: 11.5px; color: #666; line-height: 19px; }

.pickers { display: flex; gap: 10px; }
.pick { flex: 1; height: 46px; border-radius: 12px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.pick.ghost { background: #f0f0f0; }
.pick.ghost text { color: #444; }
.pick text { color: #fff; font-size: 14px; font-weight: 600; }

.preview { margin-top: 14px; }
.preview-img { width: 100%; border-radius: 12px; background: #eee; }
.redo { display: block; text-align: center; font-size: 12.5px; color: #4a7fa5; margin-top: 8px; }

.busy { margin-top: 16px; background: #fff; border-radius: 12px; padding: 14px; }
.busy-t { font-size: 13.5px; font-weight: 600; display: block; }
.busy-s { font-size: 11px; color: #9a9a9a; display: block; margin-top: 5px; line-height: 16px; }

.fatal { display: block; margin-top: 14px; font-size: 12.5px; color: #c0504d; line-height: 18px; background: #fdecec; border-radius: 10px; padding: 12px; }

.issues { margin-top: 14px; }
.issue { display: flex; gap: 8px; align-items: flex-start; border-radius: 10px; padding: 11px 12px; margin-bottom: 8px; }
.issue.warn { background: #fdf6e8; }
.issue.block { background: #fdecec; }
.iq-mark { font-size: 13px; font-weight: 700; line-height: 17px; }
.issue.warn .iq-mark { color: #b08040; }
.issue.block .iq-mark { color: #c0504d; }
.iq-text { flex: 1; font-size: 12px; line-height: 17px; color: #6a5a40; }
.issue.block .iq-text { color: #8a3b38; }

.table { background: #fff; border-radius: 12px; overflow: hidden; }
.trow { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #f4f6f8; flex-wrap: wrap; }
.trow:last-child { border-bottom: none; }
.tc-name { width: 52px; font-size: 13px; color: #333; flex-shrink: 0; }
.tc-val { width: 74px; font-size: 16px; font-weight: 700; flex-shrink: 0; }
.tc-unit { font-size: 10px; font-weight: 400; color: #9a9a9a; margin-left: 2px; }
.tc-conf { flex: 1; min-width: 90px; display: flex; align-items: center; gap: 6px; }
.bar { flex: 1; height: 5px; background: #eee; border-radius: 3px; overflow: hidden; }
.bar-in { height: 100%; border-radius: 3px; }
.cc-text { font-size: 10.5px; color: #9a9a9a; width: 16px; }
.tc-warn { width: 100%; font-size: 10px; color: #b08040; }
.tempty { padding: 30px 0; text-align: center; }
.tempty text { font-size: 12.5px; color: #b0b0b0; }

.summary { display: block; text-align: right; font-size: 11.5px; color: #8a8a8a; margin-top: 10px; }

.apply { margin-top: 18px; height: 48px; border-radius: 12px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.apply.dis { background: #cfcfcf; }
.apply text { color: #fff; font-size: 15px; font-weight: 600; }
.apply-note { display: block; font-size: 10.5px; color: #a8a8a8; line-height: 16px; margin-top: 10px; text-align: center; }

.done { margin-top: 20px; background: #eef7ee; border-radius: 12px; padding: 18px; text-align: center; }
.done-t { font-size: 15px; font-weight: 700; color: #3d7a3d; display: block; }
.done-s { font-size: 11.5px; color: #5a8a5a; display: block; margin-top: 6px; }
.done-btn { margin-top: 14px; height: 42px; border-radius: 11px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.done-btn text { color: #fff; font-size: 14px; font-weight: 600; }
</style>
