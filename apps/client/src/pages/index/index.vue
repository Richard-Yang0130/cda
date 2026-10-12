<template>
  <view
    class="page"
    @touchmove="onDragMove"
    @touchend="onDragEnd"
    @touchcancel="onDragEnd"
  >
    <!-- ───────────── 头部 ───────────── -->
    <view class="header">
      <view class="brand-row">
        <text class="brand">搭</text>
        <text class="brand-en">CDA</text>
      </view>
      <text class="subtitle">身型 → 人偶 → 拖拽穿搭 → 精细穿法</text>
      <view class="entry-grid">
        <view class="entry-btn" @click="goWardrobe"><text>我的衣橱</text></view>
        <view class="entry-btn" @click="goOutfit"><text>穿搭建议</text></view>
        <view class="entry-btn" @click="goImport"><text>拍照导入</text></view>
        <view class="entry-btn" @click="goTryOn"><text>2D 试穿</text></view>
      </view>
    </view>

    <!-- ───────────── 3D 舞台 ───────────── -->
    <view
      id="tryon-stage"
      class="stage"
      @touchstart="onStageTouchStart"
      @touchmove="onStageTouchMove"
      @touchend="onStageTouchEnd"
      @mousedown="onStageMouseDown"
    >
      <view class="stage-hint">
        <text class="hint-text">{{ stageHint }}</text>
      </view>
      <view class="stage-tools">
        <view class="tool-btn" @click="resetCamera"><text>重置视角</text></view>
        <view class="tool-btn" @click="clearAll"><text>全部脱下</text></view>
      </view>
    </view>

    <!-- ───────────── 身型控制 ───────────── -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">身型数据</text>
        <text class="card-note">拖动人偶可旋转</text>
      </view>

      <text class="group-title">性别</text>
      <view class="gender-row">
        <view
          v-for="g in genders"
          :key="g.value"
          class="gender-chip"
          :class="{ active: body.gender === g.value }"
          @click="setGender(g.value)"
        >
          <text>{{ g.label }}</text>
        </view>
      </view>

      <text class="group-title">形体风格</text>
      <view class="preset-row">
        <view
          v-for="b in builds"
          :key="b.id"
          class="preset-chip"
          :class="{ active: body.build === b.id }"
          @click="setBuild(b.id)"
        >
          <text>{{ b.name }}</text>
        </view>
      </view>
      <text class="preset-desc">{{ activeBuildDesc }}</text>

      <text class="group-title">基础</text>
      <view v-for="m in basicFields" :key="m.key" class="slider-row">
        <text class="slider-label">{{ m.label }}</text>
        <slider
          class="slider"
          :value="body[m.key]"
          :min="m.min"
          :max="m.max"
          :step="1"
          activeColor="#1a1a1a"
          block-color="#1a1a1a"
          :block-size="16"
          @changing="(e: any) => onMeasureChange(m.key, e.detail.value, 'changing')"
          @change="(e: any) => onMeasureChange(m.key, e.detail.value, 'change')"
        />
        <text class="slider-value">{{ body[m.key] }}{{ m.unit }}</text>
      </view>

      <text class="group-title">分区调整</text>
      <view class="stage-row">
        <view
          v-for="s in stages"
          :key="s.id"
          class="stage-chip"
          :class="{ active: activeStage === s.id }"
          @click="activeStage = s.id"
        >
          <text>{{ s.name }}</text>
        </view>
      </view>

      <view v-for="m in stageFields[activeStage]" :key="m.key" class="slider-row">
        <text class="slider-label">{{ m.label }}</text>
        <slider
          class="slider"
          :value="body[m.key]"
          :min="m.min"
          :max="m.max"
          :step="1"
          activeColor="#1a1a1a"
          block-color="#1a1a1a"
          :block-size="16"
          @changing="(e: any) => onMeasureChange(m.key, e.detail.value, 'changing')"
          @change="(e: any) => onMeasureChange(m.key, e.detail.value, 'change')"
        />
        <text class="slider-value">{{ body[m.key] }}{{ m.unit }}</text>
      </view>

      <view class="normalize-hint">
        <text>各段相加 {{ segmentSum }}cm · 身高 {{ body.heightCm }}cm · 引擎会按比例归一</text>
      </view>
    </view>

    <!-- ───────────── 我的衣橱 ───────────── -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">我的衣橱</text>
        <text class="card-note">按住拖到人偶上，或直接点击</text>
      </view>

      <view class="wardrobe">
        <view
          v-for="item in wardrobeView"
          :key="item.id"
          class="wardrobe-item"
          :class="{ worn: isWorn(item.productId) }"
          @touchstart="onItemTouchStart($event, item)"
          @click="onItemClick(item)"
        >
          <view class="swatch" :style="{ backgroundColor: item.colorHex }" />
          <text class="item-title">{{ item.product?.title }}</text>
          <text class="item-tag">{{ slotLabel(item.product?.category) }}</text>
          <text v-if="isWorn(item.productId)" class="worn-badge">已穿</text>
        </view>
      </view>
    </view>

    <!-- ───────────── 精细穿法 ───────────── -->
    <view v-if="selectedGarment" class="card">
      <view class="card-head">
        <text class="card-title">{{ selectedProductTitle }}</text>
        <view class="tool-btn small" @click="takeOff(selectedGarment)"><text>脱下</text></view>
      </view>

      <!-- 穿法 -->
      <text class="field-label">穿法</text>
      <view class="mode-row">
        <view
          v-for="mode in selectedModes"
          :key="mode"
          class="mode-chip"
          :class="{ active: currentMode === mode }"
          @click="setMode(mode)"
        >
          <text>{{ modeLabel(mode) }}</text>
        </view>
      </view>

      <!-- 扣子 -->
      <view v-if="fastenerTotal > 0" class="fastener">
        <view class="fastener-head">
          <text class="field-label">扣子</text>
          <text class="fastener-value">{{ fastenerClosed }} / {{ fastenerTotal }} 颗</text>
        </view>
        <slider
          :value="fastenerClosed"
          :min="0"
          :max="fastenerTotal"
          :step="1"
          activeColor="#1a1a1a"
          block-color="#1a1a1a"
          :block-size="16"
          @changing="(e: any) => setFastener(e.detail.value)"
          @change="(e: any) => setFastener(e.detail.value)"
        />
        <text class="fastener-hint">
          {{ fastenerClosed === fastenerTotal ? '全部扣上' : fastenerClosed === 0 ? '完全敞开' : `敞开 ${fastenerTotal - fastenerClosed} 颗` }}
        </text>
      </view>
    </view>

    <view class="footnote">
      <text>3D 人偶为程序化生成，服装采用分层刚性贴合 + 解析变形</text>
      <text>非真实布料物理 —— 这是业界当前可工程化的边界</text>
    </view>

    <!-- 拖拽跟随的幽灵元素 -->
    <view
      v-if="dragging"
      class="ghost"
      :style="{ left: ghostX + 'px', top: ghostY + 'px' }"
    >
      <text>{{ draggingTitle }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, nextTick, ref, reactive, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { findProduct, defaultBodyProfile, BODY_BUILDS, CATEGORY_LABEL, type BodyBuildId, type Category, type WearMode } from '@cda/core'
import { TryonEngine, createH5Platform, WEAR_MODE_LABEL, GARMENT_REGISTRY } from '@cda/tryon-engine'
import { mountStage, type StageHost } from '@/platform/stage'
import { store } from '@/store/app-store'

// ───────────────────────────── 状态

let engine: TryonEngine | null = null
let stage: StageHost | null = null

const stageHint = ref('按住可旋转人偶')

/** 身型数据（与 store 共用同一份对象，改动会同步到穿搭建议页） */
const body = reactive({ ...store.body })

/** 滑杆分组配置。key 直接对应 BodyProfile 的数字字段 */
type NumericKey =
  | 'heightCm' | 'weightKg' | 'shoulderWidthCm'
  | 'chestCm' | 'waistCm' | 'hipCm' | 'upperArmCircCm' | 'thighCircCm'
  | 'torsoLengthCm' | 'neckLengthCm' | 'upperArmCm' | 'forearmCm' | 'thighCm' | 'calfCm'

interface MeasureField {
  key: NumericKey
  label: string
  unit: string
  min: number
  max: number
}

/** 分区建模：按游戏捏人的习惯分段，而不是一次给一长条滑杆 */
type StageId = 'head' | 'upper' | 'lower'

const stages: Array<{ id: StageId; name: string }> = [
  { id: 'head', name: '头颈' },
  { id: 'upper', name: '上半身' },
  { id: 'lower', name: '下半身' },
]

const activeStage = ref<StageId>('upper')

/** 基础数据不分阶段，始终显示 */
const basicFields: MeasureField[] = [
  { key: 'heightCm', label: '身高', unit: 'cm', min: 145, max: 205 },
  { key: 'weightKg', label: '体重', unit: 'kg', min: 35, max: 130 },
]

/** 各阶段的可调参数 */
const stageFields: Record<StageId, MeasureField[]> = {
  head: [{ key: 'neckLengthCm', label: '颈长', unit: 'cm', min: 5, max: 18 }],
  upper: [
    { key: 'shoulderWidthCm', label: '肩宽', unit: 'cm', min: 32, max: 56 },
    { key: 'chestCm', label: '胸围', unit: 'cm', min: 68, max: 130 },
    { key: 'waistCm', label: '腰围', unit: 'cm', min: 50, max: 130 },
    { key: 'torsoLengthCm', label: '上身长', unit: 'cm', min: 34, max: 62 },
    { key: 'upperArmCircCm', label: '大臂围', unit: 'cm', min: 20, max: 45 },
    { key: 'upperArmCm', label: '大臂长', unit: 'cm', min: 22, max: 42 },
    { key: 'forearmCm', label: '小臂长', unit: 'cm', min: 18, max: 34 },
  ],
  lower: [
    { key: 'hipCm', label: '臀围', unit: 'cm', min: 72, max: 140 },
    { key: 'thighCircCm', label: '大腿围', unit: 'cm', min: 38, max: 80 },
    { key: 'thighCm', label: '大腿长', unit: 'cm', min: 34, max: 60 },
    { key: 'calfCm', label: '小腿长', unit: 'cm', min: 28, max: 52 },
  ],
}

const genders = [
  { value: 'female' as const, label: '女性' },
  { value: 'male' as const, label: '男性' },
]

/** 形体风格：定「偏肌肉还是偏脂肪」，具体维度仍由上面的数据决定 */
const builds = BODY_BUILDS
const activeBuildDesc = computed(
  () => builds.find((b) => b.id === body.build)?.description ?? '',
)

/**
 * 各分段之和 vs 身高。
 * 用户填的数据常常不自洽，引擎会自动按比例归一 —— 这里把它显示出来，
 * 避免用户以为是自己填错了。
 */
const segmentSum = computed(() => {
  const headApprox = body.heightCm * 0.13
  const ankleApprox = body.heightCm * 0.045
  return Math.round(
    headApprox + ankleApprox +
    body.calfCm + body.thighCm + body.torsoLengthCm + body.neckLengthCm,
  )
})

const worn = ref<string[]>([])
const selectedGarment = ref<string | null>(null)

const dragging = ref(false)
const draggingTitle = ref('')
const ghostX = ref(0)
const ghostY = ref(0)
let draggingProductId: string | null = null

// ───────────────────────────── 派生数据

const wardrobeView = computed(() =>
  store.wardrobe.map((w) => {
    const product = findProduct(w.productId)
    const color = product?.colors.find((c) => c.id === w.colorId)
    return {
      id: w.id,
      productId: w.productId,
      product,
      colorHex: color?.hex ?? '#cccccc',
    }
  }),
)

const selectedProductTitle = computed(() => {
  if (!selectedGarment.value) return ''
  return findProduct(selectedGarment.value)?.title ?? selectedGarment.value
})

const selectedModes = computed<WearMode[]>(() => {
  if (!selectedGarment.value) return []
  return GARMENT_REGISTRY[selectedGarment.value]?.allowedModes ?? []
})

const currentMode = ref<WearMode>('worn')
const fastenerTotal = computed(() => GARMENT_REGISTRY[selectedGarment.value ?? '']?.fastenerTotal ?? 0)
const fastenerClosed = ref(0)

// ───────────────────────────── 生命周期

onMounted(async () => {
  await nextTick()
  // 给布局一帧时间，确保容器尺寸可测
  setTimeout(initEngine, 60)
})

onBeforeUnmount(() => {
  engine?.dispose()
  stage?.dispose()
})

function initEngine() {
  try {
    stage = mountStage('tryon-stage')
  } catch (err) {
    stageHint.value = `舞台初始化失败：${String(err)}`
    return
  }

  engine = new TryonEngine({
    platform: createH5Platform(),
    canvas: stage.canvas,
    width: stage.width,
    height: stage.height,
    bodyProfile: currentProfile(),
  })

  stage.onResize((w, h) => engine?.resize(w, h))
  engine.start()
  stageHint.value = '按住可旋转人偶'
  applyPoseFromQuery()
  applyPendingOutfit()
}

/**
 * 调试 / 截图用姿势预设：`?pose=all|open|drape|scarf`
 * 快速把 demo 摆到某个状态，便于回归对比与出图。仅 H5 生效。
 */
function applyPoseFromQuery() {
  // #ifdef H5
  if (typeof window === 'undefined' || !engine) return
  const pose = new URLSearchParams(window.location.search).get('pose')
  if (!pose) return

  const ALL = ['p_white_shirt', 'p_denim_jacket', 'p_wide_trousers', 'p_knit_scarf']

  if (pose === 'all' || pose === 'open' || pose === 'drape') {
    for (const id of ALL) wear(id)
  }

  if (pose === 'open') {
    engine.setWearMode('p_denim_jacket', 'open')
    engine.setFastenerClosed('p_denim_jacket', 1)
    selectGarment('p_denim_jacket')
  } else if (pose === 'drape') {
    engine.setWearMode('p_white_shirt', 'draped')
    selectGarment('p_white_shirt')
  } else if (pose === 'scarf') {
    wear('p_knit_scarf')
    engine.setWearMode('p_knit_scarf', 'wrapped')
    selectGarment('p_knit_scarf')
  } else if (pose === 'all') {
    selectGarment('p_white_shirt')
  }

  syncPanelFromEngine()
  // #endif
}

function currentProfile() {
  // body 已经是完整 BodyProfile，直接浅拷贝给引擎
  return { ...body }
}

// ───────────────────────────── 身型

/**
 * 拖动过程中的重算合并到下一帧。
 * 每收到一次 changing 就重建一次会拖死主线程 —— 人体网格是多边形化出来的，
 * 单次重建几十毫秒，必须限流。
 */
let previewScheduled = false

function schedulePreview() {
  if (previewScheduled) return
  previewScheduled = true
  const run = () => {
    previewScheduled = false
    engine?.setBodyProfile({ ...body }, 'preview')
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

/**
 * @param phase 'changing' = 拖动中（低精度预览）；'change' = 松手（全精度重建）
 */
function onMeasureChange(key: string, value: number, phase: 'changing' | 'change' = 'change') {
  const target = body as unknown as Record<string, number>
  target[key] = value
  Object.assign(store.body, body)

  if (phase === 'changing') {
    schedulePreview()
    return
  }
  engine?.setBodyProfile({ ...body }, 'final')
}

/** 切换性别：套用对应的默认数据，保留形体风格 */
function setGender(gender: 'male' | 'female') {
  if (body.gender === gender) return
  const next = defaultBodyProfile(gender)
  next.build = body.build
  next.heightCm = body.heightCm
  Object.assign(body, next)
  Object.assign(store.body, body)
  engine?.setBodyProfile({ ...body }, 'final')
}

/**
 * 切换形体风格。
 * 它只改变形体语言（肌肉隆起、脂肪堆积），**不改任何尺寸数字** ——
 * 尺寸是用户自己的身体数据。
 */
function setBuild(id: BodyBuildId) {
  if (body.build === id) return
  body.build = id
  Object.assign(store.body, body)
  engine?.setBodyProfile({ ...body }, 'final')
}

// ───────────────────────────── 穿脱

function isWorn(productId: string) {
  return worn.value.includes(productId)
}

function wear(productId: string) {
  if (!engine) return
  // 单件单品出问题不应该让整条链路中断（曾经因为围巾的一个 bug
  // 导致后续所有逻辑静默失效，排查了很久）
  try {
    const product = findProduct(productId)
    // 把成衣实测尺寸交给引擎 —— 衣长、袖长、面料厚度都由它推导
    const g = engine.addGarment(productId, undefined, product?.dimensions)
    if (!g) {
      stageHint.value = '该单品暂无 3D 描述'
      return
    }
    if (!worn.value.includes(productId)) worn.value.push(productId)
    selectGarment(productId)
  } catch (err) {
    console.error('[CDA] 穿上单品失败:', productId, err)
    stageHint.value = `「${findProduct(productId)?.title ?? productId}」渲染失败`
  }
}

function takeOff(productId: string) {
  engine?.removeGarment(productId)
  worn.value = worn.value.filter((id) => id !== productId)
  if (selectedGarment.value === productId) {
    selectedGarment.value = worn.value[0] ?? null
    syncPanelFromEngine()
  }
}

function clearAll() {
  engine?.clearGarments()
  worn.value = []
  selectedGarment.value = null
}

function selectGarment(productId: string) {
  selectedGarment.value = productId
  syncPanelFromEngine()
}

function syncPanelFromEngine() {
  if (!selectedGarment.value || !engine) return
  const g = engine.getGarment(selectedGarment.value)
  if (!g) return
  currentMode.value = g.wearMode
  fastenerClosed.value = g.fastenerClosed
}

// ───────────────────────────── 穿法 / 扣子

function setMode(mode: WearMode) {
  if (!selectedGarment.value) return
  engine?.setWearMode(selectedGarment.value, mode)
  currentMode.value = mode
}

function setFastener(n: number) {
  if (!selectedGarment.value) return
  engine?.setFastenerClosed(selectedGarment.value, n)
  fastenerClosed.value = Math.round(n)
}

function modeLabel(mode: WearMode) {
  return WEAR_MODE_LABEL[mode] ?? mode
}

function slotLabel(category?: Category) {
  return category ? CATEGORY_LABEL[category] : ''
}

// ───────────────────────────── 舞台相机交互

let lastStagePoint: { x: number; y: number } | null = null

function onStageTouchStart(e: any) {
  const t = e.touches?.[0]
  if (!t) return
  lastStagePoint = { x: t.clientX, y: t.clientY }
}

function onStageTouchMove(e: any) {
  if (dragging.value) return
  const t = e.touches?.[0]
  if (!t || !lastStagePoint) return
  engine?.orbit(t.clientX - lastStagePoint.x, t.clientY - lastStagePoint.y)
  lastStagePoint = { x: t.clientX, y: t.clientY }
}

function onStageTouchEnd() {
  lastStagePoint = null
}

function onStageMouseDown(e: any) {
  // 桌面端：按住拖动旋转
  const startX = e.clientX as number
  const startY = e.clientY as number
  let px = startX
  let py = startY

  const move = (ev: MouseEvent) => {
    engine?.orbit(ev.clientX - px, ev.clientY - py)
    px = ev.clientX
    py = ev.clientY
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

function resetCamera() {
  engine?.resetCamera()
}

function goTryOn() {
  uni.navigateTo({ url: '/pages/tryon/tryon' })
}

function goWardrobe() {
  uni.navigateTo({ url: '/pages/wardrobe/wardrobe' })
}

function goOutfit() {
  uni.navigateTo({ url: '/pages/outfit/outfit' })
}

function goImport() {
  uni.navigateTo({ url: '/pages/import/import' })
}

/**
 * 消费「穿搭建议」页写入的 pendingOutfit。
 * uni-app 的 onShow 会早于引擎初始化触发，所以引擎未就绪时不能清空标记，
 * 留到 initEngine 之后再消费。
 */
function applyPendingOutfit() {
  if (!engine || !store.pendingOutfit) return
  clearAll()
  for (const productId of store.pendingOutfit) wear(productId)
  store.pendingOutfit = null
}

onShow(() => {
  applyPendingOutfit()
})

// ───────────────────────────── 拖拽穿单品

function onItemTouchStart(e: any, item: { productId: string; product?: { title: string } }) {
  const t = e.touches?.[0]
  if (!t) return
  dragging.value = true
  draggingProductId = item.productId
  draggingTitle.value = item.product?.title ?? ''
  ghostX.value = t.clientX
  ghostY.value = t.clientY
}

function onDragMove(e: any) {
  if (!dragging.value) return
  const t = e.touches?.[0]
  if (!t) return
  ghostX.value = t.clientX
  ghostY.value = t.clientY
}

function onDragEnd(e: any) {
  if (!dragging.value) return
  const t = e.changedTouches?.[0] ?? e.touches?.[0]
  dragging.value = false

  if (t && stage) {
    const r = stage.getRect()
    const inside =
      t.clientX >= r.left && t.clientX <= r.left + r.width && t.clientY >= r.top && t.clientY <= r.top + r.height
    if (inside && draggingProductId) {
      wear(draggingProductId)
      draggingProductId = null
      return
    }
  }
  draggingProductId = null
}

function onItemClick(item: { productId: string }) {
  // 点击直接穿上（触摸设备上比拖拽更省力）
  if (isWorn(item.productId)) selectGarment(item.productId)
  else wear(item.productId)
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 48px 16px 40px;
  box-sizing: border-box;
  background: #f5f5f7;
}

/* ---------- 头部 ---------- */
.header {
  margin-bottom: 18px;
  padding: 0 4px;
}
.brand-row {
  display: flex;
  align-items: baseline;
}
.brand {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 6px;
}
.brand-en {
  font-size: 12px;
  letter-spacing: 5px;
  color: #9a9a9a;
  margin-left: 10px;
}
.subtitle {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: #8a8a8a;
}
.entry-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.entry-btn {
  width: calc(50% - 4px);
  box-sizing: border-box;
  padding: 9px 0;
  border-radius: 999px;
  background: #1a1a1a;
  text-align: center;
}
.entry-btn text {
  font-size: 12px;
  color: #ffffff;
}

/* ---------- 3D 舞台 ---------- */
.stage {
  position: relative;
  width: 100%;
  height: 46vh;
  min-height: 320px;
  border-radius: 20px;
  overflow: hidden;
  /* 刻意用较深的暖灰：白色单品在浅背景上会「消失」，深一档才有对比 */
  background: linear-gradient(170deg, #cfc9c2 0%, #bdb6ae 55%, #a9a29a 100%);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.1);
}
.stage-hint {
  position: absolute;
  left: 14px;
  top: 12px;
  z-index: 2;
}
.hint-text {
  font-size: 11px;
  color: #5d574f;
}
.stage-tools {
  position: absolute;
  right: 12px;
  top: 10px;
  z-index: 2;
  display: flex;
  gap: 8px;
}
.tool-btn {
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  font-size: 11px;
  color: #444;
}
.tool-btn.small {
  padding: 4px 10px;
}

/* ---------- 卡片 ---------- */
.card {
  margin-top: 14px;
  background: #ffffff;
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.05);
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
}
.card-note {
  font-size: 11px;
  color: #a0a0a0;
}

/* ---------- 滑杆 ---------- */
.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.preset-chip {
  padding: 6px 12px;
  border-radius: 999px;
  background: #f2f2f2;
}
.preset-chip text {
  font-size: 12px;
  color: #555;
}
.preset-chip.active {
  background: #1a1a1a;
}
.preset-chip.active text {
  color: #ffffff;
}
.preset-desc {
  display: block;
  font-size: 10.5px;
  color: #a8a8a8;
  line-height: 16px;
  margin-bottom: 14px;
}

.gender-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.gender-chip {
  flex: 1;
  height: 36px;
  border-radius: 10px;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gender-chip text {
  font-size: 13px;
  color: #555;
}
.gender-chip.active {
  background: #1a1a1a;
}
.gender-chip.active text {
  color: #ffffff;
}

.measure-group {
  margin-bottom: 10px;
}
.stage-row {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.stage-chip {
  flex: 1;
  height: 34px;
  border-radius: 10px;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid transparent;
}
.stage-chip text {
  font-size: 12px;
  color: #555;
}
.stage-chip.active {
  border-color: #1a1a1a;
  background: #ffffff;
}
.stage-chip.active text {
  color: #1a1a1a;
  font-weight: 600;
}
.group-title {
  display: block;
  font-size: 11px;
  color: #a0a0a0;
  letter-spacing: 1px;
  margin: 6px 0 4px;
}
.normalize-hint {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #f2f2f2;
}
.normalize-hint text {
  font-size: 10.5px;
  color: #b0b0b0;
  line-height: 16px;
}

.slider-row {
  display: flex;
  align-items: center;
  margin-bottom: 2px;
}
.slider-label {
  width: 40px;
  font-size: 12px;
  color: #6a6a6a;
  flex-shrink: 0;
}
.slider {
  flex: 1;
  margin: 0 6px;
}
.slider-value {
  width: 56px;
  text-align: right;
  font-size: 12px;
  color: #1a1a1a;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ---------- 衣橱 ---------- */
.wardrobe {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.wardrobe-item {
  position: relative;
  width: calc(50% - 5px);
  box-sizing: border-box;
  padding: 12px;
  border-radius: 14px;
  background: #fafafa;
  border: 1.5px solid transparent;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wardrobe-item.worn {
  border-color: #1a1a1a;
  background: #f2f2f0;
}
.swatch {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.item-title {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
}
.item-tag {
  font-size: 11px;
  color: #9a9a9a;
}
.worn-badge {
  position: absolute;
  right: 10px;
  top: 10px;
  font-size: 10px;
  color: #ffffff;
  background: #1a1a1a;
  border-radius: 999px;
  padding: 2px 7px;
}

/* ---------- 穿法面板 ---------- */
.field-label {
  font-size: 12px;
  color: #6a6a6a;
  display: block;
  margin-bottom: 8px;
}
.mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.mode-chip {
  padding: 7px 14px;
  border-radius: 999px;
  background: #f2f2f2;
  font-size: 12px;
  color: #555;
}
.mode-chip.active {
  background: #1a1a1a;
  color: #ffffff;
}
.fastener {
  border-top: 1px solid #f0f0f0;
  padding-top: 14px;
}
.fastener-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.fastener-value {
  font-size: 12px;
  color: #1a1a1a;
  font-variant-numeric: tabular-nums;
}
.fastener-hint {
  display: block;
  font-size: 11px;
  color: #a0a0a0;
  margin-top: 2px;
}

/* ---------- 其他 ---------- */
.footnote {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 6px;
}
.footnote text {
  font-size: 10.5px;
  color: #b0b0b0;
  line-height: 16px;
}
.ghost {
  position: fixed;
  z-index: 99;
  transform: translate(-50%, -50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(26, 26, 26, 0.9);
  color: #ffffff;
  font-size: 12px;
  pointer-events: none;
}
</style>
