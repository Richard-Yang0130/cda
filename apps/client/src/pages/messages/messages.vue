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
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { presenceText, type UserProfile } from '@cda/core'
import { store } from '@/store/app-store'

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

/** 演示用的其他用户（真实实现应由搜索接口返回） */
const peers: Array<Pick<UserProfile, 'code' | 'nickname' | 'avatarHex' | 'isOnline' | 'lastSeenAt' | 'privacy'>> = [
  { code: 'CDA_00000007', nickname: '林', avatarHex: '#c9b8a8', isOnline: true, lastSeenAt: new Date().toISOString(), privacy: { hideFromSearch: false, hideOnlineStatus: false, hideRegion: false, allowStrangerMessage: true } },
  { code: 'CDA_00000012', nickname: '阿泽', avatarHex: '#8fa3b0', isOnline: false, lastSeenAt: new Date(Date.now() - 3600e3).toISOString(), privacy: { hideFromSearch: false, hideOnlineStatus: false, hideRegion: false, allowStrangerMessage: true } },
  { code: 'CDA_00000033', nickname: '小满', avatarHex: '#d3a9a0', isOnline: false, lastSeenAt: new Date(Date.now() - 86400e3 * 2).toISOString(), privacy: { hideFromSearch: false, hideOnlineStatus: false, hideRegion: false, allowStrangerMessage: true } },
]

/*
 * 历史消息持久化。
 * 之前会话只存在内存里，**刷新页面聊天记录就没了** ——
 * 用户明确要求「能读历史消息记录」。
 * 真实版本由后端存；这里先落本地，接后端时只换这一层。
 */
const CONV_KEY = 'cda.conversations.v1'

function saveConvs(): void {
  try {
    uni.setStorageSync(CONV_KEY, JSON.stringify(convs.value))
  } catch {
    /* 存储不可用时静默降级，不阻断聊天 */
  }
}

function loadConvs(): Conv[] | null {
  try {
    const raw = uni.getStorageSync(CONV_KEY)
    if (!raw) return null
    const list = JSON.parse(raw as string) as Conv[]
    return Array.isArray(list) && list.length ? list : null
  } catch {
    return null
  }
}

/** 首次进入的示例会话（仅在本地无记录时使用） */
const seedConvs: Conv[] = [
  {
    id: 'c1', name: '林', code: 'CDA_00000007', hex: '#c9b8a8',
    presence: presenceText(peers[0]!), unread: 1,
    messages: [
      { id: 'm1', text: '你那件白衬衫是哪家的？', time: '10:20', fromMe: false },
      { id: 'm2', text: '基础款那件，我发链接给你', time: '10:22', fromMe: true },
    ],
  },
  {
    id: 'c2', name: '阿泽', code: 'CDA_00000012', hex: '#8fa3b0',
    presence: presenceText(peers[1]!), unread: 0,
    messages: [{ id: 'm3', text: '牛仔外套还有 M 码吗', time: '昨天', fromMe: false }],
  },
]

const convs = ref<Conv[]>(seedConvs)

// 页面显示时读取本地记录（这样从聊天返回列表也能看到最新消息）
onShow(() => {
  const saved = loadConvs()
  if (saved) convs.value = saved
})

/** 搜索：昵称或用户码，且尊重对方的「不被搜索到」隐私设置 */
const found = computed(() => {
  const k = kw.value.trim().toLowerCase()
  if (!k) return []
  return peers
    .filter((p) => !p.privacy.hideFromSearch)
    .filter(
      (p) =>
        p.nickname.toLowerCase().includes(k) || p.code.toLowerCase().includes(k),
    )
    .map((p) => ({
      id: p.code,
      name: p.nickname,
      code: p.code,
      hex: p.avatarHex,
      presence: presenceText(p),
      peer: p,
    }))
})

function openChat(u: { id: string; name: string; code: string; hex: string; presence: string }): void {
  const existing = convs.value.find((c) => c.code === u.code)
  if (existing) {
    active.value = existing
    existing.unread = 0
    saveConvs()
    return
  }
  const conv: Conv = {
    id: `c_${u.code}`, name: u.name, code: u.code, hex: u.hex,
    presence: u.presence, unread: 0, messages: [],
  }
  convs.value.push(conv)
  saveConvs()
  active.value = conv
}

/** 进入会话时滚到最新一条，方便续读历史 */
function openConv(c: Conv): void {
  active.value = c
  c.unread = 0
  saveConvs()
  // 延后触发，等消息渲染完
  setTimeout(() => (scrollTop.value += 100000), 120)
}

function send(): void {
  const text = draft.value.trim()
  const c = active.value
  if (!text || !c) return
  c.messages.push({
    id: `m_${Date.now().toString(36)}`,
    text,
    time: new Date().toTimeString().slice(0, 5),
    fromMe: true,
  })
  draft.value = ''
  saveConvs() // 落盘，刷新后仍在
  scrollTop.value += 1000 // 触发滚动到底
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
