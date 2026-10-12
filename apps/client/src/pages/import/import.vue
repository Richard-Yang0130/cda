<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack"><text>‹ 返回</text></view>
      <text class="nav-title">拍照导入单品</text>
      <view class="nav-back placeholder" />
    </view>

    <view class="intro">
      <text class="intro-line">拍一张单品照片，识别出它并加入「我的衣橱」。</text>
      <view class="provider-badge" :class="{ mock: provider.simulated }">
        <text>{{ provider.simulated ? '占位识别（未接真实模型）' : `真实识别 · ${provider.name}` }}</text>
      </view>
    </view>

    <!-- 照片 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">① 单品照片</text>
        <text class="card-note">平铺或挂拍效果最好</text>
      </view>

      <view class="photo-slot" @click="choosePhoto">
        <image v-if="photo" :src="photo" class="photo-img" mode="aspectFit" />
        <view v-else class="photo-empty">
          <text class="photo-empty-icon">＋</text>
          <text class="photo-empty-text">点击拍照 / 选择图片</text>
        </view>
      </view>

      <view class="row">
        <view class="btn ghost" @click="choosePhoto"><text>选择图片</text></view>
        <view class="btn ghost" @click="useSample"><text>用示例单品图</text></view>
      </view>

      <view class="btn primary" :class="{ disabled: !photo || loading }" @click="recognize">
        <text>{{ loading ? `识别中 ${elapsedSec}s…` : '开始识别' }}</text>
      </view>

      <view v-if="error" class="error-box"><text class="error-text">{{ error }}</text></view>
    </view>

    <!-- 识别结果 -->
    <view v-if="result" class="card">
      <view class="card-head">
        <text class="card-title">② 识别结果</text>
        <text class="card-note">{{ result.elapsedMs }}ms</text>
      </view>

      <view
        v-for="c in result.candidates"
        :key="c.productId"
        class="cand"
        :class="{ active: selectedProductId === c.productId }"
        @click="selectedProductId = c.productId"
      >
        <image :src="flatUrlOf(c.productId)" class="cand-thumb" mode="aspectFit" />
        <view class="cand-main">
          <text class="cand-title">{{ titleOf(c.productId) }}</text>
          <text class="cand-reason">{{ c.reason }}</text>
          <view class="bar">
            <view class="bar-fill" :style="{ width: Math.round(c.confidence * 100) + '%' }" />
          </view>
        </view>
        <text class="cand-conf">{{ Math.round(c.confidence * 100) }}%</text>
      </view>

      <view class="btn primary" :class="{ disabled: !selectedProductId }" @click="confirmAdd">
        <text>确认加入衣橱</text>
      </view>

      <view v-if="result.simulated" class="sim-note">
        <text>
          这是**占位识别**：用图片内容的哈希做确定性排序，让不同图片得到不同结果，
          并非真实模型推理。真实链路为「检测分割 → CLIP 向量 → 向量库召回 → 属性重排」。
        </text>
      </view>
    </view>

    <view class="footnote">
      <text>真实链路精度预期：类目 >90%、颜色 >85%、同款 Top-10 命中 50–70%</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  mockProducts,
  findProduct,
  garmentFlatUrl,
  createRecognitionProvider,
  type RecognitionResult,
} from '@cda/core'
import { addWardrobeItem, hasProduct } from '@/store/app-store'
import { tryOnConfig } from '@/config'

const provider = createRecognitionProvider({
  endpoint: tryOnConfig.recognitionEndpoint,
  catalog: mockProducts,
})

const photo = ref('')
const result = ref<RecognitionResult | null>(null)
const selectedProductId = ref('')
const loading = ref(false)
const error = ref('')
const elapsedSec = ref(0)

let timer: ReturnType<typeof setInterval> | null = null

const canConfirm = computed(() => Boolean(selectedProductId.value))

function titleOf(productId: string) {
  return findProduct(productId)?.title ?? productId
}

function flatUrlOf(productId: string) {
  const p = findProduct(productId)
  return p ? garmentFlatUrl(p.category, p.colors[0]?.hex ?? '#cccccc') : ''
}

function choosePhoto() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['camera', 'album'],
    success: (res: any) => {
      const path = res.tempFilePaths?.[0]
      if (path) {
        photo.value = path
        result.value = null
        error.value = ''
      }
    },
    fail: () => {
      /* 用户取消 */
    },
  })
}

