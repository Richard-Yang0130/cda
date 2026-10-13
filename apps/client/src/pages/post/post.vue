<template>
  <NavShell current="/pages/home/home">
    <view class="page">
      <template v-if="post">
        <view class="cover" :style="{ background: post.coverHex }" />

        <view class="body">
          <text class="title">{{ post.title }}</text>

          <view class="tags">
            <text v-for="t in post.tags" :key="t" class="tag">#{{ t }}</text>
          </view>

          <view class="author">
            <view class="avatar" :style="{ background: post.avatarHex }" />
            <text class="aname">{{ post.author }}</text>
            <text class="stat">♡ {{ post.likes }} · 💬 {{ post.comments }}</text>
          </view>

          <!-- 关联单品：闲鱼式「看中就能试」 -->
          <view v-if="product" class="product">
            <view class="pcover" :style="{ background: swatch }" />
            <view class="pinfo">
              <text class="ptitle">{{ product.title }}</text>
              <text class="pprice">¥{{ formatPrice(product.priceCents) }}</text>
            </view>
            <view class="pbtns">
              <view class="pgo ghost" @click="tryOn"><text>试穿</text></view>
              <view class="pgo" @click="buy"><text>购买</text></view>
            </view>
          </view>

          <!-- 评论 -->
          <text class="c-title">评论 {{ comments.length }}</text>
          <view class="c-input">
            <input v-model="commentText" class="c-inp" placeholder="说点什么…" placeholder-class="ph" @confirm="submitComment" />
            <view class="c-send" :class="{ dis: !commentText.trim() }" @click="submitComment"><text>发送</text></view>
          </view>
          <view v-for="c in comments" :key="c.id" class="c-item">
            <view class="c-av" :style="{ background: c.avatarHex }" />
            <view class="c-body">
              <text class="c-name">{{ c.author }}</text>
              <text class="c-text">{{ c.text }}</text>
            </view>
          </view>
          <view v-if="!comments.length" class="c-none"><text>还没有评论</text></view>

          <view class="actions">
            <view class="act" @click="like"><text>♡ 喜欢</text></view>
            <view class="act" @click="favorite"><text>☆ 收藏</text></view>
            <view class="act" @click="collect"><text>＋ 加入衣橱</text></view>
          </view>
        </view>
      </template>

      <view v-else class="empty">
        <text>帖子不存在</text>
      </view>
    </view>
  </NavShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { findProduct, formatPrice, type Post } from '@cda/core'
import { api, errText } from '@/api/client'
import NavShell from '@/components/NavShell.vue'
import { store, addWardrobeItem, hasProduct } from '@/store/app-store'

const post = ref<Post | null>(null)
const liked = ref(false)

const comments = ref<Array<{ id: string; text: string; author: string; avatarHex: string }>>([])
const commentText = ref('')
const loading = ref(true)

onLoad(async (q) => {
  const id = (q as { id?: string } | undefined)?.id
  if (!id) { loading.value = false; return }
  try {
    const res = await api.post(id)
    post.value = res.post as Post
    liked.value = !!res.post?.likedByMe
    const cs = await api.comments(id)
    comments.value = cs.comments ?? []
  } catch (e) {
    post.value = null
    uni.showToast({ title: errText(e), icon: 'none' })
  } finally {
    loading.value = false
  }
})

async function submitComment(): Promise<void> {
  const text = commentText.value.trim()
  if (!text || !post.value) return
  try {
    const res = await api.addComment(post.value.id, text)
    comments.value.unshift(res.comment)
    if (post.value) post.value.comments = res.commentCount
    commentText.value = ''
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  }
}

const product = computed(() => (post.value?.linkedProductId ? findProduct(post.value.linkedProductId) : undefined))
const swatch = computed(() => product.value?.colors[0]?.hex ?? '#dddddd')

/** 点赞：走后端，计数以服务端为准（避免多人同时点时前端算错） */
async function like(): Promise<void> {
  if (!post.value) return
  try {
    const res = await api.like(post.value.id)
    liked.value = res.liked
    post.value.likes = res.likes
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  }
}

async function favorite(): Promise<void> {
  if (!post.value) return
  try {
    const res = await api.favorite(post.value.id)
    uni.showToast({ title: res.favorited ? '已收藏' : '已取消收藏', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
  }
}

function collect(): void {
  const p = product.value
  if (!p) return
  if (hasProduct(p.id)) {
    uni.showToast({ title: '已在衣橱里', icon: 'none' })
    return
  }
  addWardrobeItem({
    productId: p.id,
    colorId: p.colors[0]?.id ?? 'default',
    size: p.sizes[0] ?? 'M',
    source: 'manual',
    note: '来自帖子',
  })
  uni.showToast({ title: '已加入衣橱', icon: 'none' })
}

/** 购买：进入确认支付页（当前为演示，未接入真实支付） */
function buy(): void {
  const p = product.value
  if (!p) return
  uni.navigateTo({ url: `/pages/pay/pay?productId=${p.id}` })
}

/** 试穿：写入待试穿单品后跳到 3D 试穿台 */
function tryOn(): void {
  const p = product.value
  if (!p) return
  store.pendingOutfit = [p.id]
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped>
.page {
  padding-bottom: 24px;
}
.cover {
  width: 100%;
  height: 320px;
}
.body {
  padding: 16px 16px 0;
}
.title {
  font-size: 17px;
  font-weight: 600;
  line-height: 24px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0 14px;
}
.tag {
  font-size: 12px;
  color: #4a7fa5;
}
.author {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
}
.aname {
  font-size: 13px;
  color: #333;
}
.stat {
  margin-left: auto;
  font-size: 11.5px;
  color: #a8a8a8;
}
.product {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 12px;
  background: #f7f5f2;
  border-radius: 12px;
}
.pcover {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  flex-shrink: 0;
}
.pinfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ptitle {
  font-size: 13px;
  color: #222;
}
.pprice {
  font-size: 13px;
  font-weight: 600;
}
.pbtns {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.pgo.ghost {
  background: #ffffff;
  border: 1px solid #dddddd;
}
.pgo.ghost text {
  color: #333;
}
.pgo {
  height: 34px;
  padding: 0 16px;
  border-radius: 17px;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.pgo text {
  color: #fff;
  font-size: 13px;
}
.c-title { display: block; font-size: 13.5px; font-weight: 600; margin: 22px 0 10px; }
.c-input { display: flex; gap: 9px; margin-bottom: 14px; }
.c-inp { flex: 1; height: 40px; background: #f2f2f2; border-radius: 20px; padding: 0 15px; font-size: 13.5px; box-sizing: border-box; }
.ph { color: #b0b0b0; }
.c-send { padding: 0 17px; height: 40px; border-radius: 20px; background: #1a1a1a; display: flex; align-items: center; }
.c-send.dis { background: #cfcfcf; }
.c-send text { color: #fff; font-size: 13px; }
.c-item { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f6f6f6; }
.c-av { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; }
.c-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.c-name { font-size: 11.5px; color: #9a9a9a; }
.c-text { font-size: 13px; color: #222; line-height: 19px; }
.c-none { padding: 22px 0; text-align: center; color: #b8b8b8; font-size: 12px; }
.actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
.act {
  flex: 1;
  height: 42px;
  border-radius: 12px;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}
.act text {
  font-size: 13.5px;
  color: #333;
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: #b0b0b0;
  font-size: 13px;
}
</style>
