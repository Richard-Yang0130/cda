<template>
  <NavShell current="/pages/profile/profile">
  <view class="page">
    <view class="hero">
      <!-- 已注册则展示真实用户（头像/昵称/用户码/在线状态），未注册回落到默认 -->
      <view class="avatar" :style="store.user ? { background: store.user.avatarHex } : {}">
        <text v-if="!store.user">搭</text>
      </view>
      <view class="who">
        <view class="nameline">
          <text class="name">{{ store.user?.nickname ?? '我的空间' }}</text>
          <text v-if="presence" class="online">{{ presence }}</text>
        </view>
        <text v-if="store.user" class="code">{{ store.user.code }}</text>
        <text class="meta">{{ genderLabel }} · {{ heightLabel }} · {{ store.wardrobe.length }} 件单品 · {{ regionLabel }}</text>
      </view>
      <view v-if="!store.user" class="reg" @click="goRegister"><text>注册</text></view>
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

    <!-- 我的收藏 / 关注 / 浏览历史（P0-2） -->
    <view class="mine">
      <view v-for="m in mine" :key="m.key" class="mtile" @click="openMine(m.key)">
        <text class="mv">{{ m.value }}</text>
        <text class="ml">{{ m.label }}</text>
      </view>
    </view>

    <view class="settings-entry" @click="goAddress">
      <text class="set-t">收货地址</text>
      <text class="set-s">{{ store.addresses.length ? store.addresses.length + ' 个地址' : '还没有收货地址' }}</text>
      <text class="arrow">›</text>
    </view>

    <view class="settings-entry" @click="goSettings">
      <text class="set-t">设置</text>
      <text class="set-s">隐私 · 账号 · 通知 · 关于</text>
      <text class="arrow">›</text>
    </view>

    <!-- ───── 我的空间：闲鱼式个人主页 ───── -->
    <view class="space">
      <view class="stats">
        <view v-for="st in stats" :key="st.label" class="stat">
          <text class="sv">{{ st.value }}</text>
          <text class="sl">{{ st.label }}</text>
        </view>
      </view>

      <view class="tabs">
        <view
          v-for="t in tabs"
          :key="t.id"
          class="tab"
          :class="{ on: tab === t.id }"
          @click="tab = t.id"
        >
          <text>{{ t.name }}</text>
        </view>
      </view>

      <!-- 动态：我发布的帖子 -->
      <view v-if="tab === 'posts'" class="plist">
        <view v-for="po in myPosts" :key="po.id" class="pitem" @click="openPost(po.id)">
          <view class="pthumb" :style="{ background: po.coverHex }" />
          <view class="pbody">
            <text class="pt">{{ po.title }}</text>
            <text class="pm">♡ {{ po.likes }} · 💬 {{ po.comments }} · {{ po.tags[0] }}</text>
          </view>
        </view>
      </view>

      <!-- 闲置：我挂出的（买卖核心） -->
      <view v-else-if="tab === 'sell'" class="plist">
        <view v-for="po in myPosts" :key="po.id" class="pitem">
          <view class="pthumb" :style="{ background: po.coverHex }" />
          <view class="pbody">
            <text class="pt">{{ linkedTitle(po) }}</text>
            <text class="pm">¥{{ linkedPrice(po) }} · 在售</text>
          </view>
          <view class="mini" @click="delist(po.id)"><text>下架</text></view>
        </view>
        <view v-if="!myPosts.length" class="none"><text>还没有挂出闲置</text></view>
      </view>

      <!-- 买到：交易记录 -->
      <view v-else class="plist">
        <view v-for="o in orders" :key="o.id" class="pitem">
          <view class="pthumb" :style="{ background: o.hex }" />
          <view class="pbody">
            <text class="pt">{{ o.title }}</text>
            <text class="pm">¥{{ o.price }} · {{ o.status }}</text>
          </view>
        </view>
        <view v-if="!orders.length" class="none"><text>还没有购买记录</text></view>
      </view>

      <view class="sell-cta" @click="goPublish">
        <text>＋ 发布闲置 / 动态</text>
      </view>
    </view>
  </view>
  </NavShell>
</template>

<script setup lang="ts">
import NavShell from '@/components/NavShell.vue'
import { computed, ref } from 'vue'
import { deriveProfile, findProduct, formatPrice, mockPosts, presenceText, type Post } from '@cda/core'
import { store, restoreBodyState } from '@/store/app-store'

const p = computed(() => deriveProfile(store.bodyState))
/** 在线状态与地区：受用户隐私设置控制（P0-2） */
const presence = computed(() => (store.user ? presenceText(store.user) : ''))
const regionLabel = computed(() =>
  !store.user || store.user.privacy.hideRegion ? '未公开' : store.user.region,
)
function goRegister(): void {
  uni.navigateTo({ url: '/pages/register/register' })
}
const genderLabel = computed(() => (store.bodyState.gender === 'male' ? '男性' : '女性'))
const heightLabel = computed(() => `${store.bodyState.heightCm}cm`)

const mine = computed(() => [
  { key: 'fav', label: '我的收藏', value: store.wardrobe.length },
  { key: 'follow', label: '我的关注', value: 3 },
  { key: 'history', label: '浏览历史', value: 12 },
])

