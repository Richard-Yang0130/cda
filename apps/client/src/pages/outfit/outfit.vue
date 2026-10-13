<template>
  <NavShell current="/pages/outfit/outfit">
  <view class="page">
    <view class="nav">
      <text class="nav-title">穿搭建议</text>
      <view class="nav-back placeholder" />
    </view>

    <view class="intro">
      <text class="intro-line">
        基于你衣橱里的 {{ store.wardrobe.length }} 件单品，按色彩和谐度与品类完整度组合排序。
      </text>
    </view>

    <view class="card">
      <view class="btn primary" @click="generate">
        <text>{{ suggestions.length ? '重新生成' : '生成穿搭建议' }}</text>
      </view>
      <view v-if="!store.wardrobe.length" class="warn">
        <text>衣橱是空的，先去「我的衣橱」添加几件单品</text>
      </view>
    </view>

    <view v-for="(s, i) in suggestions" :key="s.id" class="card">
      <view class="card-head">
        <view class="head-left">
          <text class="rank">#{{ i + 1 }}</text>
          <text v-if="s.styleTag" class="tag">{{ s.styleTag }}</text>
        </view>
        <text class="score">{{ Math.round(s.score * 100) }} 分</text>
      </view>

      <view class="thumbs">
        <image
          v-for="pid in productIdsOf(s)"
          :key="pid"
          :src="flatUrlOf(pid)"
          class="thumb"
          mode="aspectFit"
        />
      </view>

      <text class="reason">{{ s.reason }}</text>

      <view class="btn dark" @click="applyToMannequin(s)">
        <text>在 3D 人偶上试穿 ›</text>
      </view>
    </view>

    <view v-if="suggestions.length" class="footnote">
      <text>建议由可解释的规则引擎生成（色彩和谐度 62% + 完整度 24% + 层次 14%），非深度学习模型</text>
    </view>
  </view>
  </NavShell>
</template>

<script setup lang="ts">
import NavShell from '@/components/NavShell.vue'
import { computed, ref } from 'vue'
import {
  mockProducts,
  findProduct,
  garmentFlatUrl,
  suggestOutfits,
  type OutfitSuggestion,
} from '@cda/core'
import { store } from '@/store/app-store'

const suggestions = ref<OutfitSuggestion[]>([])

function flatUrlOf(productId: string) {
  const p = findProduct(productId)
  return p ? garmentFlatUrl(p.category, p.colors[0]?.hex ?? '#cccccc') : ''
}

/** 把建议里的衣橱条目换算成商品 id（3D 引擎按 productId 挂载） */
function productIdsOf(s: OutfitSuggestion): string[] {
  return s.wardrobeItemIds
    .map((wid) => store.wardrobe.find((w) => w.id === wid)?.productId)
    .filter((x): x is string => Boolean(x))
}

function generate() {
  suggestions.value = suggestOutfits({
    wardrobe: store.wardrobe,
    products: mockProducts,
    limit: 5,
  })
}

function applyToMannequin(s: OutfitSuggestion) {
  // 通过 store 跨页传参，回到 3D 试穿台后由 onShow 消费
  store.pendingOutfit = productIdsOf(s)
  uni.navigateBack({ delta: 1 })
}

function goBack() {
  uni.navigateBack({ delta: 1 })
}

// 进入即生成一次，省一次点击
generate()
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
  padding: 0 4px;
}
.intro-line {
  font-size: 12px;
  color: #7a7a7a;
  line-height: 18px;
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
.head-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rank {
  font-size: 15px;
  font-weight: 600;
}
.tag {
  font-size: 10px;
  color: #555;
  background: #f0f0f0;
  border-radius: 999px;
  padding: 3px 9px;
}
.score {
  font-size: 13px;
  color: #1a1a1a;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.thumbs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.thumb {
  width: 62px;
  height: 78px;
  border-radius: 10px;
  background: #f7f6f4;
}

.reason {
  font-size: 12px;
  color: #5a5a5a;
  line-height: 19px;
  display: block;
  margin-bottom: 14px;
}

.btn {
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}
.btn.primary {
  background: #1a1a1a;
  color: #ffffff;
}
.btn.dark {
  background: #f2f2f2;
  color: #1a1a1a;
}

.warn {
  margin-top: 12px;
}
.warn text {
  font-size: 11px;
  color: #b03030;
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
