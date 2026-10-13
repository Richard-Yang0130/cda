<template>
  <view v-if="visible" class="mask" @click="close">
    <view class="sheet" @click.stop>
      <view class="head">
        <view class="badge" :class="{ major: note?.major }">{{ note?.major ? '重要更新' : '更新' }}</view>
        <text class="ver">v{{ note?.version }}</text>
        <text class="date">{{ note?.date }}</text>
      </view>

      <text class="title">这次更新了什么</text>
      <scroll-view class="list" scroll-y>
        <view v-for="(h, i) in note?.highlights ?? []" :key="i" class="item">
          <text class="dot">•</text>
          <text class="txt">{{ h }}</text>
        </view>
      </scroll-view>

      <view class="btn" @click="close"><text>知道了</text></view>
      <text class="foot">{{ APP_NAME }} · v{{ APP_VERSION }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  APP_NAME, APP_VERSION, VERSION_STORAGE_KEY, checkRelease, type ReleaseNote,
} from '@cda/core'

/**
 * 更新说明弹窗。
 *
 * 用户升级后打开 App 弹一次，让 TA 知道改了什么 ——
 * 否则小批量内测时，合伙人根本感觉不到版本在推进。
 */
const visible = ref(false)
const note = ref<ReleaseNote | null>(null)

/** 模块级标志：一次会话内只检查一次，避免每个页面挂载都查 */
let checked = false

function check(): void {
  if (checked) return
  checked = true
  let lastSeen: string | null = null
  try {
    const raw = uni.getStorageSync(VERSION_STORAGE_KEY)
    lastSeen = raw ? String(raw) : null
  } catch {
    return
  }
  const { notes, show } = checkRelease(lastSeen)
  if (!show) return
  note.value = notes[0] ?? null
  visible.value = true
}

function close(): void {
  visible.value = false
  try {
    uni.setStorageSync(VERSION_STORAGE_KEY, APP_VERSION)
  } catch {
    /* 存储不可用时下次还会弹，可接受 */
  }
}

defineExpose({ check })
</script>

<style scoped>
.mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 28px; box-sizing: border-box; z-index: 999;
}
.sheet {
  width: 100%; max-width: 340px; background: #fff; border-radius: 20px;
  padding: 22px 20px 18px; box-sizing: border-box;
  display: flex; flex-direction: column; max-height: 74vh;
}
.head { display: flex; align-items: center; gap: 8px; }
.badge { font-size: 10px; color: #fff; background: #1a1a1a; padding: 3px 9px; border-radius: 999px; }
.badge.major { background: #c0504d; }
.ver { font-size: 13px; font-weight: 700; color: #222; letter-spacing: .5px; }
.date { font-size: 10.5px; color: #b0b0b0; margin-left: auto; }
.title { font-size: 17px; font-weight: 700; margin: 14px 0 10px; display: block; }
.list { flex: 1; min-height: 0; max-height: 42vh; }
.item { display: flex; gap: 8px; padding: 5px 0; }
.dot { font-size: 13px; color: #1a1a1a; line-height: 19px; flex-shrink: 0; }
.txt { flex: 1; font-size: 12.5px; color: #555; line-height: 19px; }
.btn {
  margin-top: 16px; height: 44px; border-radius: 12px; background: #1a1a1a;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.btn text { color: #fff; font-size: 14.5px; font-weight: 600; }
.foot { display: block; text-align: center; font-size: 10px; color: #c0c0c0; margin-top: 10px; }
</style>
