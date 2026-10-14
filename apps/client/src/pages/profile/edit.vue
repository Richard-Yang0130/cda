<template>
  <view class="page">
    <scroll-view class="body" scroll-y>
      <!-- 头像 -->
      <view class="ava-wrap" @click="pickAvatar">
        <view class="ava" :style="!form.avatarUrl ? { background: form.avatarHex } : {}">
          <image v-if="form.avatarUrl" class="ava-img" :src="absUrl(form.avatarUrl)" mode="aspectFill" />
          <text v-else class="ava-letter">{{ (store.user?.nickname ?? '搭').slice(0, 1) }}</text>
        </view>
        <text class="ava-btn">{{ uploading ? '上传中…' : '更换头像' }}</text>
      </view>

      <!-- 基本资料 -->
      <text class="group">基本资料</text>
      <view class="card">
        <view class="row"><text class="lab">昵称</text>
          <input v-model="form.nickname" class="inp" :maxlength="16" placeholder="2–16 个字" placeholder-class="ph" />
        </view>
        <view class="row"><text class="lab">性别</text>
          <view class="chips">
            <text class="chip" :class="{ on: form.gender === 'female' }" @click="form.gender = 'female'">女性</text>
            <text class="chip" :class="{ on: form.gender === 'male' }" @click="form.gender = 'male'">男性</text>
          </view>
        </view>
        <view class="row"><text class="lab">生日</text>
          <picker mode="date" :value="form.birthday" start="1930-01-01" :end="today" @change="(e:any)=>form.birthday=e.detail.value">
            <view class="picker"><text>{{ form.birthday || '未填写' }}</text>
              <text class="age">{{ age !== null ? `（${age} 岁）` : '' }}</text></view>
          </picker>
        </view>
      </view>

      <!-- 身型 -->
      <text class="group">身型（用于尺码推荐，可不填）</text>
      <view class="card">
        <view v-for="f in bodyFields" :key="f.key" class="row">
          <text class="lab">{{ f.label }}</text>
          <input
            class="inp num"
            type="digit"
            :value="String((form as any)[f.key] || '')"
            :placeholder="f.ph"
            placeholder-class="ph"
            @blur="(e:any) => setNum(f, e.detail.value)"
          />
          <text class="unit">{{ f.unit }}</text>
        </view>
        <view class="estbtn" @click="doEstimate"><text>按身高体重估算三围</text></view>
      </view>

      <!-- 风格 -->
      <text class="group">喜欢的风格</text>
      <view class="styles">
        <text v-for="st in styles" :key="st.id" class="style-chip" :class="{ on: form.styles.includes(st.id) }"
          @click="toggleStyle(st.id)">{{ st.name }}</text>
      </view>

      <!-- 品牌 -->
      <text class="group">喜欢的品牌（最多 15 个，可搜索）</text>
      <input v-model="brandKw" class="searchinp" placeholder="搜索品牌" placeholder-class="ph" />
      <view class="brands">
        <text v-for="b in shownBrands" :key="b.id" class="brand-chip"
          :class="{ on: form.brands.includes(b.id) }" @click="toggleBrand(b.id)">{{ b.nameEn }}</text>
      </view>
      <text v-if="form.brands.length" class="picked">已选 {{ form.brands.length }} 个：{{ form.brands.map(brandName).join('、') }}</text>

      <view class="save" :class="{ dis: saving || !canSave }" @click="save">
        <text>{{ saving ? '保存中…' : '保存' }}</text>
      </view>
      <text v-if="err" class="err">{{ err }}</text>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  FASHION_STYLES, MAX_FAVORITE_BRANDS, ageFromBirthday, estimateGirths,
  findBrand, recommendBrands, searchBrands,
} from '@cda/core'
import { api, apiBase, errText } from '@/api/client'
import { applyServerUser, store } from '@/store/app-store'

/**
 * 我的资料。
 *
 * 注册时生日、身型、品牌都是选填，这里是**补填与修改的唯一入口**。
 * 头像是同一个页面的另一件事 —— 都归「关于我」，分开两个入口反而难找。
 */
const saving = ref(false)
const uploading = ref(false)
const err = ref('')
const brandKw = ref('')
const today = new Date().toISOString().slice(0, 10)

const form = reactive({
  nickname: '', gender: 'female' as 'male' | 'female', birthday: '',
  heightCm: 0, weightKg: 0, chestCm: 0, waistCm: 0, hipCm: 0,
  avatarHex: '#c9b8a8', avatarUrl: '',
  styles: [] as string[], brands: [] as string[],
})

