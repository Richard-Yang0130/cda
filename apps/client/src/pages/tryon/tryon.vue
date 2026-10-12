<template>
  <view class="page">
    <!-- 顶部 -->
    <view class="nav">
      <view class="nav-back" @click="goBack"><text>‹ 返回</text></view>
      <text class="nav-title">2D AI 试穿</text>
      <view class="nav-back placeholder" />
    </view>

    <view class="intro">
      <text class="intro-line">上传一张全身照 + 选一件单品，生成上身效果。</text>
      <view class="provider-badge" :class="{ mock: providerSimulated }">
        <text>{{ providerSimulated ? '占位实现（未接真实模型）' : `真实模型 · ${providerName}` }}</text>
      </view>
    </view>

    <!-- 人物照片 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">① 人物照片</text>
        <text class="card-note">建议正面、纯色背景</text>
      </view>

      <view class="person-slot" @click="choosePhoto">
        <image v-if="personImage" :src="personImage" class="person-img" mode="aspectFill" />
        <view v-else class="person-empty">
          <text class="person-empty-icon">＋</text>
          <text class="person-empty-text">点击选择照片</text>
        </view>
      </view>

      <view class="row">
        <view class="btn ghost" @click="choosePhoto"><text>选择照片</text></view>
        <view class="btn ghost" @click="useSamplePerson"><text>用示例人像</text></view>
      </view>
    </view>

    <!-- 单品选择 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">② 选择单品</text>
        <text class="card-note">来自商品库</text>
      </view>

      <scroll-view class="garment-scroll" scroll-x>
        <view class="garment-row">
          <view
            v-for="p in products"
            :key="p.id"
            class="garment-card"
            :class="{ active: selectedId === p.id }"
            @click="selectedId = p.id"
          >
            <image :src="flatUrlOf(p)" class="garment-thumb" mode="aspectFit" />
            <text class="garment-name">{{ p.title }}</text>
            <text class="garment-cat">{{ categoryLabel(p.category) }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- 生成 -->
    <view class="card">
      <view class="btn primary" :class="{ disabled: !canGenerate }" @click="generate">
        <text>{{ loading ? `生成中 ${elapsedSec}s…` : '开始试穿' }}</text>
      </view>

      <view v-if="error" class="error-box">
        <text class="error-text">{{ error }}</text>
      </view>
    </view>

    <!-- 结果 -->
    <view v-if="result" class="card">
      <view class="card-head">
        <text class="card-title">③ 试穿结果</text>
        <text class="card-note">{{ result.elapsedMs }}ms</text>
      </view>

      <view class="result-stage">
        <image :src="result.imageUrl" class="result-person" mode="aspectFill" />
        <image
          v-if="result.overlay"
          :src="result.overlay.garmentImage"
          class="result-overlay"
          mode="aspectFit"
          :style="overlayStyle"
        />
      </view>

      <view v-if="result.simulated" class="sim-note">
        <text>
          这是**占位合成**：把单品平铺图按类目默认位置贴到照片上，
          并非模型推理。接入真实模型后此提示会消失。
        </text>
      </view>

      <view class="row">
        <view class="btn ghost" @click="generate"><text>重新生成</text></view>
      </view>
    </view>

    <view class="footnote">
      <text>接口层已按真实 API 形状定义，配置 VITE_FAL_API_KEY 后自动切换为真实推理</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  mockProducts,
  samplePersonUrl,
  garmentFlatUrl,
  createTryOnProvider,
  CATEGORY_LABEL,
  type Category,
  type TryOnGarmentCategory,
  type TryOnResult,
  type Product,
} from '@cda/core'
import { tryOnConfig } from '@/config'

const provider = createTryOnProvider({
  falApiKey: tryOnConfig.falApiKey,
  falEndpoint: tryOnConfig.falEndpoint,
})

const providerName = provider.name
const providerSimulated = provider.simulated

const products = mockProducts
const personImage = ref<string>('')
const selectedId = ref<string>(mockProducts[0]?.id ?? '')
const result = ref<TryOnResult | null>(null)
const loading = ref(false)
const error = ref('')
const elapsedSec = ref(0)

let timer: ReturnType<typeof setInterval> | null = null

const selectedProduct = computed(() => products.find((p) => p.id === selectedId.value))

const canGenerate = computed(() => Boolean(personImage.value && selectedProduct.value) && !loading.value)

