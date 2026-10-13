<template>
  <NavShell current="/pages/messages/messages">
  <view class="page">
    <!-- 聊天视图 -->
    <template v-if="active">
      <view class="chathead">
        <text class="back" @click="active = null">‹</text>
        <!-- 头像与昵称都可点进对方主页（用户反馈：私聊界面没有入口到他人主页） -->
        <view class="chinfo" @click="openPeer">
          <view class="chav" :style="{ background: active.hex }" />
          <view class="chtext">
            <text class="chname">{{ active.name }}</text>
            <text class="chpresence">{{ active.presence || '—' }}</text>
          </view>
        </view>
        <text class="chmore" @click="peerActions">⋯</text>
      </view>

      <scroll-view class="msgs" scroll-y :scroll-top="scrollTop">
        <view v-for="m in active.messages" :key="m.id" class="mline" :class="{ me: m.fromMe }">
          <view class="bubble" :class="{ me: m.fromMe }">
            <text class="btext">{{ m.text }}</text>
            <text class="btime">{{ m.time }}</text>
          </view>
        </view>
      </scroll-view>

      <view class="composer">
        <input v-model="draft" class="cinput" placeholder="说点什么…" placeholder-class="ph" @confirm="send" />
        <view class="send" :class="{ dis: !draft.trim() }" @click="send"><text>发送</text></view>
      </view>
    </template>

    <!-- 列表视图 -->
    <template v-else>
      <view class="search">
        <input v-model="kw" class="sinput" placeholder="搜索用户：昵称或 CDA_ 用户码" placeholder-class="ph" />
      </view>

      <scroll-view class="list" scroll-y>
        <!-- 搜索结果（P0-2：按昵称与用户码搜索用户） -->
        <template v-if="kw.trim()">
          <text class="group">用户（{{ found.length }}）</text>
          <view v-for="u in found" :key="u.id" class="row" @click="openChat(u)">
            <view class="av" :style="{ background: u.hex }" />
            <view class="info">
              <text class="nm">{{ u.name }}</text>
              <text class="cd">{{ u.code }}</text>
            </view>
            <text class="pres">{{ u.presence }}</text>
          </view>
          <view v-if="!found.length" class="none"><text>没有找到该用户</text></view>
        </template>

        <!-- 会话列表 -->
        <template v-else>
          <text class="group">消息</text>
          <view v-for="c in convs" :key="c.id" class="row" @click="openConv(c)">
            <view class="av" :style="{ background: c.hex }" />
            <view class="info">
              <text class="nm">{{ c.name }}</text>
              <text class="last">{{ c.messages[c.messages.length - 1]?.text ?? '开始聊天' }}</text>
            </view>
            <view class="right">
              <text class="pres">{{ c.presence }}</text>
              <view v-if="c.unread" class="badge"><text>{{ c.unread }}</text></view>
            </view>
          </view>
          <view v-if="!convs.length" class="none"><text>还没有消息，搜索用户开始聊天</text></view>
        </template>
      </scroll-view>
    </template>
  </view>
  </NavShell>
</template>

<script setup lang="ts">
import NavShell from '@/components/NavShell.vue'
import { computed, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { presenceText, type UserProfile } from '@cda/core'
import { store } from '@/store/app-store'
import { api, errText } from '@/api/client'

/**
 * 消息页（P0-3）+ 用户搜索（P0-2）。
 *
 * 数据现为本地演示：会话与消息存在内存里。
 * 接后端时替换 loadConversations / sendMessage 两个数据源，UI 不动。
 */
interface Msg { id: string; text: string; time: string; fromMe: boolean }
interface Conv {
  id: string; name: string; code: string; hex: string
  presence: string; unread: number; messages: Msg[]
}

const kw = ref('')
const draft = ref('')
const scrollTop = ref(0)
const active = ref<Conv | null>(null)

/** 搜索结果（来自后端） */
const found = ref<Array<{ id: string; name: string; code: string; hex: string; presence: string }>>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 按昵称或用户码搜索用户。
 * 走后端而不是本地列表 —— 本地 mock 只能搜到自己造的那几个人，
 * 这也是「接入后端」的意义所在。
 * 输入防抖 300ms，避免每敲一个字都打一次接口。
 */
watch(kw, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  const q = v.trim()
  if (!q) {
    found.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    try {
      const res = await api.searchUsers(q)
      found.value = (res.users ?? []).map((u) => ({
        id: u.code,
        name: u.nickname,
        code: u.code,
        hex: u.avatarHex,
        presence: presenceText(u),
      }))
    } catch (e) {
      found.value = []
      uni.showToast({ title: errText(e), icon: 'none' })
    } finally {
      searching.value = false
    }
  }, 300)
})

// 会话由后端提供，不再有本地示例数据（onShow 里拉取）
const convs = ref<Conv[]>([])

/**
 * 从后端拉会话列表。
 * 后端返回的 peer 是完整用户对象，这里映射成页面用的形状。
 */
async function loadConversations(): Promise<void> {
  try {
    const res = await api.conversations()
    convs.value = (res.conversations ?? []).map((c) => ({
      id: c.id,
      name: c.peer?.nickname ?? c.peer?.code ?? '用户',
      code: c.peer?.code ?? '',
      hex: c.peer?.avatarHex ?? '#cccccc',
      presence: presenceText(c.peer ?? {}),
      unread: c.unread ?? 0,
      messages: [],
    }))
  } catch (e) {
    // 未登录时后端返回 401，此时保持空列表即可，不打扰用户
    if (!/登录/.test(errText(e))) uni.showToast({ title: errText(e), icon: 'none' })
  }
}