function openMine(key: string): void {
  uni.showToast({ title: `${key === 'fav' ? '收藏' : key === 'follow' ? '关注' : '浏览历史'}（演示数据）`, icon: 'none' })
}

function goAddress(): void {
  uni.navigateTo({ url: '/pages/address/address' })
}

function goSettings(): void {
  uni.navigateTo({ url: '/pages/settings/settings' })
}

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

/*
 * ── 我的空间（闲鱼式个人主页）──
 *
 * 买卖功能的核心是「我挂出的闲置」与「我买到的」，两者现在都基于
 * store 里的本地数据。真实接入时需要后端与订单表；
 * 但**交互与数据结构先立住**，接后端时只换数据源。
 */
const tab = ref<'posts' | 'sell' | 'bought'>('posts')
const tabs = [
  { id: 'posts' as const, name: '动态' },
  { id: 'sell' as const, name: '闲置' },
  { id: 'bought' as const, name: '买到' },
]
const delisted = ref<string[]>([])

/** 演示：把前三条当作「我发布的」 */
const myPosts = computed(() => mockPosts.slice(0, 3).filter((p) => !delisted.value.includes(p.id)))

const orders = computed(() =>
  store.wardrobe.slice(0, 3).map((w) => {
    const p = findProduct(w.productId)
    return {
      id: w.id,
      title: p?.title ?? w.productId,
      price: p ? formatPrice(p.priceCents) : '—',
      hex: p?.colors[0]?.hex ?? '#dddddd',
      status: '已下单（演示）',
    }
  }),
)

const stats = computed(() => [
  { label: '动态', value: myPosts.value.length },
  { label: '在售', value: myPosts.value.length },
  { label: '衣橱', value: store.wardrobe.length },
])

function linkedTitle(po: Post): string {
  const p = po.linkedProductId ? findProduct(po.linkedProductId) : undefined
  return p?.title ?? po.title
}

function linkedPrice(po: Post): string {
  const p = po.linkedProductId ? findProduct(po.linkedProductId) : undefined
  return p ? formatPrice(p.priceCents) : '—'
}

function delist(id: string): void {
  delisted.value = [...delisted.value, id]
  uni.showToast({ title: '已下架（演示）', icon: 'none' })
}

function openPost(id: string): void {
  uni.navigateTo({ url: `/pages/post/post?id=${id}` })
}

function goPublish(): void {
  uni.navigateTo({ url: '/pages/publish/publish' })
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
.nameline {
  display: flex;
  align-items: center;
  gap: 7px;
}
.name {
  font-size: 18px;
  font-weight: 700;
}
.online {
  font-size: 10px;
  color: #4a9d4a;
  background: #eef7ee;
  padding: 2px 7px;
  border-radius: 8px;
}
.code {
  font-size: 11px;
  color: #8a8a8a;
  letter-spacing: 1px;
  margin-top: 1px;
}
.reg {
  padding: 6px 14px;
  border-radius: 999px;
  background: #1a1a1a;
  flex-shrink: 0;
}
.reg text {
  color: #fff;
  font-size: 12px;
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
.space {
  margin-top: 20px;
}
.stats {
  display: flex;
  background: #fff;
  border-radius: 14px;
  padding: 14px 0;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.sv {
  font-size: 17px;
  font-weight: 700;
}
.sl {
  font-size: 10.5px;
  color: #a0a0a0;
}
.tabs {
  display: flex;
  gap: 8px;
  margin: 16px 0 10px;
}
.tab {
  flex: 1;
  height: 34px;
  border-radius: 10px;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tab text {
  font-size: 12.5px;
  color: #666;
}
.tab.on {
  background: #1a1a1a;
}
.tab.on text {
  color: #fff;
  font-weight: 600;
}
.plist {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.pitem {
  display: flex;
  align-items: center;
  gap: 11px;
  background: #fff;
  border-radius: 12px;
  padding: 10px;
  box-shadow: 0 1px 7px rgba(0, 0, 0, 0.04);
}
.pthumb {
  width: 52px;
  height: 52px;
  border-radius: 9px;
  flex-shrink: 0;
}
.pbody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pt {
  font-size: 12.5px;
  color: #222;
  line-height: 17px;
}
.pm {
  font-size: 10.5px;
  color: #a0a0a0;
}
.mini {
  padding: 5px 11px;
  border-radius: 8px;
  background: #f2f2f2;
  flex-shrink: 0;
}
.mini text {
  font-size: 11px;
  color: #666;
}
.none {
  padding: 26px 0;
  text-align: center;
  color: #b8b8b8;
  font-size: 12px;
}
.sell-cta {
  margin-top: 14px;
  height: 42px;
  border-radius: 12px;
  border: 1px dashed #cfcfcf;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sell-cta text {
  font-size: 13px;
  color: #666;
}
.mine {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.mtile {
  flex: 1;
  background: #fff;
  border-radius: 12px;
  padding: 13px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  box-shadow: 0 1px 7px rgba(0,0,0,.04);
}
.mv { font-size: 17px; font-weight: 700; }
.ml { font-size: 10.5px; color: #a0a0a0; }
.settings-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  background: #fff;
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 1px 7px rgba(0,0,0,.04);
}
.set-t { font-size: 14px; font-weight: 600; }
.set-s { flex: 1; font-size: 10.5px; color: #a8a8a8; }
.arrow { font-size: 18px; color: #c8c8c8; }
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