const overlayStyle = computed(() => {
  const o = result.value?.overlay
  if (!o) return ''
  return [
    `left:${o.rect.x * 100}%`,
    `top:${o.rect.y * 100}%`,
    `width:${o.rect.w * 100}%`,
    `height:${o.rect.h * 100}%`,
    `opacity:${o.opacity}`,
  ].join(';')
})

function flatUrlOf(p: Product) {
  return garmentFlatUrl(p.category, p.colors[0]?.hex ?? '#cccccc')
}

function categoryLabel(c: Category) {
  return CATEGORY_LABEL[c]
}

/** 把商品类目映射为试穿模型接受的三个类目 */
function toTryOnCategory(c: Category): TryOnGarmentCategory {
  if (c === 'bottom') return 'bottom'
  if (c === 'dress') return 'dress'
  return 'top'
}

function choosePhoto() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res: any) => {
      const path = res.tempFilePaths?.[0]
      if (path) {
        personImage.value = path
        result.value = null
        error.value = ''
      }
    },
    fail: () => {
      /* 用户取消，忽略 */
    },
  })
}

function useSamplePerson() {
  personImage.value = samplePersonUrl()
  result.value = null
  error.value = ''
}

async function generate() {
  const product = selectedProduct.value
  if (!personImage.value || !product || loading.value) return

  loading.value = true
  error.value = ''
  result.value = null
  elapsedSec.value = 0
  timer = setInterval(() => (elapsedSec.value += 1), 1000)

  try {
    result.value = await provider.generate({
      personImage: personImage.value,
      garmentImage: flatUrlOf(product),
      category: toTryOnCategory(product.category),
    })
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

function goBack() {
  uni.navigateBack({ delta: 1 })
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

/**
 * 自动演示：URL 带 auto=1 时，自动选用示例人像并跑一次试穿。
 * 便于无头浏览器截图验证，也方便给别人演示时少点几下。
 * 兼容 hash 路由（uni-app H5 默认），因此 search 和 hash 都要看。
 */
onMounted(async () => {
  // #ifdef H5
  if (typeof window === 'undefined') return
  const flags = `${window.location.search}${window.location.hash}`
  if (!flags.includes('auto=1')) return
  useSamplePerson()
  await nextTick()
  await generate()
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
  margin-bottom: 14px;
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
  margin-bottom: 12px;
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

/* 人像槽位固定为 2:3，与示例人像比例一致，避免 aspectFill 裁掉头部 */
.person-slot {
  width: 220px;
  height: 330px;
  margin: 0 auto;
  border-radius: 14px;
  overflow: hidden;
  background: #f2f1ef;
  border: 1.5px dashed #d8d4cf;
  display: flex;
  align-items: center;
  justify-content: center;
}
.person-img {
  width: 100%;
  height: 100%;
}
.person-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.person-empty-icon {
  font-size: 28px;
  color: #b8b2aa;
}
.person-empty-text {
  font-size: 12px;
  color: #a8a29a;
}

.row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.btn {
  flex: 1;
  height: 42px;
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

.garment-scroll {
  width: 100%;
  white-space: nowrap;
}
.garment-row {
  display: flex;
  gap: 10px;
}
.garment-card {
  width: 108px;
  flex-shrink: 0;
  padding: 8px;
  border-radius: 12px;
  background: #fafafa;
  border: 1.5px solid transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.garment-card.active {
  border-color: #1a1a1a;
}
.garment-thumb {
  width: 100%;
  height: 72px;
  border-radius: 8px;
  background: #ffffff;
}
.garment-name {
  font-size: 11px;
  line-height: 15px;
  color: #333;
  white-space: normal;
}
.garment-cat {
  font-size: 10px;
  color: #a8a8a8;
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
  line-height: 18px;
}

/*
 * 结果舞台必须与人物图同为 2:3。
 * 否则 aspectFill 会裁剪图片，而叠加层用的是相对容器的百分比坐标，
 * 一旦裁剪，叠加位置就会整体偏移。
 * 用 padding-bottom 撑高度，比 aspect-ratio 在小程序端更稳。
 */
.result-stage {
  position: relative;
  width: 100%;
  height: 0;
  padding-bottom: 150%;
  border-radius: 14px;
  overflow: hidden;
  background: #eeebe7;
}
.result-person {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.result-overlay {
  position: absolute;
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