onShow(() => {
  void loadConversations()
})

async function openChat(u: { id: string; name: string; code: string; hex: string; presence: string }): Promise<void> {
  kw.value = ''
  const existing = convs.value.find((c) => c.code === u.code)
  if (existing) {
    await openConv(existing)
    return
  }
  const conv: Conv = {
    id: `c_${u.code}`, name: u.name, code: u.code, hex: u.hex,
    presence: u.presence, unread: 0, messages: [],
  }
  convs.value.unshift(conv)
  await openConv(conv)
}

/** 进入会话：从后端拉历史消息 */
async function openConv(c: Conv): Promise<void> {
  active.value = c
  c.unread = 0
  scrollTop.value += 100000
  if (!c.code) return
  try {
    const res = await api.messages(c.code)
    c.messages = (res.messages ?? []).map((m) => ({
      id: m.id,
      text: m.text,
      time: (m.createdAt ?? '').slice(11, 16),
      fromMe: !!m.fromMe,
    }))
    setTimeout(() => (scrollTop.value += 100000), 120)
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  }
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  const c = active.value
  if (!text || !c || !c.code) return
  draft.value = ''
  try {
    const res = await api.sendMessage(c.code, text)
    c.messages.push({
      id: res.message.id,
      text: res.message.text,
      time: (res.message.createdAt ?? '').slice(11, 16),
      fromMe: true,
    })
    scrollTop.value += 100000
  } catch (e) {
    draft.value = text // 失败时把内容还回输入框，别让用户白打一遍
    uni.showToast({ title: errText(e), icon: 'none' })
  }
}

function openPeer(): void {
  const c = active.value
  if (!c) return
  uni.navigateTo({ url: `/pages/user/user?code=${c.code}` })
}

/** 会话内的更多操作：关注 / 拉黑（P0-2） */
function peerActions(): void {
  const c = active.value
  if (!c) return
  uni.showActionSheet({
    itemList: ['关注', '取消关注', '加入黑名单', '举报'],
    success: (r) => {
      const acts = ['已关注', '已取消关注', '已加入黑名单', '已提交举报']
      uni.showToast({ title: `${acts[r.tapIndex]}（演示）`, icon: 'none' })
    },
  })
}

void store
</script>

<style scoped>
.page { min-height: 100vh; background: #fbfbfb; display: flex; flex-direction: column; }
.search { padding: 12px 16px; }
.sinput { height: 40px; background: #f2f2f2; border-radius: 20px; padding: 0 15px; font-size: 13.5px; box-sizing: border-box; }
.ph { color: #b0b0b0; }
.list { flex: 1; min-height: 0; padding: 0 16px 80px; box-sizing: border-box; }
.group { display: block; font-size: 12px; font-weight: 600; color: #333; margin: 6px 0 9px; }
.row { display: flex; align-items: center; gap: 12px; padding: 12px; background: #fff; border-radius: 12px; margin-bottom: 8px; }
.av { width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.nm { font-size: 14px; color: #222; }
.cd { font-size: 10.5px; color: #a8a8a8; letter-spacing: .5px; }
.last { font-size: 11.5px; color: #a0a0a0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0; }
.pres { font-size: 10.5px; color: #9a9a9a; }
.badge { min-width: 17px; height: 17px; border-radius: 9px; background: #c0504d; display: flex; align-items: center; justify-content: center; padding: 0 5px; }
.badge text { color: #fff; font-size: 10px; }
.none { padding: 50px 0; text-align: center; color: #b8b8b8; font-size: 12.5px; }

.chathead { display: flex; align-items: center; gap: 12px; padding: 13px 16px; background: #fff; border-bottom: 1px solid #f0f0f0; }
.back { font-size: 24px; color: #333; line-height: 24px; }
.chinfo { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; }
.chav { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
.chtext { display: flex; flex-direction: column; gap: 2px; }
.chname { font-size: 15px; font-weight: 600; }
.chpresence { font-size: 10.5px; color: #9a9a9a; }
.chmore { font-size: 20px; color: #9a9a9a; }
.msgs { flex: 1; min-height: 0; padding: 16px; box-sizing: border-box; }
.mline { display: flex; margin-bottom: 10px; }
.mline.me { justify-content: flex-end; }
.bubble { max-width: 76%; padding: 9px 12px; border-radius: 12px; background: #fff; display: flex; flex-direction: column; gap: 4px; }
.bubble.me { background: #1a1a1a; }
.btext { font-size: 13.5px; color: #222; line-height: 19px; }
.bubble.me .btext { color: #fff; }
.btime { font-size: 9.5px; color: #b0b0b0; align-self: flex-end; }
.bubble.me .btime { color: #8a8a8a; }
.composer { display: flex; gap: 9px; padding: 12px 16px 20px; background: #fff; }
.cinput { flex: 1; height: 42px; background: #f2f2f2; border-radius: 21px; padding: 0 15px; font-size: 13.5px; }
.send { padding: 0 18px; height: 42px; border-radius: 21px; background: #1a1a1a; display: flex; align-items: center; }
.send.dis { background: #cfcfcf; }
.send text { color: #fff; font-size: 13.5px; }
</style>
