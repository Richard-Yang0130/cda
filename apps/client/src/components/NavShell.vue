<template>
  <view class="shell">
    <!-- PC / 平板：左侧边栏 -->
    <view class="side">
      <view class="brand"><text>搭</text><text class="brand-sub">CDA</text></view>
      <view
        v-for="it in items"
        :key="it.url"
        class="side-item"
        :class="{ on: current === it.url, plus: it.plus }"
        @click="go(it.url)"
      >
        <text class="si-label">{{ it.plus ? '＋ 发布' : it.label }}</text>
      </view>
    </view>

    <!-- 内容区 -->
    <view class="body">
      <slot />
    </view>

    <!-- 移动端：底部标签栏 -->
    <view class="tabbar">
      <view
        v-for="it in items"
        :key="it.url"
        class="tab"
        :class="{ on: current === it.url, plus: it.plus }"
        @click="go(it.url)"
      >
        <view v-if="it.plus" class="plus-btn"><text class="plus-mark">+</text></view>
        <text v-else class="tab-label">{{ it.short }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { store, restoreUser, restoreAddresses } from '@/store/app-store'

/**
 * 响应式导航外壳。
 *
 * 用户要求：移动端导航在底栏、PC web 端在侧边。
 * 这里用纯 CSS 媒体查询切换，而不是 uni-app 的 pages.json tabBar ——
 * 后者的样式与位置不可控，做不出「同一份代码两种布局」。
 *
 * 断点取 768px。
 */
const props = defineProps<{ current?: string }>()
const current = ref(props.current ?? '')

/**
 * 导航项。中间那个是「发布」，渲染成圆形 + 号 —— 闲鱼式的主操作按钮。
 * 「拍照导入」已并入衣橱（两者重复），不再单独占一个导航位。
 */
const items = [
  { label: '首页 · 发现', short: '首页', url: '/pages/home/home' },
  { label: '消息', short: '消息', url: '/pages/messages/messages' },
  { label: '发布', short: '＋', url: '/pages/publish/publish', plus: true },
  { label: '我的衣橱', short: '衣橱', url: '/pages/wardrobe/wardrobe' },
  { label: '个人主页', short: '我的', url: '/pages/profile/profile' },
]

/*
 * 鉴权守卫：未注册/未登录**不得进入主功能**，直接引导到注册。
 *
 * 放在 NavShell 而不是各页面，是因为主页面都用了这个外壳 ——
 * 一处拦截即全覆盖，新增页面也不会漏。
 */
onMounted(() => {
  restoreUser()
  restoreAddresses()
  if (!store.user) {
    uni.reLaunch({ url: '/pages/register/register' })
  }
})

function go(url: string): void {
  if (url === current.value) return
  uni.reLaunch({ url })
}
</script>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  background: #fbfbfb;
}
.body {
  flex: 1;
  min-width: 0;
  /* 给移动端底栏留出空间 */
  padding-bottom: 62px;
}

/* 移动端底栏 */
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 56px;
  display: flex;
  background: #ffffff;
  border-top: 1px solid #ececec;
  z-index: 20;
}
.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tab-label {
  font-size: 12px;
  color: #9a9a9a;
}
.tab.plus .plus-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: -14px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.22);
}
.plus-mark {
  color: #fff;
  font-size: 24px;
  line-height: 24px;
  margin-top: -2px;
}
.side-item.plus {
  background: #f2f2f2;
}
.side-item.plus .si-label {
  color: #1a1a1a;
  font-weight: 600;
}
.tab.on .tab-label {
  color: #1a1a1a;
  font-weight: 600;
}

/* PC 侧边栏：默认隐藏，宽屏才出现 */
.side {
  display: none;
  width: 180px;
  flex-shrink: 0;
  background: #ffffff;
  border-right: 1px solid #ececec;
  padding: 18px 12px;
  position: sticky;
  top: 0;
  height: 100vh;
  box-sizing: border-box;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 0 8px 18px;
}
.brand text:first-child {
  font-size: 22px;
  font-weight: 700;
}
.brand-sub {
  font-size: 11px;
  color: #b0b0b0;
  letter-spacing: 1px;
}
.side-item {
  padding: 10px 12px;
  border-radius: 10px;
  margin-bottom: 4px;
  cursor: pointer;
}
.si-label {
  font-size: 13.5px;
  color: #555;
}
.side-item.on {
  background: #1a1a1a;
}
.side-item.on .si-label {
  color: #fff;
  font-weight: 600;
}

@media (min-width: 768px) {
  .side {
    display: block;
  }
  .tabbar {
    display: none;
  }
  .body {
    padding-bottom: 0;
  }
}
</style>
