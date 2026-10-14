<template>
  <view class="page">
    <scroll-view class="body" scroll-y>
      <view v-if="user" class="card">
        <view class="urow">
          <view class="av" :style="{ background: user.avatarHex }" />
          <view class="uinfo">
            <text class="uname">{{ user.nickname }}</text>
            <text class="ucode">{{ user.code }}</text>
          </view>
          <text class="presence">{{ presence }}</text>
        </view>
      </view>

      <!-- 隐私 -->
      <text class="group">隐私</text>
      <view class="card">
        <view v-for="p in privacyRows" :key="p.key" class="srow">
          <view class="sinfo">
            <text class="st">{{ p.label }}</text>
            <text class="ss">{{ p.desc }}</text>
          </view>
          <switch :checked="!!user?.privacy[p.key]" color="#1a1a1a" @change="(e: any) => setPrivacy(p.key, e.detail.value)" />
        </view>
      </view>

      <!-- 账号 -->
      <text class="group">账号</text>
      <view class="card">
        <view class="srow tap" @click="pickRegion">
          <text class="st">国家与地区</text>
          <text class="sv">{{ user?.region ?? '中国' }} ›</text>
        </view>
        <view class="srow">
          <view class="sinfo">
            <text class="st">消息通知</text>
            <text class="ss">新消息、关注、交易提醒</text>
          </view>
          <switch :checked="notify" color="#1a1a1a" @change="(e: any) => (notify = e.detail.value)" />
        </view>
        <view class="srow tap" @click="payStub">
          <view class="sinfo">
            <text class="st">支付方式</text>
            <text class="ss">{{ payNote }}</text>
          </view>
          <text class="sv">›</text>
        </view>
      </view>

      <!-- 关于 -->
      <text class="group">关于</text>
      <view class="card">
        <view class="srow tap" @click="about">
          <text class="st">关于搭 · CDA</text>
          <text class="sv">v{{ version }} ›</text>
        </view>
        <view class="srow tap" @click="clearCache">
          <text class="st">清除本地缓存</text>
          <text class="sv">›</text>
        </view>
      </view>

      <!-- 注销 -->
      <view class="danger" @click="confirmDelete">
        <text>注销账号</text>
      </view>
      <text class="dnote">注销后账号、帖子、收藏与订单记录将一并删除且不可恢复</text>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { APP_VERSION, createPaymentProvider, presenceText, type PrivacySettings } from '@cda/core'
import { store, commitUser, logout } from '@/store/app-store'

const user = computed(() => store.user)
const notify = ref(true)
const version = APP_VERSION
const pay = createPaymentProvider()

/** 支付方式为 P0-2 要求的「预埋」项：入口在，但明确说明未开通 */
const payNote = computed(() => (pay.live ? '已绑定' : '未开通（需企业主体与营业执照）'))

const presence = computed(() => (user.value ? presenceText(user.value) : ''))

const privacyRows: Array<{ key: keyof PrivacySettings; label: string; desc: string }> = [
  { key: 'hideFromSearch', label: '不被搜索到', desc: '开启后其他用户无法通过昵称或用户码找到你' },
  { key: 'hideOnlineStatus', label: '隐藏在线状态', desc: '不展示「在线」与「上次在线时间」' },
  { key: 'hideRegion', label: '隐藏所在地区', desc: '主页不展示你的地区' },
  { key: 'allowStrangerMessage', label: '允许陌生人私聊', desc: '关闭后仅互相关注的人可发消息' },
]

function setPrivacy(key: keyof PrivacySettings, value: boolean): void {
  if (!user.value) return
  const next = { ...user.value, privacy: { ...user.value.privacy, [key]: value } }
  commitUser(next)
  uni.showToast({ title: value ? '已开启' : '已关闭', icon: 'none' })
}

function pickRegion(): void {
  const regions = ['中国', '中国香港', '中国台湾', '新加坡', '日本', '美国']
  uni.showActionSheet({
    itemList: regions,
    success: (r) => {
      if (!user.value) return
      commitUser({ ...user.value, region: regions[r.tapIndex] ?? '中国' })
    },
  })
}

function payStub(): void {
  uni.showModal({
    title: '支付方式',
    content: '微信支付 / 支付宝需企业主体 + 营业执照 + 商户号。未取得前，交易请走第三方平台完成。',
    showCancel: false,
  })
}

function about(): void {
  uni.showModal({
    title: '关于搭 · CDA',
    content: `一个把「已有衣橱」放在第一位的购物与穿搭社区。

开发：nationwildyounggay
github.com/nationwildyounggay

版本 ${APP_VERSION}`,
    showCancel: false,
  })
  setTimeout(() => {
    uni.setClipboardData({
      data: 'https://github.com/nationwildyounggay',
      success: () => uni.showToast({ title: '已复制 GitHub 地址', icon: 'none' }),
    })
  }, 300)
}

function clearCache(): void {
  uni.showModal({
    title: '清除本地缓存',
    content: '将清除身型数据与登录状态，不影响已保存的内容。',
    success: (r) => {
      if (!r.confirm) return
      try {
        uni.clearStorageSync()
      } catch {
        /* 忽略 */
      }
      logout()
      uni.showToast({ title: '已清除', icon: 'none' })
    },
  })
}

function confirmDelete(): void {
  uni.showModal({
    title: '确认注销账号？',
    content: '账号、帖子、收藏与订单记录将一并删除，且不可恢复。',
    confirmText: '注销',
    success: (r) => {
      if (!r.confirm) return
      logout()
      uni.showToast({ title: '已注销（演示）', icon: 'none' })
      // 注销后回**登录页**，而不是注册页 ——
      // 用户注销后多半是想换个账号登录，直接塞进 6 步注册是错的
      setTimeout(() => uni.reLaunch({ url: '/pages/login/login' }), 800)
    },
  })
}
</script>

<style scoped>
.page { min-height: 100vh; background: #fbfbfb; }
.body { height: 100vh; padding: 14px 16px 30px; box-sizing: border-box; }
.card { background: #fff; border-radius: 13px; padding: 4px 14px; box-shadow: 0 1px 8px rgba(0,0,0,.04); }
.urow { display: flex; align-items: center; gap: 12px; padding: 13px 0; }
.av { width: 46px; height: 46px; border-radius: 50%; }
.uinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.uname { font-size: 15px; font-weight: 600; }
.ucode { font-size: 11px; color: #a0a0a0; letter-spacing: .5px; }
.presence { font-size: 11px; color: #5aa35a; }
.group { display: block; font-size: 12px; font-weight: 600; color: #333; margin: 18px 0 8px; }
.srow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 0; border-bottom: 1px solid #f4f4f4; }
.srow:last-child { border-bottom: none; }
.sinfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.st { font-size: 13.5px; color: #222; }
.ss { font-size: 10.5px; color: #a0a0a0; line-height: 15px; }
.sv { font-size: 12.5px; color: #9a9a9a; }
.danger { margin-top: 26px; height: 46px; border-radius: 12px; background: #fdecec; display: flex; align-items: center; justify-content: center; }
.danger text { font-size: 14px; color: #c0504d; font-weight: 600; }
.dnote { display: block; text-align: center; font-size: 10.5px; color: #b8b8b8; margin-top: 9px; line-height: 15px; }
</style>