function useSample() {
  // 用商品库里三件单品之一作为「拍到的照片」，让未准备素材也能跑通
  const p = mockProducts[1] ?? mockProducts[0]
  if (!p) return
  photo.value = garmentFlatUrl(p.category, p.colors[0]?.hex ?? '#cccccc')
  result.value = null
  error.value = ''
}

async function recognize() {
  if (!photo.value || loading.value) return
  loading.value = true
  error.value = ''
  result.value = null
  elapsedSec.value = 0
  timer = setInterval(() => (elapsedSec.value += 1), 1000)

  try {
    const res = await provider.recognize({ image: photo.value })
    result.value = res
    selectedProductId.value = res.candidates[0]?.productId ?? ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

function confirmAdd() {
  const product = findProduct(selectedProductId.value)
  if (!product) return

  if (hasProduct(product.id)) {
    error.value = '这件单品已经在你的衣橱里了'
    return
  }

  addWardrobeItem({
    productId: product.id,
    colorId: product.colors[0]?.id ?? 'default',
    size: product.sizes[0] ?? '均码',
    source: 'photo',
  })
  uni.navigateBack({ delta: 1 })
}

function goBack() {
  uni.navigateBack({ delta: 1 })
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

/** 自动演示：URL 带 auto=1 时自动选示例图并跑一次识别 */
onMounted(async () => {
  // #ifdef H5
  if (typeof window === 'undefined') return
  const flags = `${window.location.search}${window.location.hash}`
  if (!flags.includes('auto=1')) return
  useSample()
  await nextTick()
  await recognize()
  // #endif
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 44px 16px 40px;
  box-sizing: border-box;
  background: #f5f5f7;
}
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.nav-back {
  font-size: 14px;
  color: #444;
  min-width: 64px;
}
.nav-back.placeholder {
  opacity: 0;
}
.nav-title {
  font-size: 16px;
  font-weight: 600;
}

.intro {
  padding: 0 4px 4px;
}
.intro-line {
  font-size: 12px;
  color: #7a7a7a;
  line-height: 18px;
  display: block;
}
.provider-badge {
  display: inline-block;
  margin-top: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  background: #e6f0e6;
  font-size: 11px;
  color: #2f6b2f;
}
.provider-badge.mock {
  background: #fdeede;
  color: #8a5a1c;
}

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

.photo-slot {
  width: 100%;
  height: 220px;
  border-radius: 14px;
  overflow: hidden;
  background: #f7f6f4;
  border: 1.5px dashed #d8d4cf;
  display: flex;
  align-items: center;
  justify-content: center;
}
.photo-img {
  width: 100%;
  height: 100%;
}
.photo-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.photo-empty-icon {
  font-size: 26px;
  color: #b8b2aa;
}
.photo-empty-text {
  font-size: 12px;
  color: #a8a29a;
}

.row {
  display: flex;
  gap: 10px;
  margin: 12px 0;
}
.btn {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.btn.ghost {
  background: #f2f2f2;
  color: #444;
}
.btn.primary {
  background: #1a1a1a;
  color: #ffffff;
}
.btn.disabled {
  opacity: 0.35;
}

.cand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  margin-bottom: 8px;
  border-radius: 12px;
  background: #fafafa;
  border: 1.5px solid transparent;
}
.cand.active {
  border-color: #1a1a1a;
  background: #f2f2f0;
}
.cand-thumb {
  width: 44px;
  height: 54px;
  border-radius: 8px;
  background: #ffffff;
  flex-shrink: 0;
}
.cand-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cand-title {
  font-size: 13px;
  font-weight: 500;
}
.cand-reason {
  font-size: 10.5px;
  color: #9a9a9a;
}
.bar {
  height: 4px;
  border-radius: 2px;
  background: #e8e8e8;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: #1a1a1a;
}
.cand-conf {
  font-size: 12px;
  color: #444;
  font-variant-numeric: tabular-nums;
}

.error-box {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fdecec;
}
.error-text {
  font-size: 12px;
  color: #b03030;
}

.sim-note {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fdf6e8;
}
.sim-note text {
  font-size: 11px;
  line-height: 17px;
  color: #8a6431;
}

.footnote {
  margin-top: 18px;
  padding: 0 6px;
}
.footnote text {
  font-size: 10.5px;
  color: #b0b0b0;
  line-height: 16px;
}
</style>
