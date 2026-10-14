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

      <!-- 内容分栏：穿搭贴与闲置贴分开浏览（发布时选择类型） -->
      <view class="kinds">
        <text v-for="k in kinds" :key="k.v" class="kind" :class="{ on: kind === k.v }" @click="switchKind(k.v)">{{ k.n }}</text>
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

      <view v-if="!shown.length" class="empty">
        <text>{{ kind === 'idle' ? '还没有人挂闲置' : kind === 'outfit' ? '还没有穿搭帖' : '还没有内容' }}</text>
      </view>
      <view class="more" @click="loadPosts(false)">
        <text>{{ loading ? '加载中…' : hasMore ? '加载更多' : '没有更多了' }}</text>
      </view>
    </view>
  </NavShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { Post } from '@cda/core'
import { api, errText } from '@/api/client'
import NavShell from '@/components/NavShell.vue'

/**
 * 首页 = 搜索 + 帖子流（参考闲鱼移动端）。
 *
 * 封面用纯色 + 宽高比做占位：
 * demo 阶段不引入二进制图片资源，但**保留错落的宽高比**，
 * 否则瀑布流的视觉节奏验证不出来。
 */
const keyword = ref('')
const kinds = [
  { n: '全部', v: '' },
  { n: '穿搭', v: 'outfit' },
  { n: '闲置', v: 'idle' },
]
const kind = ref('')
const cats = ['推荐', '通勤', '叠穿', '小个子', '男装', '配饰']
const activeCat = ref('推荐')

/**
 * 帖子来自后端。分页用 offset 累加，下拉到底再拉下一页。
 * 搜索是**本地过滤已加载的帖子** —— 后端没做全文检索（10 人规模不值得），
 * 真要搜全部内容时应改成后端接口。
 */
const all = ref<Post[]>([])
const loading = ref(false)
const hasMore = ref(true)
const nextOffset = ref(0)

async function loadPosts(reset = false): Promise<void> {
  if (loading.value) return
  if (!reset && !hasMore.value) return
  loading.value = true
  try {
    const offset = reset ? 0 : nextOffset.value
    const res = await api.posts(20, offset, kind.value)
    const list = (res.posts ?? []) as Post[]
    all.value = reset ? list : [...all.value, ...list]
    hasMore.value = !!res.hasMore
    nextOffset.value = res.nextOffset ?? all.value.length
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  } finally {
    loading.value = false
  }
}

function switchKind(v: string): void {
  if (kind.value === v) return
  kind.value = v
  void loadPosts(true)   // 换分栏要重新从第一页拉
}

onShow(() => {
  void loadPosts(true)
})

const shown = computed(() => {
  const k = keyword.value.trim()
  if (!k) return all.value
  return all.value.filter(
    (p) => (p.title ?? '').includes(k) || (p.author ?? '').includes(k) || (p.tags ?? []).some((t) => t.includes(k)),
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

.kinds { display: flex; gap: 6px; margin-top: 14px; }
.kind { font-size: 13px; color: #666; padding: 7px 18px; border-radius: 999px; background: #f2f2f2; }
.kind.on { background: #1a1a1a; color: #fff; font-weight: 600; }
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
.empty { padding: 50px 0; text-align: center; }
.empty text { font-size: 13px; color: #b0b0b0; }
.more { padding: 18px 0 4px; text-align: center; }
.more text { font-size: 12px; color: #9a9a9a; }
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
