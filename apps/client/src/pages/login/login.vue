<template>
  <view class="page">
    <view class="card">
      <text class="logo">搭</text>
      <text class="brand">CDA</text>
      <text class="slogan">把你已有的衣服，穿出更多可能</text>

      <text class="lab">账号</text>
      <input
        v-model="account"
        class="inp"
        placeholder="手机号 / 邮箱 / 用户码"
        placeholder-class="ph"
        :maxlength="64"
      />

      <text class="lab">密码</text>
      <input
        v-model="password"
        class="inp"
        password
        placeholder="请输入密码"
        placeholder-class="ph"
        :maxlength="64"
        @confirm="submit"
      />

      <view class="btn" :class="{ dis: !canSubmit || loading }" @click="submit">
        <text>{{ loading ? '登录中…' : '登录' }}</text>
      </view>

      <text v-if="err" class="err">{{ err }}</text>

      <view class="foot">
        <text class="link" @click="goRegister">还没有账号？去注册</text>
      </view>
    </view>
    <text class="ver">v{{ version }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { APP_VERSION } from '@cda/core'
import { api, errText, setToken } from '@/api/client'
import { applyServerUser } from '@/store/app-store'

/**
 * 用户登录页。
 *
 * 与注册分开：老用户回访时**不该被扔进 6 步注册流程**。
 * 未登录访问任何主页面都会先到这里，再由此去注册。
 *
 * 与管理员登录也是分开的：两套独立接口与 token，互不影响。
 */
const account = ref('')
const password = ref('')
const loading = ref(false)
const err = ref('')
const version = APP_VERSION

const canSubmit = computed(() => account.value.trim().length > 0 && password.value.length > 0)

async function submit(): Promise<void> {
  if (!canSubmit.value || loading.value) return
  loading.value = true
  err.value = ''
  try {
    const res = await api.login(account.value.trim(), password.value)
    setToken(res.token)
    applyServerUser(res.user)
    uni.reLaunch({ url: '/pages/home/home' })
  } catch (e) {
    err.value = errText(e)
  } finally {
    loading.value = false
  }
}

function goRegister(): void {
  uni.reLaunch({ url: '/pages/register/register' })
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #fbfbfb;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}
.card {
  width: 100%;
  max-width: 360px;
  background: #fff;
  border-radius: 20px;
  padding: 36px 28px 24px;
  box-sizing: border-box;
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
}
.logo {
  font-size: 40px;
  font-weight: 800;
  text-align: center;
  line-height: 44px;
}
.brand {
  font-size: 12px;
  color: #b0b0b0;
  text-align: center;
  letter-spacing: 4px;
  margin-top: 2px;
}
.slogan {
  font-size: 11.5px;
  color: #a8a8a8;
  text-align: center;
  margin: 14px 0 30px;
}
.lab { font-size: 12px; color: #666; margin-bottom: 7px; }
.inp {
  height: 46px;
  background: #f5f6f8;
  border-radius: 11px;
  padding: 0 15px;
  font-size: 14px;
  margin-bottom: 16px;
  box-sizing: border-box;
}
.ph { color: #b0b0b0; }
.btn {
  height: 46px;
  border-radius: 11px;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 6px;
}
.btn.dis { background: #cfcfcf; }
.btn text { color: #fff; font-size: 15px; font-weight: 600; }
.err {
  font-size: 12px;
  color: #c0504d;
  text-align: center;
  margin-top: 12px;
  line-height: 17px;
}
.foot { margin-top: 20px; display: flex; justify-content: center; }
.link { font-size: 12.5px; color: #4a7fa5; }
.ver { font-size: 10.5px; color: #c8c8c8; margin-top: 22px; }
</style>
