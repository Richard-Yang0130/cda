<template>
  <NavShell current="/pages/home/home">
    <view class="wrap">
      <!-- 搜索 -->
      <view class="search">
        <view class="sbox">
          <text class="sicon">⌕</text>
          <input
            v-model="keyword"
            class="sinput"
            placeholder="搜单品、穿搭、用户"
            placeholder-class="sph"
            confirm-type="search"
            @confirm="doSearch"
          />
          <text v-if="keyword" class="sclear" @click="keyword = ''">✕</text>
        </view>
        <view class="sgo" @click="doSearch"><text>搜索</text></view>
      </view>

      <!-- 分类 -->
      <scroll-view class="cats" scroll-x>
        <view
          v-for="c in cats"
          :key="c"
          class="cat"
          :class="{ on: activeCat === c }"
          @click="activeCat = c"
        >
          <text>{{ c }}</text>
        </view>
      </scroll-view>

      <!-- 双列瀑布流 -->
      <view class="feed">
        <view class="col">
          <view v-for="po in leftCol" :key="po.id" class="post" @click="openPost(po)">
            <view class="cover" :style="coverStyle(po)">
              <text class="cover-tag">{{ po.tags[0] }}</text>
            </view>
            <text class="ptitle">{{ po.title }}</text>
            <view class="prow">
              <view class="pavatar" :style="{ background: po.avatarHex }" />
              <text class="pauthor">{{ po.author }}</text>
              <text class="pstat">♡ {{ po.likes }} · 💬 {{ po.comments }}</text>
            </view>
          </view>
        </view>
        <view class="col">
          <view v-for="po in rightCol" :key="po.id" class="post" @click="openPost(po)">
            <view class="cover" :style="coverStyle(po)">
              <text class="cover-tag">{{ po.tags[0] }}</text>
            </view>
            <text class="ptitle">{{ po.title }}</text>
            <view class="prow">
              <view class="pavatar" :style="{ background: po.avatarHex }" />
              <text class="pauthor">{{ po.author }}</text>
              <text class="pstat">♡ {{ po.likes }} · 💬 {{ po.comments }}</text>
            </view>
          </view>
        </view>
      </view>

      <text class="foot-note">帖子为演示数据 · 真实版本接后端分页</text>
    </view>
  </NavShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { mockPosts, type Post } from '@cda/core'
import NavShell from '@/components/NavShell.vue'

/**
 * 首页 = 搜索 + 帖子流（参考闲鱼移动端）。
 *
 * 封面用纯色 + 宽高比做占位：
 * demo 阶段不引入二进制图片资源，但**保留错落的宽高比**，
 * 否则瀑布流的视觉节奏验证不出来。
 */
const keyword = ref('')
const cats = ['推荐', '通勤', '叠穿', '小个子', '男装', '配饰']
const activeCat = ref('推荐')

const shown = computed(() => {
  const k = keyword.value.trim()
  if (!k) return mockPosts
  return mockPosts.filter(
    (p) => p.title.includes(k) || p.author.includes(k) || p.tags.some((t) => t.includes(k)),
  )
})

// 按顺序交替分到两列，形成瀑布流
const leftCol = computed(() => shown.value.filter((_, i) => i % 2 === 0))
const rightCol = computed(() => shown.value.filter((_, i) => i % 2 === 1))

function coverStyle(po: Post): Record<string, string> {
  return { background: po.coverHex, paddingTop: `${Math.round(po.ratio * 100)}%` }
}

function doSearch(): void {
  // 搜索按标签/标题过滤已在 computed 里完成，这里只做提示
  if (!shown.value.length) {
    uni.showToast({ title: '没有找到相关帖子', icon: 'none' })
  }
}

function openPost(po: Post): void {
  uni.navigateTo({ url: `/pages/post/post?id=${po.id}` })
}
</script>

<style scoped>
.wrap {
  padding: 14px 14px 24px;
}
.search {
  display: flex;
  gap: 8px;
  align-items: center;
}
.sbox {
  flex: 1;
  height: 38px;
  background: #f2f2f2;
  border-radius: 19px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 6px;
}
.sicon {
  font-size: 16px;
  color: #9a9a9a;
}
.sinput {
  flex: 1;
  font-size: 13px;
  height: 38px;
  line-height: 38px;
}
.sph {
  color: #b0b0b0;
}
.sclear {
  font-size: 12px;
  color: #b0b0b0;
}
.sgo {
  height: 38px;
  padding: 0 16px;
  border-radius: 19px;
  background: #1a1a1a;
  display: flex;
  align-items: center;
}
.sgo text {
  color: #fff;
  font-size: 13px;
}

.cats {
  white-space: nowrap;
  margin: 12px 0 10px;
}
.cat {
  display: inline-block;
  padding: 5px 13px;
  border-radius: 999px;
  background: #f2f2f2;
  margin-right: 7px;
}
.cat text {
  font-size: 12px;
  color: #666;
}
.cat.on {
  background: #1a1a1a;
}
.cat.on text {
  color: #fff;
}

.feed {
  display: flex;
  gap: 10px;
}
.col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.post {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.05);
}
.cover {
  width: 100%;
  height: 0;
  position: relative;
}
.cover-tag {
  position: absolute;
  left: 8px;
  top: 8px;
  font-size: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.35);
  padding: 2px 7px;
  border-radius: 8px;
}
.ptitle {
  display: block;
  font-size: 12.5px;
  line-height: 18px;
  color: #222;
  padding: 9px 10px 0;
}
.prow {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px 10px;
}
.pavatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}
.pauthor {
  font-size: 10.5px;
  color: #8a8a8a;
}
.pstat {
  font-size: 10px;
  color: #b0b0b0;
  margin-left: auto;
}
.foot-note {
  display: block;
  text-align: center;
  font-size: 10.5px;
  color: #c0c0c0;
  padding: 18px 0 4px;
}

/*
 * 宽屏下两列会变得很宽，按比例撑开的封面会高得离谱（实测占满整屏）。
 * 这里给封面一个固定高度上限，宽屏下退化成规则网格 ——
 * 瀑布流的错落在窄屏才好看，宽屏更该信息密度高。
 */
@media (min-width: 768px) {
  .cover {
    padding-top: 170px !important;
  }
  .feed {
    gap: 14px;
  }
}
</style>
