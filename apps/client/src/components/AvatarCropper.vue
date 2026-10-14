<template>
  <view v-if="visible" class="mask">
    <view class="panel">
      <text class="title">调整头像</text>
      <text class="hint">拖动移动位置，滑杆缩放</text>

      <!-- 方形取景框 -->
      <view
        class="stage"
        @touchstart="onStart"
        @touchmove="onMove"
        @touchend="onEnd"
        @mousedown="onMouseDown"
      >
        <image
          class="pic"
          :src="src"
          :style="picStyle"
          mode="widthFix"
          @load="onImgLoad"
        />
        <!-- 取景框四角的遮罩，让用户看清裁切范围 -->
        <view class="frame" />
      </view>

      <view class="zoombar">
        <text class="zlabel">缩放</text>
        <slider
          class="zslider"
          :value="zoomPct"
          :min="100"
          :max="300"
          activeColor="#1a1a1a"
          block-color="#1a1a1a"
          :block-size="18"
          @changing="onZoom"
          @change="onZoom"
        />
      </view>

      <view class="btns">
        <view class="btn ghost" @click="cancel"><text>取消</text></view>
        <view class="btn" @click="confirm"><text>确定</text></view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * 方形头像剪裁。
 *
 * 为什么自己做而不是找插件：uni-app 的 chooseImage 不带剪裁，
 * 引入插件会多一套依赖与构建配置，而我们只需要「方形 + 拖动 + 缩放」。
 *
 * 坐标换算（三层）：
 *   1. 图片自然尺寸 (iw, ih)
 *   2. 取景框边长 STAGE（屏幕像素）
 *   3. 导出画布边长 OUT（固定 512，与屏幕尺寸无关）
 * base 是「刚好铺满取景框」的缩放比，用户缩放 z∈[1,3] 在它之上叠加。
 */
const props = defineProps<{ visible: boolean; src: string }>()
const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'done', dataUrl: string): void
}>()

const STAGE = 260   // 取景框边长（px，与 CSS 里的 .stage 一致）
const OUT = 512     // 导出尺寸

const natural = ref({ w: 0, h: 0 })
const zoom = ref(1)          // 用户缩放倍率
const offset = ref({ x: 0, y: 0 })  // 图片左上角相对取景框的位置
const zoomPct = computed(() => Math.round(zoom.value * 100))

/** 刚好铺满取景框的基础缩放 */
const base = computed(() => {
  const { w, h } = natural.value
  if (!w || !h) return 1
  return Math.max(STAGE / w, STAGE / h)
})
/** 实际缩放后的显示尺寸 */
const dispW = computed(() => natural.value.w * base.value * zoom.value)
const dispH = computed(() => natural.value.h * base.value * zoom.value)

const picStyle = computed(() => ({
  width: `${dispW.value}px`,
  height: `${dispH.value}px`,
  transform: `translate(${offset.value.x}px, ${offset.value.y}px)`,
}))

/** 把图片限制在取景框内（不允许拖出空白） */
function clamp(): void {
  const w = dispW.value
  const h = dispH.value
  const minX = STAGE - w
  const minY = STAGE - h
  offset.value = {
    x: Math.min(0, Math.max(minX, offset.value.x)),
    y: Math.min(0, Math.max(minY, offset.value.y)),
  }
}

// 参数类型用 any：uni-app 的 image load 事件在 H5 与小程序端
// 的 detail 结构不同，强类型反而会挡住编译
function onImgLoad(e: any): void {
  const w = e.detail?.width ?? 0
  const h = e.detail?.height ?? 0
  natural.value = { w, h }
  zoom.value = 1
  // 初始居中
  offset.value = {
    x: (STAGE - w * base.value) / 2,
    y: (STAGE - h * base.value) / 2,
  }
  clamp()
}

function setZoom(pct: number): void {
  const old = zoom.value
  const next = Math.max(1, Math.min(3, pct / 100))
  // 以取景框中心为锚点缩放，否则图会「跑掉」
  const cx = STAGE / 2
  const cy = STAGE / 2
  const k = next / old
  offset.value = {
    x: cx - (cx - offset.value.x) * k,
    y: cy - (cy - offset.value.y) * k,
  }
  zoom.value = next
  clamp()
}
function onZoom(e: { detail: { value: number } }): void {
  setZoom(e.detail.value)
}

// ── 拖动 ──
let drag: { x: number; y: number; ox: number; oy: number } | null = null

function begin(x: number, y: number): void {
  drag = { x, y, ox: offset.value.x, oy: offset.value.y }
}
function move(x: number, y: number): void {
  if (!drag) return
  offset.value = { x: drag.ox + (x - drag.x), y: drag.oy + (y - drag.y) }
  clamp()
}
function onStart(e: any): void {
  const t = e.touches?.[0]; if (t) begin(t.clientX, t.clientY)
}
function onMove(e: any): void {
  const t = e.touches?.[0]; if (t) move(t.clientX, t.clientY)
}
function onEnd(): void { drag = null }
function onMouseDown(e: any): void {
  begin(e.clientX as number, e.clientY as number)
  const mv = (ev: MouseEvent) => move(ev.clientX, ev.clientY)
  const up = () => {
    drag = null
    document.removeEventListener('mousemove', mv)
    document.removeEventListener('mouseup', up)
  }
  document.addEventListener('mousemove', mv)
  document.addEventListener('mouseup', up)
}

function cancel(): void { emit('cancel') }

/**
 * 导出。
 * 屏幕坐标 → 画布坐标的换算系数 f = OUT / STAGE，
 * 图片在画布上的位置与尺寸都按同一个 f 放大。
 */
function confirm(): void {
  const { w, h } = natural.value
  if (!w || !h || typeof document === 'undefined') {
    emit('cancel')
    return
  }
  const f = OUT / STAGE
  const cv = document.createElement('canvas')
  cv.width = OUT; cv.height = OUT
  const ctx = cv.getContext('2d')
  if (!ctx) { emit('cancel'); return }

  const img = new Image()
  img.onload = () => {
    ctx.drawImage(img, offset.value.x * f, offset.value.y * f, dispW.value * f, dispH.value * f)
    emit('done', cv.toDataURL('image/jpeg', 0.9))
  }
  img.onerror = () => emit('cancel')
  img.src = props.src
}
</script>

<style scoped>
.mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex; align-items: center; justify-content: center;
  z-index: 999; padding: 20px; box-sizing: border-box;
}
.panel {
  width: 100%; max-width: 340px; background: #fff; border-radius: 18px;
  padding: 22px 20px 18px; box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center;
}
.title { font-size: 16px; font-weight: 700; }
.hint { font-size: 11.5px; color: #9a9a9a; margin: 5px 0 16px; }
.stage {
  width: 260px; height: 260px;
  position: relative; overflow: hidden;
  background: #f0f0f0; border-radius: 50%;
  cursor: grab;
}
.pic { position: absolute; left: 0; top: 0; will-change: transform; }
.frame {
  position: absolute; left: 0; top: 0; right: 0; bottom: 0;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%; pointer-events: none; box-sizing: border-box;
}
.zoombar { display: flex; align-items: center; gap: 10px; width: 100%; margin-top: 18px; }
.zlabel { font-size: 12px; color: #666; flex-shrink: 0; }
.zslider { flex: 1; min-width: 0; }
.btns { display: flex; gap: 10px; width: 100%; margin-top: 18px; }
.btn { flex: 1; height: 44px; border-radius: 12px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.btn.ghost { background: #f2f2f2; }
.btn.ghost text { color: #555; }
.btn text { color: #fff; font-size: 14.5px; font-weight: 600; }
</style>
