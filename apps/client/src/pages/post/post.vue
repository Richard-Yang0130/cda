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
            <view class="pgo" @click="tryOn">
              <text>试穿</text>
            </view>
          </view>

          <view class="actions">
            <view class="act" @click="like"><text>♡ 喜欢</text></view>
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
import { findPost, findProduct, formatPrice, type Post } from '@cda/core'
import NavShell from '@/components/NavShell.vue'
import { store, addWardrobeItem, hasProduct } from '@/store/app-store'

const post = ref<Post | null>(null)
const liked = ref(false)

onLoad((q) => {
  const id = (q as { id?: string } | undefined)?.id
  post.value = id ? (findPost(id) ?? null) : null
})

const product = computed(() => (post.value?.linkedProductId ? findProduct(post.value.linkedProductId) : undefined))
const swatch = computed(() => product.value?.colors[0]?.hex ?? '#dddddd')

function like(): void {
  if (!post.value || liked.value) return
  liked.value = true
  post.value.likes += 1
  uni.showToast({ title: '已喜欢', icon: 'none' })
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