const bodyFields = [
  { key: 'heightCm', label: '身高', unit: 'cm', ph: '如 172' },
  { key: 'weightKg', label: '体重', unit: 'kg', ph: '如 60' },
  { key: 'chestCm', label: '胸围', unit: 'cm', ph: '如 88' },
  { key: 'waistCm', label: '腰围', unit: 'cm', ph: '如 72' },
  { key: 'hipCm', label: '臀围', unit: 'cm', ph: '如 94' },
] as const

const styles = FASHION_STYLES
const age = computed(() => ageFromBirthday(form.birthday))
const canSave = computed(() => form.nickname.trim().length >= 2)

const shownBrands = computed(() => {
  const kw = brandKw.value.trim()
  return kw ? searchBrands(kw).slice(0, 40) : recommendBrands(form.styles).slice(0, 40)
})

function absUrl(u: string): string {
  return /^https?:/.test(u) ? u : apiBase() + u.replace(/^\/api/, '')
}
function brandName(id: string): string {
  return findBrand(id)?.nameEn ?? id
}

onLoad(() => {
  const u = store.user
  if (!u) return
  form.nickname = u.nickname ?? ''
  form.gender = (u.gender as 'male' | 'female') ?? 'female'
  form.birthday = u.birthday ?? ''
  form.avatarHex = u.avatarHex ?? '#c9b8a8'
  form.avatarUrl = u.avatarUrl ?? ''
  form.styles = [...(u.styles ?? [])]
  form.brands = [...(u.brands ?? [])]
  const b = u.body
  if (b) {
    form.heightCm = b.heightCm || 0
    form.weightKg = b.weightKg || 0
    form.chestCm = b.chestCm || 0
    form.waistCm = b.waistCm || 0
    form.hipCm = b.hipCm || 0
  }
})

/** 手输数值：空字符串表示「不填」，存 0 */
function setNum(f: { key: string; label: string }, raw: string): void {
  const v = Number(raw)
  if (raw.trim() === '') { (form as never as Record<string, number>)[f.key] = 0; return }
  if (!Number.isFinite(v) || v <= 0 || v > 300) {
    uni.showToast({ title: `${f.label}数值不合理`, icon: 'none' })
    return
  }
  ;(form as never as Record<string, number>)[f.key] = Math.round(v * 10) / 10
}

function doEstimate(): void {
  if (!form.heightCm || !form.weightKg) {
    uni.showToast({ title: '请先填身高与体重', icon: 'none' })
    return
  }
  const r = estimateGirths(form.gender, form.heightCm, form.weightKg)
  form.chestCm = Math.round(r.chestCm)
  form.waistCm = Math.round(r.waistCm)
  form.hipCm = Math.round(r.hipCm)
  uni.showToast({ title: `已估算（BMI ${r.bmi}）`, icon: 'none' })
}

function toggleStyle(id: string): void {
  const i = form.styles.indexOf(id)
  if (i >= 0) form.styles.splice(i, 1)
  else form.styles.push(id)
}

function toggleBrand(id: string): void {
  const i = form.brands.indexOf(id)
  if (i >= 0) { form.brands.splice(i, 1); return }
  if (form.brands.length >= MAX_FAVORITE_BRANDS) {
    uni.showToast({ title: `最多 ${MAX_FAVORITE_BRANDS} 个`, icon: 'none' })
    return
  }
  form.brands.push(id)
}

/**
 * 选图并转 base64。
 *
 * 用 base64 而不是文件路径：小程序端 chooseImage 只给临时路径，
 * 且不能直接 POST 文件；base64 是 H5 与小程序都通用的方式。
 * 选择了 compressed 尺寸，避免把几 MB 的原图传上来。
 */
function pickAvatar(): void {
  if (uploading.value) return
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: async (r) => {
      const path = (r.tempFilePaths as string[])[0]
      if (!path) return
      uploading.value = true
      try {
        const dataUrl = await toDataUrl(path)
        const res = await api.uploadAvatar(dataUrl)
        form.avatarUrl = res.avatarUrl
        applyServerUser(res.user)
        uni.showToast({ title: '头像已更新', icon: 'none' })
      } catch (e) {
        uni.showModal({ title: '头像上传失败', content: errText(e), showCancel: false })
      } finally {
        uploading.value = false
      }
    },
  })
}

