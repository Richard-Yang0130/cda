<template>
  <AdminShell current="/pages/admin/logs">
    <text class="h1">审计日志</text>
    <text class="sub">后台能封号、能删内容，「谁在什么时候因为什么做了什么」必须查得到。owner 的操作同样记录。</text>
    <view class="list">
      <view v-for="l in logs" :key="l.id" class="row">
        <text class="time">{{ (l.createdAt ?? '').slice(0, 19).replace('T', ' ') }}</text>
        <text class="user">{{ l.username }}</text>
        <text class="action" :class="kind(l.action)">{{ l.action }}</text>
        <text class="target">{{ l.target }}</text>
        <text class="detail">{{ l.detail }}</text>
      </view>
    </view>
    <view v-if="!logs.length" class="none"><text>暂无记录</text></view>
  </AdminShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AdminShell from '@/components/AdminShell.vue'
import { adminApi, errText } from '@/api/client'

const logs = ref<any[]>([])

/** 危险操作标红，便于快速扫读 */
function kind(action: string): string {
  if (action.includes('delete') || action.includes('disable')) return 'danger'
  if (action.includes('create') || action.includes('enable')) return 'ok'
  return ''
}

onMounted(async () => {
  try {
    const res = await adminApi.logs(60)
    logs.value = res.logs ?? []
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  }
})
</script>

<style scoped>
.h1 { font-size: 20px; font-weight: 700; display: block; }
.sub { font-size: 11.5px; color: #9a9a9a; display: block; margin: 6px 0 18px; line-height: 17px; }
.list { background: #fff; border-radius: 12px; overflow: hidden; }
.row { display: flex; align-items: center; gap: 14px; padding: 11px 15px; border-bottom: 1px solid #f4f6f8; }
.row:last-child { border-bottom: none; }
.time { width: 140px; flex-shrink: 0; font-size: 11.5px; color: #9a9a9a; font-family: ui-monospace, monospace; }
.user { width: 80px; flex-shrink: 0; font-size: 12.5px; color: #333; }
.action { width: 120px; flex-shrink: 0; font-size: 11.5px; color: #666; font-family: ui-monospace, monospace; }
.action.danger { color: #c0504d; }
.action.ok { color: #4a9d4a; }
.target { width: 140px; flex-shrink: 0; font-size: 11.5px; color: #888; font-family: ui-monospace, monospace; }
.detail { flex: 1; min-width: 0; font-size: 12px; color: #555; }
.none { padding: 40px 0; text-align: center; color: #b8b8b8; font-size: 12.5px; }
</style>
