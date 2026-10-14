<template>
  <AdminShell current="/pages/admin/users">
    <text class="h1">用户管理</text>

    <view class="bar">
      <input v-model="kw" class="search" placeholder="搜索昵称 / 用户码 / 手机号" placeholder-class="ph" @confirm="load" />
      <view class="tabs">
        <text v-for="t in tabs" :key="t.v" class="tab" :class="{ on: status === t.v }" @click="pick(t.v)">{{ t.n }}</text>
      </view>
      <view class="btn" @click="load"><text>搜索</text></view>
    </view>

    <scroll-view class="list" scroll-x>
      <view class="table">
        <view class="tr th">
          <text class="td c-code">用户码</text>
          <text class="td c-name">昵称</text>
          <text class="td c-phone">手机号</text>
          <text class="td c-num">帖子</text>
          <text class="td c-time">注册时间</text>
          <text class="td c-st">状态</text>
          <text class="td c-act">操作</text>
        </view>
        <view v-for="u in users" :key="u.code" class="tr" :class="{ off: u.status === 'disabled' }">
          <text class="td c-code">{{ u.code }}</text>
          <text class="td c-name">{{ u.nickname }}</text>
          <!-- 手机号：viewer 角色后端返回 ***，前端不做判断，以服务端为准 -->
          <text class="td c-phone">{{ u.phone || '—' }}</text>
          <text class="td c-num">{{ u.postCount }}</text>
          <text class="td c-time">{{ (u.createdAt ?? '').slice(0, 10) }}</text>
          <text class="td c-st" :class="{ bad: u.status === 'disabled' }">{{ u.status === 'disabled' ? '已禁用' : '正常' }}</text>
          <view class="td c-act">
            <text v-if="u.status !== 'disabled'" class="act bad" @click="setStatus(u, 'disabled')">禁用</text>
            <text v-else class="act" @click="setStatus(u, 'active')">启用</text>
          </view>
        </view>
      </view>
    </scroll-view>
    <view v-if="!users.length" class="none"><text>没有匹配的用户</text></view>
    <text class="tip">禁用会立即踢下线（清掉他的登录态），并强制记录原因。</text>
  </AdminShell>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AdminShell from '@/components/AdminShell.vue'
import { adminApi, errText } from '@/api/client'

const users = ref<any[]>([])
const kw = ref('')
const status = ref('')
const tabs = [
  { n: '全部', v: '' },
  { n: '正常', v: 'active' },
  { n: '已禁用', v: 'disabled' },
]

async function load(): Promise<void> {
  try {
    const res = await adminApi.users(kw.value.trim(), status.value)
    users.value = res.users ?? []
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  }
}

function pick(v: string): void {
  status.value = v
  void load()
}

/**
 * 禁用/启用。
 * 禁用**必须填原因** —— 后端也会校验，这里先引导填写，
 * 避免用户点了才被拒。
 */
function setStatus(u: any, next: string): void {
  const doIt = (reason: string) => {
    adminApi
      .setUserStatus(u.code, next, reason)
      .then(() => { uni.showToast({ title: next === 'disabled' ? '已禁用' : '已启用', icon: 'none' }); return load() })
      .catch((e) => uni.showToast({ title: errText(e), icon: 'none' }))
  }
  if (next === 'disabled') {
    uni.showModal({
      title: `禁用 ${u.nickname}？`,
      content: '将立即踢下线。请说明原因（会记入审计日志）',
      editable: true,
      placeholderText: '例如：发布违规内容',
      success: (r: { confirm?: boolean; content?: string }) => {
        const reason = (r.content ?? '').trim()
        if (r.confirm && reason) doIt(reason)
      },
    } as never)
  } else {
    doIt('恢复启用')
  }
}

onMounted(load)
</script>

<style scoped>
.h1 { font-size: 20px; font-weight: 700; display: block; margin-bottom: 18px; }
.bar { display: flex; gap: 10px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
.search { width: 260px; height: 38px; background: #fff; border-radius: 9px; padding: 0 13px; font-size: 13px; box-sizing: border-box; }
.ph { color: #b8b8b8; }
.tabs { display: flex; gap: 5px; }
.tab { font-size: 12.5px; color: #666; padding: 7px 13px; border-radius: 8px; background: #fff; }
.tab.on { background: #1a1a1a; color: #fff; }
.btn { padding: 0 20px; height: 38px; border-radius: 9px; background: #1a1a1a; display: flex; align-items: center; }
.btn text { color: #fff; font-size: 13px; }
.list { background: #fff; border-radius: 12px; overflow-x: auto; }
.table { min-width: 760px; }
.tr { display: flex; align-items: center; border-bottom: 1px solid #f4f6f8; padding: 0 14px; }
.tr:last-child { border-bottom: none; }
.tr.th { background: #fafbfc; }
.tr.th .td { font-size: 11.5px; color: #9a9a9a; }
.tr.off { opacity: .55; }
.td { padding: 12px 0; font-size: 12.5px; color: #333; }
.c-code { width: 130px; flex-shrink: 0; font-family: ui-monospace, monospace; }
.c-name { width: 120px; flex-shrink: 0; }
.c-phone { width: 130px; flex-shrink: 0; }
.c-num { width: 56px; flex-shrink: 0; }
.c-time { width: 110px; flex-shrink: 0; }
.c-st { width: 70px; flex-shrink: 0; }
.c-st.bad { color: #c0504d; }
.c-act { width: 90px; flex-shrink: 0; }
.act { font-size: 12.5px; color: #4a7fa5; }
.act.bad { color: #c0504d; }
.none { padding: 40px 0; text-align: center; color: #b8b8b8; font-size: 12.5px; }
.tip { font-size: 10.5px; color: #b0b0b0; margin-top: 14px; display: block; }
</style>
