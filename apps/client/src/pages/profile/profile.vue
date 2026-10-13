<template>
  <view class="page">
    <view class="hero">
      <view class="avatar"><text>搭</text></view>
      <view class="who">
        <text class="name">我的空间</text>
        <text class="meta">{{ genderLabel }} · {{ heightLabel }} · {{ store.wardrobe.length }} 件单品</text>
      </view>
    </view>

    <view class="card" @click="openPersona">
      <view class="row">
        <view class="left">
          <text class="ct">我的人偶</text>
          <text class="cs">{{
            store.personaCreated ? '查看或修改身型数据' : '还没有人偶，先创建一个'
          }}</text>
        </view>
        <text class="arrow">›</text>
      </view>
      <view class="preview">
        <text class="ptag">{{
          store.personaCreated ? `胸${p.chestCm} 腰${p.waistCm} 臀${p.hipCm}` : '创建后可在 3D 人偶上试穿'
        }}</text>
      </view>
    </view>

    <view class="grid">
      <view v-for="it in items" :key="it.label" class="tile" @click="nav(it.url)">
        <text class="tt">{{ it.label }}</text>
        <text class="ts">{{ it.sub }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { deriveProfile } from '@cda/core'
import { store, restoreBodyState } from '@/store/app-store'

const p = computed(() => deriveProfile(store.bodyState))
const genderLabel = computed(() => (store.bodyState.gender === 'male' ? '男性' : '女性'))
const heightLabel = computed(() => `${store.bodyState.heightCm}cm`)

const items = [
  { label: '我的衣橱', sub: '已购单品', url: '/pages/wardrobe/wardrobe' },
  { label: '穿搭建议', sub: '按衣橱推荐', url: '/pages/outfit/outfit' },
  { label: '拍照导入', sub: '识别单品', url: '/pages/import/import' },
  { label: '2D 试穿', sub: '照片试穿', url: '/pages/tryon/tryon' },
]

function nav(url: string): void {
  uni.navigateTo({ url })
}

function openPersona(): void {
  uni.navigateTo({ url: '/pages/persona/persona' })
}

restoreBodyState()
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #fbfbfb;
  padding: 18px 16px 30px;
}
.hero {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.avatar {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar text {
  color: #fff;
  font-size: 22px;
  font-weight: 700;
}
.who {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.name {
  font-size: 18px;
  font-weight: 700;
}
.meta {
  font-size: 11.5px;
  color: #9a9a9a;
}
.card {
  background: #fff;
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
  margin-bottom: 16px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ct {
  font-size: 16px;
  font-weight: 600;
}
.cs {
  font-size: 11.5px;
  color: #9a9a9a;
}
.arrow {
  font-size: 22px;
  color: #c8c8c8;
}
.preview {
  margin-top: 12px;
  padding: 10px 12px;
  background: #f7f5f2;
  border-radius: 10px;
}
.ptag {
  font-size: 11.5px;
  color: #6a6a6a;
}
.grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.tile {
  width: calc(50% - 5px);
  background: #fff;
  border-radius: 14px;
  padding: 14px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tt {
  font-size: 14px;
  font-weight: 600;
}
.ts {
  font-size: 11px;
  color: #a0a0a0;
}
</style>
