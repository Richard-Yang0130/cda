<template>
  <view class="wrap">
    <view class="card">
      <text class="logo">搭 · CDA</text>
      <text class="sub">管理后台</text>

      <text class="lab">管理员账号</text>
      <input v-model="username" class="inp" placeholder="用户名" placeholder-class="ph" :maxlength="32" />

      <text class="lab">密码</text>
      <input v-model="password" class="inp" password placeholder="至少 12 位" placeholder-class="ph" :maxlength="64" @confirm="submit" />

      <view class="btn" :class="{ dis: !canSubmit }" @click="submit">
        <text>{{ loading ? '登录中…' : '登录' }}</text>
      </view>

      <text v-if="err" class="err">{{ err }}</text>
      <text class="note">仅限授权人员使用。所有操作都会被记录。</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminApi, errText, setAdminToken } from '@/api/client'

/**
 * 管理后台登录。
 *
 * 与用户登录完全独立：独立接口、独立 token（存在另一个 key）、
 * 独立会话表。用户 token 在这里一定解析不出管理员。
 */
const username = ref('')
const password = ref('')
const loading = ref(false)
const err = ref('')

const canSubmit = computed(() => username.value.trim().length > 0 && password.value.length > 0)

async function submit(): Promise<void> {
  if (!canSubmit.value || loading.value) return
  loading.value = true
  err.value = ''
  try {
    const res = await adminApi.login(username.value.trim(), password.value)
    setAdminToken(res.token)
    uni.reLaunch({ url: '/pages/admin/dashboard' })
  } catch (e) {
    err.value = errText(e)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.wrap {
  min-height: 100vh;
  background: #f4f5f7;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}
.card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px 24px;
  box-sizing: border-box;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.07);
  display: flex;
  flex-direction: column;
}
.logo { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
.sub { font-size: 12px; color: #9a9a9a; margin: 4px 0 26px; }
.lab { font-size: 12px; color: #666; margin-bottom: 7px; }
.inp {
  height: 44px; background: #f5f6f8; border-radius: 10px; padding: 0 14px;
  font-size: 14px; margin-bottom: 16px; box-sizing: border-box;
}
.ph { color: #b0b0b0; }
.btn {
  height: 46px; border-radius: 10px; background: #1a1a1a;
  display: flex; align-items: center; justify-content: center; margin-top: 6px;
}
.btn.dis { background: #cfcfcf; }
.btn text { color: #fff; font-size: 15px; font-weight: 600; }
.err { font-size: 12px; color: #c0504d; margin-top: 12px; text-align: center; }
.note { font-size: 10.5px; color: #b8b8b8; margin-top: 18px; text-align: center; line-height: 16px; }
</style>
