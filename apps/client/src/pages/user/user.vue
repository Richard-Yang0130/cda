<template>
  <view class="page">
    <view class="hero">
      <view class="av" :style="{ background: u.hex }" />
      <view class="who">
        <view class="nameline">
          <text class="name">{{ u.name }}</text>
          <text v-if="presence" class="presence">{{ presence }}</text>
        </view>
        <text class="code">{{ u.code }}</text>
        <text class="meta">{{ regionText }}</text>
      </view>
    </view>

    <view class="btns">
      <view class="btn" :class="{ on: following }" @click="toggleFollow">
        <text>{{ following ? '已关注' : '＋ 关注' }}</text>
      </view>
      <view class="btn ghost" @click="openChat"><text>私聊</text></view>
      <view class="btn ghost" @click="more"><text>⋯</text></view>
    </view>

    <view class="stats">
      <view v-for="s in stats" :key="s.label" class="stat">
        <text class="sv">{{ s.value }}</text>
        <text class="sl">{{ s.label }}</text>
      </view>
    </view>

    <template v-if="styles.length || brands.length">
      <text class="group">风格与品牌</text>
      <view class="chips">
        <text v-for="s in styles" :key="s" class="chip dark">{{ s }}</text>
        <text v-for="b in brands" :key="b" class="chip">{{ b }}</text>
      </view>
    </template>

    <text class="group">TA 的动态</text>
    <view class="plist">
      <view v-for="po in posts" :key="po.id" class="pitem" @click="openPost(po.id)">
        <view class="pthumb" :style="{ background: po.coverHex }" />
        <view class="pbody">
          <text class="pt">{{ po.title }}</text>
          <text class="pm">♡ {{ po.likes }} · 💬 {{ po.comments }}</text>
        </view>
      </view>
      <view v-if="!posts.length" class="none"><text>暂时没有公开动态</text></view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { FASHION_STYLES, findBrand, mockPosts, presenceText, type UserProfile } from '@cda/core'
import { store } from '@/store/app-store'

/**
 * 他人主页。
 *
 * 从消息页的会话头部点进来 —— 用户反馈「私聊界面没有入口进入他人主页」。
 * 数据现为演示：按用户码生成一个稳定的假资料，同一个人每次进来一致。
 */
const code = ref('')
const following = ref(false)

/** 用用户码做种子的伪随机，保证同一用户每次显示一致 */
function seeded(s: string, n: number, mod: number): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000
  return (h * (n + 7)) % mod
}

const u = computed(() => {
  const c = code.value || 'CDA_00000000'
  const palette = ['#c9b8a8', '#8fa3b0', '#a8b39a', '#b7a9c9', '#d3a9a0', '#c9a98a']
  return {
    code: c,
    name: c === 'CDA_00000007' ? '林' : c === 'CDA_00000012' ? '阿泽' : `用户${c.slice(-4)}`,
    hex: palette[seeded(c, 1, palette.length)]!,
    isOnline: seeded(c, 2, 3) !== 0,
    lastSeenAt: new Date(Date.now() - seeded(c, 3, 72) * 3600e3).toISOString(),
    privacy: { hideFromSearch: false, hideOnlineStatus: false, hideRegion: false, allowStrangerMessage: true },
    region: '中国',
  }
})

const presence = computed(() =>
  presenceText(u.value as unknown as Pick<UserProfile, 'isOnline' | 'lastSeenAt' | 'privacy'>),
)
const regionText = computed(() => u.value.region)

const styles = computed(() =>
  FASHION_STYLES.filter((_, i) => seeded(code.value, i + 11, 4) === 0).slice(0, 3).map((s) => s.name),
)
const brands = computed(() =>
  ['b_cos', 'b_nike', 'b_arcteryx', 'b_uniqlo', 'b_lululemon']
    .filter((_, i) => seeded(code.value, i + 21, 3) === 0)
    .map((id) => findBrand(id)?.nameEn ?? id),
)
const posts = computed(() => mockPosts.filter((_, i) => seeded(code.value, i + 31, 3) === 0))

const stats = computed(() => [
  { label: '动态', value: posts.value.length },
  { label: '关注', value: seeded(code.value, 41, 200) },
  { label: '粉丝', value: seeded(code.value, 51, 900) },
])

onLoad((q) => {
  code.value = (q as { code?: string } | undefined)?.code ?? ''
})

function toggleFollow(): void {
  following.value = !following.value
  uni.showToast({ title: following.value ? '已关注' : '已取消关注', icon: 'none' })
}

function openChat(): void {
  uni.navigateTo({ url: `/pages/messages/messages?code=${u.value.code}` })
}

function openPost(id: string): void {
  uni.navigateTo({ url: `/pages/post/post?id=${id}` })
}

function more(): void {
  uni.showActionSheet({
    itemList: ['加入黑名单', '举报', '分享'],
    success: (r) => {
      uni.showToast({ title: ['已加入黑名单', '已提交举报', '已分享'][r.tapIndex] ?? '', icon: 'none' })
    },
  })
}

void store
</script>

<style scoped>
.page { min-height: 100vh; background: #fbfbfb; padding: 18px 16px 40px; box-sizing: border-box; }
.hero { display: flex; align-items: center; gap: 14px; }
.av { width: 62px; height: 62px; border-radius: 50%; flex-shrink: 0; }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.nameline { display: flex; align-items: center; gap: 8px; }
.name { font-size: 18px; font-weight: 700; }
.presence { font-size: 10px; color: #4a9d4a; background: #eef7ee; padding: 2px 7px; border-radius: 8px; }
.code { font-size: 11px; color: #a0a0a0; letter-spacing: 1px; }
.meta { font-size: 11px; color: #9a9a9a; }
.btns { display: flex; gap: 10px; margin-top: 18px; }
.btn { flex: 1; height: 40px; border-radius: 11px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.btn.on { background: #f2f2f2; }
.btn.on text { color: #555; }
.btn.ghost { background: #f2f2f2; flex: 0 0 74px; }
.btn.ghost text { color: #555; }
.btn text { color: #fff; font-size: 13.5px; font-weight: 600; }
.stats { display: flex; background: #fff; border-radius: 13px; padding: 14px 0; margin-top: 18px; box-shadow: 0 1px 8px rgba(0,0,0,.04); }
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.sv { font-size: 17px; font-weight: 700; }
.sl { font-size: 10.5px; color: #a0a0a0; }
.group { display: block; font-size: 12px; font-weight: 600; color: #333; margin: 20px 0 9px; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; }
.chip { font-size: 11.5px; color: #555; background: #f2f2f2; padding: 5px 12px; border-radius: 999px; }
.chip.dark { background: #1a1a1a; color: #fff; }
.plist { display: flex; flex-direction: column; gap: 9px; }
.pitem { display: flex; align-items: center; gap: 11px; background: #fff; border-radius: 12px; padding: 10px; box-shadow: 0 1px 7px rgba(0,0,0,.04); }
.pthumb { width: 52px; height: 52px; border-radius: 9px; flex-shrink: 0; }
.pbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.pt { font-size: 12.5px; color: #222; line-height: 17px; }
.pm { font-size: 10.5px; color: #a0a0a0; }
.none { padding: 26px 0; text-align: center; color: #b8b8b8; font-size: 12px; }
</style>
