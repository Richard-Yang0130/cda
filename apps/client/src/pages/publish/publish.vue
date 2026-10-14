<template>
  <NavShell current="/pages/publish/publish">
    <view class="page">
      <text class="title">发布</text>
      <text class="sub">发穿搭帖 · 或挂闲置单品</text>

      <view class="tabs">
        <view
          v-for="t in tabs"
          :key="t.id"
          class="tab"
          :class="{ on: mode === t.id }"
          @click="mode = t.id"
        >
          <text>{{ t.name }}</text>
        </view>
      </view>

      <textarea
        v-model="text"
        class="editor"
        :placeholder="mode === 'post' ? '分享这套搭配的思路…' : '描述单品成色、尺码、入手价…'"
        placeholder-class="ph"
        :maxlength="500"
      />
      <text class="count">{{ text.length }}/500</text>

      <view class="pics">
        <view v-for="n in 3" :key="n" class="pic" @click="pick(n)">
          <text class="pic-mark">＋</text>
        </view>
      </view>

      <view class="actions">
        <view class="primary" :class="{ dis: !canPost }" @click="submit">
          <text>{{ submitting ? '发布中…' : mode === 'post' ? '发布帖子' : '挂出闲置' }}</text>
        </view>
      </view>
      <text class="note">demo 阶段不落库；真实版本接后端</text>
    </view>
  </NavShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import NavShell from '@/components/NavShell.vue'
import { api, errText } from '@/api/client'

/** 帖子 / 闲置两种模式，对应「社区」与「二手交易」两条线 */
const tabs = [
  { id: 'post' as const, name: '发帖子' },
  { id: 'sell' as const, name: '卖闲置' },
]
const mode = ref<'post' | 'sell'>('post')
const text = ref('')
const canPost = computed(() => text.value.trim().length > 0)

function pick(n: number): void {
  uni.showToast({ title: `配图位 ${n}（demo 用纯色占位）`, icon: 'none' })
}

const submitting = ref(false)

/**
 * 发布到后端。
 * 封面暂时用纯色（demo 阶段没有图片上传），真实接入图片后
 * 这里换成上传返回的 URL 即可，接口字段不用改。
 */
async function submit(): Promise<void> {
  if (!canPost.value || submitting.value) {
    if (!canPost.value) uni.showToast({ title: '写点什么再发吧', icon: 'none' })
    return
  }
  submitting.value = true
  try {
    const palette = ['#c9b8a8', '#8fa3b0', '#a8b39a', '#b7a9c9', '#d3a9a0', '#c9a98a']
    await api.createPost({
      title: text.value.trim(),
      coverHex: palette[Math.floor(Math.random() * palette.length)],
      // kind 决定它出现在哪个分栏下
      kind: mode.value === 'sell' ? 'idle' : 'outfit',
      tags: mode.value === 'sell' ? ['闲置'] : ['穿搭'],
      ratio: 1 + Math.round(Math.random() * 4) / 10,
    })
    uni.showToast({ title: mode.value === 'post' ? '已发布' : '已挂出', icon: 'none' })
    text.value = ''
    setTimeout(() => uni.reLaunch({ url: '/pages/home/home' }), 800)
  } catch (e) {
    uni.showModal({ title: '发布失败', content: errText(e), showCancel: false })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.page {
  padding: 18px 16px 30px;
}
.title {
  font-size: 20px;
  font-weight: 700;
}
.sub {
  display: block;
  font-size: 11.5px;
  color: #a0a0a0;
  margin: 4px 0 16px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.tab {
  flex: 1;
  height: 36px;
  border-radius: 10px;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tab text {
  font-size: 13px;
  color: #666;
}
.tab.on {
  background: #1a1a1a;
}
.tab.on text {
  color: #fff;
  font-weight: 600;
}
.editor {
  width: 100%;
  height: 150px;
  background: #f7f5f2;
  border-radius: 12px;
  padding: 12px;
  font-size: 13.5px;
  line-height: 20px;
  box-sizing: border-box;
}
.ph {
  color: #b0b0b0;
}
.count {
  display: block;
  text-align: right;
  font-size: 11px;
  color: #b8b8b8;
  margin: 6px 0 12px;
}
.pics {
  display: flex;
  gap: 10px;
}
.pic {
  width: 78px;
  height: 78px;
  border-radius: 10px;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pic-mark {
  font-size: 22px;
  color: #c0c0c0;
}
.actions {
  margin-top: 22px;
}
.primary {
  height: 46px;
  border-radius: 12px;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
}
.primary.dis {
  background: #cfcfcf;
}
.primary text {
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
.note {
  display: block;
  text-align: center;
  font-size: 10.5px;
  color: #c0c0c0;
  margin-top: 14px;
}
</style>
