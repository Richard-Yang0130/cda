<template>
  <view class="page">
    <view class="head">
      <text class="title">我的人偶</text>
      <text class="sub">调好一次，之后只在身体变化时修改</text>
    </view>

    <view class="split">
      <!-- 左：实时人偶 -->
      <view class="stage-wrap">
        <view id="persona-stage" class="stage" />
        <text v-if="hint" class="hint">{{ hint }}</text>
      </view>

      <!-- 右：参数 -->
      <scroll-view class="panel" scroll-y>
        <text class="group">性别</text>
        <view class="chips">
          <view
            v-for="g in genders"
            :key="g.value"
            class="chip"
            :class="{ on: state.gender === g.value }"
            @click="switchGender(g.value)"
          >
            <text>{{ g.label }}</text>
          </view>
        </view>

        <text class="group">形体风格</text>
        <view class="chips">
          <view
            v-for="b in builds"
            :key="b.id"
            class="chip"
            :class="{ on: state.build === b.id }"
            @click="switchBuild(b.id)"
          >
            <text>{{ b.name }}</text>
          </view>
        </view>
        <text class="desc">{{ buildDesc }}</text>

        <text class="group">基础</text>
        <view v-for="m in basicFields" :key="m.key" class="row">
          <text class="lab">{{ m.label }}</text>
          <slider
            class="sld"
            :value="fieldValue(m.key)"
            :min="fieldRange(m.key).min"
            :max="fieldRange(m.key).max"
            :step="1"
            activeColor="#1a1a1a"
            block-color="#1a1a1a"
            :block-size="14"
            @changing="(e: any) => onField(m.key, e.detail.value, 'preview')"
            @change="(e: any) => onField(m.key, e.detail.value, 'final')"
          />
          <text class="val">{{ fieldValue(m.key) }}{{ m.unit }}</text>
        </view>

        <text class="group">分区调整</text>
        <view class="chips">
          <view
            v-for="s in stages"
            :key="s.id"
            class="chip stage"
            :class="{ on: activeStage === s.id }"
            @click="activeStage = s.id"
          >
            <text>{{ s.name }}</text>
          </view>
        </view>
        <view v-for="m in stageFields[activeStage]" :key="m.key" class="row">
          <text class="lab">{{ m.label }}</text>
          <slider
            class="sld"
            :value="fieldValue(m.key)"
            :min="fieldRange(m.key).min"
            :max="fieldRange(m.key).max"
            :step="1"
            activeColor="#1a1a1a"
            block-color="#1a1a1a"
            :block-size="14"
            @changing="(e: any) => onField(m.key, e.detail.value, 'preview')"
            @change="(e: any) => onField(m.key, e.detail.value, 'final')"
          />
          <text class="val">{{ fieldValue(m.key) }}{{ m.unit }}</text>
        </view>

        <text class="group">健康指标</text>
        <view class="metrics">
          <view v-for="mt in metrics" :key="mt.key" class="metric" :class="mt.level">
            <text class="ml">{{ mt.label }}</text>
            <text class="mv">{{ mt.display }}</text>
            <text class="mn">{{ mt.note }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <view class="foot">
      <!-- 照片估算入口：手动调参是最累的一步，给一条更省事的路 -->
      <view class="from-photo" @click="goPhotoEstimate">
        <text class="fp-t">📷 从全身照估算比例</text>
        <text class="fp-s">不用一个个量，照片自动填好身高比例</text>
      </view>
      <view class="primary" @click="goBack"><text>完成，去看衣橱</text></view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  BODY_BUILDS, FRAME_RANGES, HEIGHT_RANGE, WEIGHT_RANGE, GIRTH_KEYS,
  createBodyState, deriveProfile, girthAt, rangeOf, weightAt,
  setHeight, setWeight, setGirth, setFrame, setGender as setGenderState,
  healthMetrics,
  type BodyBuildId, type BodyState, type FrameKey, type GirthKey, type Gender,
} from '@cda/core'
import { TryonEngine, createH5Platform } from '@cda/tryon-engine'
import { mountStage, type StageHost } from '@/platform/stage'
import { store, commitBodyState, restoreBodyState } from '@/store/app-store'

const genders = [
  { value: 'male' as const, label: '男性' },
  { value: 'female' as const, label: '女性' },
]
const builds = BODY_BUILDS
const stages: Array<{ id: 'head' | 'upper' | 'lower'; name: string }> = [
  { id: 'head', name: '头颈' },
  { id: 'upper', name: '上半身' },
  { id: 'lower', name: '下半身' },
]
const activeStage = ref<'head' | 'upper' | 'lower'>('upper')

