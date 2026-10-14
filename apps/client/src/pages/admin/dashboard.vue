<template>
  <AdminShell current="/pages/admin/dashboard" ref="shell">
    <text class="h1">数据看板</text>
    <view class="grid">
      <view v-for="c in cards" :key="c.key" class="card">
        <text class="num">{{ stats[c.key] ?? '—' }}</text>
        <text class="name">{{ c.name }}</text>
        <text v-if="c.hint" class="hint">{{ c.hint }}</text>
      </view>
    </view>
    <view class="tip">
      <text>数据来自线上数据库，刷新页面即更新。</text>
    </view>
  </AdminShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminShell from '@/components/AdminShell.vue'
import { adminApi, errText } from '@/api/client'

const shell = ref<any>(null)
const stats = ref<Record<string, number>>({})

const cards = computed(() => [
  { key: 'users', name: '总用户', hint: '' },
  { key: 'usersNew7d', name: '近 7 天新增', hint: '' },
  { key: 'online', name: '当前在线', hint: '' },
  { key: 'posts', name: '帖子', hint: '' },
  { key: 'comments', name: '评论', hint: '' },
  { key: 'messages', name: '消息', hint: '' },
  { key: 'invitesAvailable', name: '可用邀请码', hint: `共 ${stats.value.invitesTotal ?? 0} 个` },
  { key: 'reportsPending', name: '待处理举报', hint: '' },
])

onMounted(async () => {
  try {
    const res = await adminApi.dashboard()
    stats.value = res.stats ?? {}
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  }
})
</script>

<style scoped>
.h1 { font-size: 20px; font-weight: 700; display: block; margin-bottom: 20px; }
.grid { display: flex; flex-wrap: wrap; gap: 14px; }
.card {
  width: 170px; background: #fff; border-radius: 13px; padding: 18px;
  box-shadow: 0 1px 8px rgba(0,0,0,.04); display: flex; flex-direction: column; gap: 5px;
}
.num { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
.name { font-size: 12.5px; color: #666; }
.hint { font-size: 10.5px; color: #b0b0b0; }
.tip { margin-top: 26px; }
.tip text { font-size: 11.5px; color: #a8a8a8; }
</style>
