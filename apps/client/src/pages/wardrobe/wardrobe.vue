<template>
  <view class="page">
    <view class="nav">
      <view class="nav-back" @click="goBack"><text>‹ 返回</text></view>
      <text class="nav-title">我的衣橱</text>
      <view class="nav-back placeholder" />
    </view>

    <view class="summary">
      <text class="summary-count">{{ store.wardrobe.length }} 件单品</text>
      <text class="summary-hint">用于穿搭建议与 3D 试穿</text>
    </view>

    <!-- 已有单品 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">衣橱清单</text>
      </view>

      <view v-if="store.wardrobe.length === 0" class="empty">
        <text class="empty-text">还没有单品，从下方商品库添加</text>
      </view>

      <view v-for="entry in wardrobeView" :key="entry.item.id" class="row-item">
        <image :src="entry.flatUrl" class="row-thumb" mode="aspectFit" />
        <view class="row-main">
          <text class="row-title">{{ entry.product?.title ?? entry.item.productId }}</text>
          <view class="row-meta">
            <view class="dot" :style="{ backgroundColor: entry.colorHex }" />
            <text class="row-meta-text">{{ entry.colorName }} · {{ entry.item.size }}</text>
          </view>
          <text class="row-source">{{ sourceLabel(entry.item.source) }}</text>
        </view>
        <view class="row-del" @click="onRemove(entry.item.id)"><text>移除</text></view>
      </view>
    </view>

    <!-- 商品库 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">从商品库添加</text>
        <text class="card-note">点击即加入衣橱</text>
      </view>

      <view class="grid">
        <view
          v-for="p in products"
          :key="p.id"
          class="grid-item"
          :class="{ owned: hasProduct(p.id) }"
          @click="onAdd(p)"
        >
          <image :src="flatUrlOf(p)" class="grid-thumb" mode="aspectFit" />
          <text class="grid-name">{{ p.title }}</text>
          <text class="grid-price">{{ formatPrice(p.priceCents) }}</text>
          <text v-if="hasProduct(p.id)" class="owned-badge">已在衣橱</text>
        </view>
      </view>
    </view>

    <!-- 入口 -->
    <view class="card">
      <view class="btn primary" @click="goImport"><text>拍照 / 上传识别导入 ›</text></view>
    </view>

    <view class="footnote">
      <text>当前数据仅存在内存中，刷新页面会重置（demo 阶段未接后端）</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  mockProducts,
  findProduct,
  formatPrice,
  garmentFlatUrl,
  type Product,
  type WardrobeItem,
} from '@cda/core'
import { store, addWardrobeItem, removeWardrobeItem, hasProduct } from '@/store/app-store'

const products = mockProducts

const wardrobeView = computed(() =>
  store.wardrobe.map((item) => {
    const product = findProduct(item.productId)
    const color = product?.colors.find((c) => c.id === item.colorId) ?? product?.colors[0]
    return {
      item,
      product,
      colorHex: color?.hex ?? '#cccccc',
      colorName: color?.name ?? '默认',
      flatUrl: product ? garmentFlatUrl(product.category, color?.hex ?? '#cccccc') : '',
    }
  }),
)

function flatUrlOf(p: Product) {
  return garmentFlatUrl(p.category, p.colors[0]?.hex ?? '#cccccc')
}

function sourceLabel(source: WardrobeItem['source']) {
  const map: Record<string, string> = {
    manual: '手工添加',
    photo: '拍照识别',
    order: '订单导入',
  }
  return map[source] ?? source
}

function onAdd(product: Product) {
  if (hasProduct(product.id)) return
  addWardrobeItem({
    productId: product.id,
    colorId: product.colors[0]?.id ?? 'default',
    size: product.sizes[0] ?? '均码',
    source: 'manual',
  })
}

function onRemove(id: string) {
  removeWardrobeItem(id)
}

function goBack() {
  uni.navigateBack({ delta: 1 })
}

function goImport() {
  uni.navigateTo({ url: '/pages/import/import' })
}
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

.summary {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 4px 6px;
}
.summary-count {
  font-size: 20px;
  font-weight: 600;
}
.summary-hint {
  font-size: 11px;
  color: #a0a0a0;
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

.empty {
  padding: 20px 0;
  text-align: center;
}
.empty-text {
  font-size: 12px;
  color: #a8a29a;
}

.row-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f2f2f2;
}
.row-item:last-child {
  border-bottom: none;
}
.row-thumb {
  width: 48px;
  height: 58px;
  border-radius: 8px;
  background: #f7f6f4;
  flex-shrink: 0;
}
.row-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row-title {
  font-size: 13px;
  font-weight: 500;
}
.row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}
.row-meta-text {
  font-size: 11px;
  color: #8a8a8a;
}
.row-source {
  font-size: 10px;
  color: #b0b0b0;
}
.row-del {
  padding: 6px 12px;
  border-radius: 999px;
  background: #fdecec;
}
.row-del text {
  font-size: 11px;
  color: #b03030;
}

.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.grid-item {
  position: relative;
  width: calc(50% - 5px);
  box-sizing: border-box;
  padding: 10px;
  border-radius: 14px;
  background: #fafafa;
  border: 1.5px solid transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.grid-item.owned {
  border-color: #1a1a1a;
  background: #f2f2f0;
}
.grid-thumb {
  width: 100%;
  height: 96px;
  background: #ffffff;
  border-radius: 8px;
}
.grid-name {
  font-size: 12px;
  line-height: 16px;
}
.grid-price {
  font-size: 11px;
  color: #8a8a8a;
}
.owned-badge {
  position: absolute;
  right: 8px;
  top: 8px;
  font-size: 10px;
  color: #ffffff;
  background: #1a1a1a;
  border-radius: 999px;
  padding: 2px 7px;
}

.btn {
  height: 46px;
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