type FieldKey = 'heightCm' | 'weightKg' | GirthKey | FrameKey
interface MeasureField {
  key: FieldKey
  label: string
  unit: string
}

const basicFields: MeasureField[] = [
  { key: 'heightCm', label: '身高', unit: 'cm' },
  { key: 'weightKg', label: '体重', unit: 'kg' },
]
const stageFields: Record<'head' | 'upper' | 'lower', MeasureField[]> = {
  head: [{ key: 'neckLengthCm', label: '颈长', unit: 'cm' }],
  upper: [
    { key: 'shoulderWidthCm', label: '肩宽', unit: 'cm' },
    { key: 'chestCm', label: '胸围', unit: 'cm' },
    { key: 'waistCm', label: '腰围', unit: 'cm' },
    { key: 'torsoLengthCm', label: '上身长', unit: 'cm' },
    { key: 'upperArmCircCm', label: '大臂围', unit: 'cm' },
    { key: 'forearmCircCm', label: '小臂围', unit: 'cm' },
    { key: 'upperArmCm', label: '大臂长', unit: 'cm' },
    { key: 'forearmCm', label: '小臂长', unit: 'cm' },
  ],
  lower: [
    { key: 'hipCm', label: '臀围', unit: 'cm' },
    { key: 'thighCircCm', label: '大腿围', unit: 'cm' },
    { key: 'calfCircCm', label: '小腿围', unit: 'cm' },
    { key: 'thighCm', label: '大腿长', unit: 'cm' },
    { key: 'calfCm', label: '小腿长', unit: 'cm' },
  ],
}

// 状态从共享 store 读，页面切换不丢
const state = reactive<BodyState>({ ...store.bodyState, frame: { ...store.bodyState.frame } })
const profile = computed(() => deriveProfile(state))
const metrics = computed(() => healthMetrics(profile.value))
const buildDesc = computed(() => builds.find((b) => b.id === state.build)?.description ?? '')
const girthSet = new Set<string>(GIRTH_KEYS)
const hint = ref('按住可旋转人偶')

let engine: TryonEngine | null = null
let stage: StageHost | null = null

function fieldValue(key: FieldKey): number {
  if (key === 'heightCm') return state.heightCm
  if (key === 'weightKg') return Math.round(weightAt(state) * 10) / 10
  if (girthSet.has(key)) return Math.round(girthAt(state, key as GirthKey))
  return Math.round(state.frame[key as FrameKey] * 10) / 10
}

function fieldRange(key: FieldKey): { min: number; max: number } {
  if (key === 'heightCm') return HEIGHT_RANGE[state.gender]
  if (key === 'weightKg') {
    const w = rangeOf(state, 'weightKg')
    const abs = WEIGHT_RANGE[state.gender]
    return { min: Math.max(w.min, abs.min), max: Math.min(w.max, abs.max) }
  }
  if (girthSet.has(key)) return rangeOf(state, key as GirthKey)
  return FRAME_RANGES[key as FrameKey]
}

