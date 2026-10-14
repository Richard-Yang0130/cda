<template>
  <view class="shell">
    <!-- 侧边栏（PC）/ 顶部条（移动） -->
    <view class="side">
      <view class="brand">
        <text class="brand-name">搭 · CDA</text>
        <text class="brand-sub">管理后台</text>
      </view>
      <view class="nav">
        <view
          v-for="it in visibleNav"
          :key="it.url"
          class="nav-item"
          :class="{ on: current === it.url }"
          @click="go(it.url)"
        >
          <text>{{ it.label }}</text>
        </view>
      </view>
      <view class="foot">
        <text class="who">{{ admin?.nickname ?? admin?.username }} · {{ roleLabel }}</text>
        <text class="logout" @click="doLogout">退出登录</text>
      </view>
    </view>

    <view class="main">
      <slot />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminApi, errText, getAdminToken, setAdminToken } from '@/api/client'

/**
 * 管理后台外壳。
 *
 * 与 NavShell 分开写，因为两者定位不同：
 *   NavShell  —— 用户端，移动优先，有底部标签栏
 *   本组件    —— 管理端，PC 优先，只有侧边栏，且**带权限过滤与守卫**
 *
 * ⚠️ 权限过滤只用于**隐藏按钮**。后端每个接口都独立校验权限，
 *    前端隐藏不构成安全边界。
 */
const props = defineProps<{ current: string }>()

const admin = ref<any>(null)
const loading = ref(true)

const NAV = [
  { label: '数据看板', url: '/pages/admin/dashboard', perm: 'stats.read' },
  { label: '邀请码', url: '/pages/admin/invites', perm: 'invite.write' },
  { label: '用户', url: '/pages/admin/users', perm: 'user.read' },
  { label: '审计日志', url: '/pages/admin/logs', perm: 'audit.read' },
]

const roleLabel = computed(() =>
  ({ owner: '所有者', operator: '运营', viewer: '观察者' })[admin.value?.role as string] ?? '')

/** 按权限过滤菜单 —— viewer 看不到「邀请码」和「审计日志」 */
const visibleNav = computed(() => {
  const perms: string[] = admin.value?.perms ?? []
  return NAV.filter((n) => perms.includes(n.perm))
})

function go(url: string): void {
  if (url !== props.current) uni.reLaunch({ url })
}

async function doLogout(): Promise<void> {
  try { await adminApi.logout() } catch { /* 网络失败也照常清本地 */ }
  setAdminToken('')
  uni.reLaunch({ url: '/pages/admin/login' })
}

onMounted(async () => {
  // 守卫：没有 token 直接去登录页
  if (!getAdminToken()) {
    uni.reLaunch({ url: '/pages/admin/login' })
    return
  }
  try {
    const res = await adminApi.me()
    admin.value = res.admin
  } catch (e) {
    uni.showToast({ title: errText(e), icon: 'none' })
    setAdminToken('')
    uni.reLaunch({ url: '/pages/admin/login' })
  } finally {
    loading.value = false
  }
})

defineExpose({ admin, loading })
</script>

<style scoped>
.shell { min-height: 100vh; background: #f4f5f7; display: flex; }

.side {
  width: 190px; flex-shrink: 0; background: #fff;
  display: flex; flex-direction: column;
  border-right: 1px solid #ebedf0;
  position: sticky; top: 0; height: 100vh;
}
.brand { padding: 22px 18px 20px; }
.brand-name { font-size: 17px; font-weight: 700; display: block; letter-spacing: 1px; }
.brand-sub { font-size: 10.5px; color: #a8a8a8; margin-top: 3px; display: block; }
.nav { flex: 1; padding: 0 10px; }
.nav-item {
  padding: 11px 12px; border-radius: 9px; margin-bottom: 3px;
}
.nav-item text { font-size: 13.5px; color: #555; }
.nav-item.on { background: #1a1a1a; }
.nav-item.on text { color: #fff; font-weight: 600; }
.foot { padding: 16px 18px 20px; border-top: 1px solid #f2f4f6; }
.who { font-size: 11px; color: #9a9a9a; display: block; margin-bottom: 8px; }
.logout { font-size: 12px; color: #c0504d; }

.main { flex: 1; min-width: 0; padding: 26px 30px 50px; box-sizing: border-box; }

/* 窄屏：侧边栏变顶部横条 */
@media (max-width: 700px) {
  .shell { flex-direction: column; }
  .side { width: 100%; height: auto; position: static; flex-direction: row; align-items: center; border-right: none; border-bottom: 1px solid #ebedf0; }
  .brand { padding: 12px 14px; }
  .brand-sub { display: none; }
  .nav { display: flex; gap: 4px; padding: 0 8px; overflow-x: auto; }
  .nav-item { padding: 7px 12px; margin-bottom: 0; white-space: nowrap; }
  .foot { padding: 0 14px 0 0; border-top: none; }
  .who { display: none; }
  .main { padding: 16px 14px 40px; }
}
</style>
