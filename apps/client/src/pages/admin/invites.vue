<template>
  <AdminShell current="/pages/admin/invites">
    <text class="h1">邀请码管理</text>
    <text class="sub">内测期靠邀请码控制注册入口。短信与微信登录需企业资质，暂未开通。</text>

    <!-- 生成 -->
    <view class="gen">
      <input v-model.number="count" class="num-inp" type="number" placeholder="数量" placeholder-class="ph" />
      <input v-model="prefix" class="pfx-inp" placeholder="前缀" placeholder-class="ph" />
      <input v-model="note" class="note-inp" placeholder="备注（给谁用）" placeholder-class="ph" />
      <view class="gen-btn" :class="{ dis: generating }" @click="generate">
        <text>{{ generating ? '生成中…' : '生成' }}</text>
      </view>
    </view>

    <view class="bar">
      <text class="cnt">共 {{ invites.length }} 个 · 可用 {{ available }} 个 · 已用 {{ invites.length - available }} 个</text>
      <text class="fresh" @click="load">刷新</text>
    </view>

    <view class="list">
      <view v-for="i in invites" :key="i.code" class="row" :class="{ used: i.usedBy }">
        <text class="code">{{ i.code }}</text>
        <view class="mid">
          <text v-if="i.usedBy" class="by">已由 {{ i.usedNickname ?? i.usedBy }} 使用</text>
          <text v-else class="avail">可用</text>
          <text v-if="i.note" class="note">{{ i.note }}</text>
        </view>
        <text v-if="!i.usedBy" class="del" @click="remove(i.code)">作废</text>
      </view>
    </view>
    <text class="tip">已被使用的邀请码不能作废 —— 删了会丢掉「谁用哪个码注册的」这条线索。</text>
  </AdminShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminShell from '@/components/AdminShell.vue'
import { adminApi, errText } from '@/api/client'

const invites = ref<any[]>([])
const count = ref(5)
const prefix = ref('CDA-BETA')
const note = ref('')
const generating = ref(false)

const available = computed(() => invites.value.filter((i) => !i.usedBy).length)

async function load(): Promise<void> {
  try {
    const res = await adminApi.invites()
    invites.value = res.invites ?? []
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  }
}

async function generate(): Promise<void> {
  if (generating.value) return
  generating.value = true
  try {
    const res = await adminApi.createInvites(Number(count.value) || 1, prefix.value.trim() || 'CDA-BETA', note.value.trim())
    uni.showToast({ title: `已生成 ${res.created?.length ?? 0} 个`, icon: 'none' })
    note.value = ''
    await load()
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  } finally {
    generating.value = false
  }
}

function remove(code: string): void {
  uni.showModal({
    title: `作废 ${code}？`,
    success: async (r) => {
      if (!r.confirm) return
      try {
        await adminApi.deleteInvite(code)
        await load()
      } catch (e) {
        uni.showToast({ title: errText(e), icon: 'none' })
      }
    },
  })
}

onMounted(load)
</script>

<style scoped>
.h1 { font-size: 20px; font-weight: 700; display: block; }
.sub { font-size: 11.5px; color: #9a9a9a; display: block; margin: 6px 0 20px; line-height: 17px; }
.gen { display: flex; gap: 9px; margin-bottom: 18px; flex-wrap: wrap; }
.num-inp { width: 76px; height: 40px; background: #fff; border-radius: 9px; padding: 0 12px; font-size: 13.5px; box-sizing: border-box; }
.pfx-inp { width: 130px; height: 40px; background: #fff; border-radius: 9px; padding: 0 12px; font-size: 13.5px; box-sizing: border-box; }
.note-inp { flex: 1; min-width: 140px; height: 40px; background: #fff; border-radius: 9px; padding: 0 12px; font-size: 13.5px; box-sizing: border-box; }
.gen-btn { padding: 0 22px; height: 40px; border-radius: 9px; background: #1a1a1a; display: flex; align-items: center; }
.gen-btn.dis { background: #cfcfcf; }
.gen-btn text { color: #fff; font-size: 13.5px; font-weight: 600; }
.ph { color: #b8b8b8; }
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.cnt { font-size: 12px; color: #666; }
.fresh { font-size: 12px; color: #4a7fa5; }
.list { display: flex; flex-direction: column; gap: 7px; }
.row { display: flex; align-items: center; gap: 14px; background: #fff; border-radius: 10px; padding: 12px 15px; }
.row.used { opacity: .6; }
.code { font-size: 13.5px; font-weight: 600; letter-spacing: .5px; width: 130px; flex-shrink: 0; }
.mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.avail { font-size: 11.5px; color: #4a9d4a; }
.by { font-size: 11.5px; color: #9a9a9a; }
.note { font-size: 10.5px; color: #b0b0b0; }
.del { font-size: 12px; color: #c0504d; flex-shrink: 0; }
.tip { font-size: 10.5px; color: #b0b0b0; margin-top: 16px; display: block; line-height: 16px; }
</style>