let pending = false
function schedule(): void {
  if (pending) return
  pending = true
  const run = () => {
    pending = false
    engine?.setBodyProfile(profile.value, 'preview')
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

/** 改一项数据：走耦合模型 → 同步到 store 与 3D 人偶 */
function onField(key: FieldKey, value: number, phase: 'preview' | 'final'): void {
  let next: BodyState = state
  if (key === 'heightCm') next = setHeight(state, value)
  else if (key === 'weightKg') next = setWeight(state, value)
  else if (girthSet.has(key)) next = setGirth(state, key as GirthKey, value)
  else next = setFrame(state, key as FrameKey, value)
  Object.assign(state, next)
  commitBodyState({ ...state, frame: { ...state.frame } })
  if (phase === 'preview') schedule()
  else engine?.setBodyProfile(profile.value, 'final')
}

async function switchGender(g: Gender): Promise<void> {
  if (state.gender === g) return
  Object.assign(state, setGenderState(state, g))
  commitBodyState({ ...state, frame: { ...state.frame } })
  engine?.setBodyProfile(profile.value, 'final')
  // 网格要换成对应性别
  try {
    await engine?.useMeshBody(`/static/models/${g}.obj`)
  } catch (err) {
    hint.value = `网格加载失败：${String(err)}`
  }
}

function switchBuild(id: BodyBuildId): void {
  if (state.build === id) return
  state.build = id
  commitBodyState({ ...state, frame: { ...state.frame } })
  engine?.setBodyProfile(profile.value, 'final')
}

function goPhotoEstimate(): void {
  uni.navigateTo({ url: '/pages/photo-proportion/photo-proportion' })
}

function goBack(): void {
  uni.navigateTo({ url: '/pages/index/index' })
}

async function initEngine(): Promise<void> {
  try {
    stage = mountStage('persona-stage')
  } catch (err) {
    hint.value = `舞台初始化失败：${String(err)}`
    return
  }
  engine = new TryonEngine({
    platform: createH5Platform(),
    canvas: stage.canvas,
    width: stage.width,
    height: stage.height,
    bodyProfile: profile.value,
  })
  stage.onResize((w, h) => engine?.resize(w, h))
  engine.start()
  try {
    await engine.useMeshBody(`/static/models/${state.gender}.obj`)
  } catch (err) {
    hint.value = `网格加载失败：${String(err)}`
  }
}

onMounted(() => {
  restoreBodyState()
  Object.assign(state, store.bodyState, { frame: { ...store.bodyState.frame } })
  void initEngine()
})
/*
 * 从别的页面返回时同步。
 *
 * ⚠️ 原先只 Object.assign，**不通知引擎** —— 于是「照片估算」页写入新身型后
 * 回到这里，数字变了但人偶还是旧样子。必须补上 setBodyProfile；
 * 性别若被改过还要换网格（男女是两套 OBJ）。
 */
onShow(async () => {
  const prevGender = state.gender
  Object.assign(state, store.bodyState, { frame: { ...store.bodyState.frame } })
  engine?.setBodyProfile(profile.value, 'final')
  if (state.gender !== prevGender) {
    try {
      await engine?.useMeshBody(`/static/models/${state.gender}.obj`)
    } catch (err) {
      hint.value = `网格加载失败：${String(err)}`
    }
  }
})
onBeforeUnmount(() => {
  engine?.stop()
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #fbfbfb;
  display: flex;
  flex-direction: column;
}
.head {
  padding: 16px 18px 8px;
}
.title {
  font-size: 20px;
  font-weight: 700;
}
.sub {
  display: block;
  font-size: 11.5px;
  color: #a0a0a0;
  margin-top: 3px;
}
.split {
  flex: 1;
  display: flex;
  gap: 10px;
  padding: 0 14px;
  min-height: 0;
}
.stage-wrap {
  flex: 1.1;
  position: relative;
  min-width: 0;
}
.stage {
  width: 100%;
  height: 62vh;
  border-radius: 16px;
  background: #efeae4;
  overflow: hidden;
}
.hint {
  position: absolute;
  left: 10px;
  top: 10px;
  font-size: 10.5px;
  color: #8a8a8a;
}
.panel {
  flex: 1;
  height: 62vh;
}
.group {
  display: block;
  font-size: 11.5px;
  font-weight: 600;
  color: #333;
  margin: 12px 0 6px;
}
.desc {
  display: block;
  font-size: 10.5px;
  color: #a8a8a8;
  line-height: 15px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  /* 必须限制交叉轴：默认 stretch 会让没有显式高度的子项拉满容器，
     三个分区按钮因此被拉成巨大色块 */
  align-items: flex-start;
}
.chip {
  padding: 5px 11px;
  border-radius: 999px;
  background: #f2f2f2;
}
.chip text {
  font-size: 11.5px;
  color: #555;
}
.chip.on {
  background: #1a1a1a;
}
.chip.on text {
  color: #fff;
}
.chip.stage {
  flex: 1;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.lab {
  font-size: 11px;
  color: #666;
  width: 46px;
  flex-shrink: 0;
}
.sld {
  flex: 1;
  min-width: 0;
}
.val {
  font-size: 11px;
  color: #333;
  width: 52px;
  text-align: right;
  flex-shrink: 0;
}
.metrics {
  display: flex;
  gap: 6px;
}
.metric {
  flex: 1;
  padding: 7px 6px;
  border-radius: 10px;
  background: #f5f5f5;
  border-left: 3px solid #c8c8c8;
}
.metric.good {
  background: #eef7ee;
  border-left-color: #4a9d4a;
}
.metric.watch {
  background: #fdf6e8;
  border-left-color: #d9a441;
}
.metric.risk {
  background: #fdecec;
  border-left-color: #c0504d;
}
.ml {
  font-size: 9.5px;
  color: #8a8a8a;
  display: block;
}
.mv {
  font-size: 14px;
  font-weight: 600;
  display: block;
}
.mn {
  font-size: 9px;
  color: #9a9a9a;
  line-height: 12px;
}
.foot {
  padding: 12px 14px 20px;
}
.from-photo {
  background: #eef4f8; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
}
.fp-t { display: block; font-size: 13.5px; font-weight: 700; color: #2f5d7c; }
.fp-s { display: block; font-size: 11px; color: #4a6f88; margin-top: 3px; }
.primary {
  height: 44px;
  border-radius: 12px;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
}
.primary text {
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
</style>