/** 把本地路径转成 data URL（H5 用 canvas；小程序端走 FileSystemManager） */
function toDataUrl(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fsm = (uni as unknown as { getFileSystemManager?: () => any }).getFileSystemManager?.()
    if (fsm?.readFile) {
      // 小程序端
      fsm.readFile({
        filePath: path,
        encoding: 'base64',
        success: (r: { data: string }) => resolve(`data:image/jpeg;base64,${r.data}`),
        fail: () => reject(new Error('读取图片失败')),
      })
      return
    }
    // H5：用 canvas 压缩到最长边 512，避免超大图触发服务端 500KB 上限
    const img = new Image()
    img.onload = () => {
      const max = 512
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      const ctx = cv.getContext('2d')
      if (!ctx) return reject(new Error('无法处理图片'))
      ctx.drawImage(img, 0, 0, w, h)
      resolve(cv.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = path
  })
}

async function save(): Promise<void> {
  if (!canSave.value || saving.value) {
    if (!canSave.value) uni.showToast({ title: '昵称至少 2 个字', icon: 'none' })
    return
  }
  saving.value = true
  err.value = ''
  try {
    const res = await api.updateMe({
      nickname: form.nickname.trim(),
      gender: form.gender,
      birthday: form.birthday,
      styles: form.styles,
      brands: form.brands,
      heightCm: form.heightCm,
      weightKg: form.weightKg,
      chestCm: form.chestCm,
      waistCm: form.waistCm,
      hipCm: form.hipCm,
    })
    applyServerUser(res.user)
    uni.showToast({ title: '已保存', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 700)
  } catch (e) {
    err.value = errText(e)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: #fbfbfb; }
.body { height: 100vh; padding: 20px 16px 40px; box-sizing: border-box; }
.ava-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 22px; }
.ava { width: 84px; height: 84px; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.ava-img { width: 100%; height: 100%; }
.ava-letter { color: #fff; font-size: 32px; font-weight: 700; }
.ava-btn { font-size: 12.5px; color: #4a7fa5; }
.group { display: block; font-size: 12px; font-weight: 600; color: #333; margin: 18px 0 8px; }
.card { background: #fff; border-radius: 13px; padding: 2px 14px; }
.row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f4f4f4; }
.row:last-child { border-bottom: none; }
.lab { width: 46px; font-size: 13px; color: #666; flex-shrink: 0; }
.inp { flex: 1; min-width: 0; font-size: 14px; height: 32px; }
.inp.num { text-align: right; }
.unit { font-size: 12px; color: #a8a8a8; width: 26px; flex-shrink: 0; }
.ph { color: #b8b8b8; }
.picker { display: flex; align-items: center; gap: 6px; }
.picker text { font-size: 14px; }
.age { color: #9a9a9a; font-size: 12px; }
.chips { display: flex; gap: 8px; }
.chip { font-size: 12.5px; color: #666; padding: 6px 16px; border-radius: 999px; background: #f2f2f2; }
.chip.on { background: #1a1a1a; color: #fff; }
.estbtn { height: 40px; border-radius: 10px; background: #eef2f5; display: flex; align-items: center; justify-content: center; margin: 12px 0; }
.estbtn text { font-size: 13px; color: #3d5a6c; font-weight: 600; }
.styles { display: flex; flex-wrap: wrap; gap: 8px; }
.style-chip { font-size: 12.5px; color: #666; padding: 7px 15px; border-radius: 999px; background: #fff; }
.style-chip.on { background: #1a1a1a; color: #fff; }
.searchinp { height: 40px; background: #fff; border-radius: 10px; padding: 0 14px; font-size: 13.5px; margin-bottom: 10px; box-sizing: border-box; }
.brands { display: flex; flex-wrap: wrap; gap: 8px; }
.brand-chip { font-size: 12px; color: #666; padding: 6px 13px; border-radius: 999px; background: #fff; }
.brand-chip.on { background: #1a1a1a; color: #fff; }
.picked { display: block; font-size: 11px; color: #9a9a9a; margin-top: 10px; line-height: 16px; }
.save { margin-top: 26px; height: 46px; border-radius: 12px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.save.dis { background: #cfcfcf; }
.save text { color: #fff; font-size: 15px; font-weight: 600; }
.err { display: block; text-align: center; font-size: 12px; color: #c0504d; margin-top: 12px; }
</style>
