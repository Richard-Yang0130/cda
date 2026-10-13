<template>
  <view class="page">
    <!-- 进度 -->
    <view class="prog">
      <view v-for="s in steps" :key="s.id" class="pdot" :class="{ on: s.id <= step, cur: s.id === step }" />
    </view>
    <text class="ptitle">{{ cur.title }}</text>
    <text class="phint">{{ cur.hint }}</text>

    <scroll-view class="body" scroll-y>
      <!-- ① 登录方式 -->
      <view v-if="step === 1" class="list">
        <!-- 1a 选方式 -->
        <template v-if="!draft.loginMethod">
          <view
            v-for="m in methods"
            :key="m.id"
            class="opt"
            @click="pickMethod(m.id)"
          >
            <view class="odot" :style="{ background: m.hex }" />
            <text class="olabel">{{ m.label }}</text>
            <text class="ocheck">{{ draft.loginMethod === m.id ? '✓' : '' }}</text>
          </view>
          <text class="warn">演示环境：不会真的发送验证码或跳转授权</text>
        </template>

        <!-- 1b 手机号（仅手机号方式） -->
        <template v-else-if="draft.loginMethod === 'phone' && !codeSent">
          <view class="backline" @click="resetMethod"><text>‹ 换一种方式</text></view>
          <text class="lab">手机号</text>
          <view class="prow">
            <text class="pcc">+86</text>
            <input
              v-model="phone"
              class="pinput"
              type="number"
              :maxlength="11"
              placeholder="请输入 11 位手机号"
              placeholder-class="ph"
            />
          </view>
          <text v-if="phone && !phoneValid" class="err">手机号格式不正确（需 1 开头的 11 位数字）</text>
          <view class="sendbtn" :class="{ dis: !phoneValid }" @click="sendCode">
            <text>获取验证码</text>
          </view>
        </template>

        <!-- 1c 验证码：6 个格子、大号加粗 -->
        <template v-else>
          <view class="backline" @click="codeSent = false"><text>‹ 修改手机号</text></view>
          <text class="lab">验证码已发送至 +86 {{ phone }}</text>
          <view class="codeboxes">
            <view v-for="i in 6" :key="i" class="cbox" :class="{ filled: codeInput.length >= i, cur: codeInput.length === i - 1 }">
              <text class="cdigit">{{ codeInput[i - 1] ?? '' }}</text>
            </view>
          </view>
          <!-- 真实输入藏在下方，点格子聚焦（小程序与 H5 通用做法） -->
          <input
            v-model="codeInput"
            class="hiddeninput"
            type="number"
            :maxlength="6"
            :focus="codeFocus"
            @blur="codeFocus = false"
          />
          <text v-if="codeInput.length === 6 && !codeValid" class="err">验证码不正确，请重新输入</text>
          <view class="resend" @click="sendCode"><text>重新发送</text></view>
          <text class="warn">演示环境：验证码通过弹窗直接给出，不会真的发短信</text>
        </template>
      </view>

      <!-- ② 昵称与性别 -->
      <view v-else-if="step === 2" class="form">
        <text class="lab">昵称</text>
        <input v-model="draft.nickname" class="inp" placeholder="2–16 个字" placeholder-class="ph" :maxlength="16" />
        <text class="lab">性别</text>
        <view class="chips">
          <view class="chip" :class="{ on: draft.gender === 'female' }" @click="draft.gender = 'female'"><text>女性</text></view>
          <view class="chip" :class="{ on: draft.gender === 'male' }" @click="draft.gender = 'male'"><text>男性</text></view>
        </view>
      </view>

      <!-- ③ 生日与身型 -->
      <view v-else-if="step === 3" class="form">
        <text class="lab">生日</text>
        <picker mode="date" :value="draft.birthday" start="1930-01-01" :end="today" @change="onBirthday">
          <view class="picker"><text>{{ draft.birthday || '请选择' }}</text><text class="age">{{ age !== null ? `（${age} 岁）` : '' }}</text></view>
        </picker>

        <text class="lab">身高 / 体重（滚轮选择，支持 0.5 精度）</text>
        <view v-for="f in halfFields" :key="f.key" class="row">
          <text class="rlab">{{ f.label }}</text>
          <picker
            class="pk"
            mode="selector"
            :range="f.options"
            :value="pickerIndex(f)"
            @change="(e: any) => onPick(f, e.detail.value)"
          >
            <view class="pkbox">
              <text class="pkval">{{ fmt((draft as any)[f.key]) }}{{ f.unit }}</text>
              <text class="pkarrow">▾</text>
            </view>
          </picker>
          <input
            class="tinynum"
            type="digit"
            :value="String((draft as any)[f.key])"
            @blur="(e: any) => onType(f, e.detail.value)"
          />
        </view>

        <text class="lab">三围</text>
        <view v-for="f in girthFields" :key="f.key" class="row">
          <text class="rlab">{{ f.label }}</text>
          <slider
            class="sld"
            :value="(draft as any)[f.key]"
            :min="f.min" :max="f.max" :step="1"
            activeColor="#1a1a1a" block-color="#1a1a1a" :block-size="14"
            @change="(e: any) => ((draft as any)[f.key] = e.detail.value)"
          />
          <text class="rval">{{ (draft as any)[f.key] }}{{ f.unit }}</text>
        </view>
      </view>

      <!-- ④ 风格 -->
      <view v-else-if="step === 4" class="form">
        <text class="lab">可多选 · 已选 {{ draft.styles.length }}</text>
        <view class="grid">
          <view
            v-for="st in styles"
            :key="st.id"
            class="scard"
            :class="{ on: draft.styles.includes(st.id) }"
            @click="toggleStyle(st.id)"
          >
            <view class="scimg" :style="{ background: st.hex }">
              <text v-if="draft.styles.includes(st.id)" class="stick">✓</text>
            </view>
            <text class="scname">{{ st.name }}</text>
            <text class="scdesc">{{ st.desc }}</text>
          </view>
        </view>
      </view>

      <!-- ⑤ 品牌 -->
      <view v-else-if="step === 5" class="form">
        <view class="sbar">
          <input v-model="brandKw" class="sinput" placeholder="搜索品牌（中英文均可）" placeholder-class="ph" />
          <text class="scount">{{ draft.brands.length }}/{{ MAX_BRANDS }}</text>
        </view>

        <!-- 已选（有序，可删） -->
        <view v-if="draft.brands.length" class="picked">
          <view v-for="(bid, i) in draft.brands" :key="bid" class="pk" @click="removeBrand(bid)">
            <text class="pkno">{{ i + 1 }}</text>
            <text class="pkname">{{ brandName(bid) }}</text>
            <text class="pkx">✕</text>
          </view>
        </view>

        <text class="lab">{{ brandKw ? '搜索结果' : `为你推荐（依据已选风格）` }}</text>
        <view class="blist">
          <view
            v-for="b in shownBrands"
            :key="b.id"
            class="brow"
            :class="{ on: draft.brands.includes(b.id), dis: !draft.brands.includes(b.id) && draft.brands.length >= MAX_BRANDS }"
            @click="toggleBrand(b.id)"
          >
            <view class="bdot" :style="{ background: b.hex }" />
            <view class="binfo">
              <text class="bname">{{ b.nameEn }}</text>
              <text class="bcn">{{ b.name }}</text>
            </view>
            <text class="bcheck">{{ draft.brands.includes(b.id) ? '✓' : '' }}</text>
          </view>
          <view v-if="!shownBrands.length" class="none"><text>没有找到该品牌</text></view>
        </view>
      </view>

      <!-- ⑥ 头像 -->
      <view v-else class="form">
        <text class="lab">选择头像底色（演示用纯色，接入上传后换图片）</text>
        <view class="avatars">
          <view
            v-for="c in avatarColors"
            :key="c"
            class="av"
            :class="{ on: draft.avatarHex === c }"
            :style="{ background: c }"
            @click="draft.avatarHex = c"
          >
            <text v-if="draft.avatarHex === c" class="avchk">✓</text>
          </view>
        </view>

        <view class="summary">
          <text class="smt">确认信息</text>
          <view class="smrow"><text class="smk">昵称</text><text class="smv">{{ draft.nickname }}</text></view>
          <view class="smrow"><text class="smk">性别</text><text class="smv">{{ draft.gender === 'male' ? '男性' : '女性' }}</text></view>
          <view class="smrow"><text class="smk">年龄</text><text class="smv">{{ age ?? '—' }} 岁</text></view>
          <view class="smrow"><text class="smk">身型</text><text class="smv">{{ draft.heightCm }}cm / {{ draft.weightKg }}kg / {{ draft.chestCm }}·{{ draft.waistCm }}·{{ draft.hipCm }}</text></view>
          <view class="smrow"><text class="smk">风格</text><text class="smv">{{ draft.styles.map(styleName).join('、') }}</text></view>
          <view class="smrow"><text class="smk">品牌</text><text class="smv">{{ draft.brands.length }} 个</text></view>
        </view>
      </view>
    </scroll-view>

    <!-- 底部操作 -->
    <view class="foot">
      <view v-if="step > 1" class="btn ghost" @click="step--"><text>上一步</text></view>
      <view class="btn" :class="{ dis: !gate.ok }" @click="next">
        <text>{{ step === 6 ? '完成注册' : '下一步' }}</text>
      </view>
    </view>
    <text v-if="!gate.ok && gate.reason" class="gate">{{ gate.reason }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  FASHION_STYLES, LOGIN_LABEL, MAX_FAVORITE_BRANDS, REGISTER_STEPS,
  ageFromBirthday, canAdvance, emptyDraft, findBrand, findStyle,
  recommendBrands, searchBrands, DEFAULT_PRIVACY,
  type LoginMethod, type RegisterDraft, type UserProfile,
} from '@cda/core'
import { commitUser, nextUserCode } from '@/store/app-store'

/**
 * 6 步注册流程（P0-1）。
 * 步骤定义与每步的准入校验都在 @cda/core/user.ts，UI 只负责呈现 ——
 * 校验集中一处，避免多端（H5/小程序）各写一套。
 */
const steps = REGISTER_STEPS
const step = ref(1)
const draft = reactive<RegisterDraft>(emptyDraft())
const MAX_BRANDS = MAX_FAVORITE_BRANDS
const brandKw = ref('')

/* ── 手机号与验证码（演示版） ── */
const phone = ref('')
const codeSent = ref(false)
/** 演示用：随机六位数字，通过弹窗直接给用户 */
const sentCode = ref('')
const codeInput = ref('')
const codeFocus = ref(false)

/** 中国大陆手机号：1 开头，第二位 3–9，共 11 位 */
const PHONE_RE = /^1[3-9]\d{9}$/
const phoneValid = computed(() => PHONE_RE.test(phone.value))
const codeValid = computed(
  () => codeInput.value.length === 6 && codeInput.value === sentCode.value,
)

function pickMethod(id: LoginMethod): void {
  draft.loginMethod = id
  // 非手机号方式没有验证码环节，直接进入下一步
  if (id !== 'phone') codeSent.value = true
}

function resetMethod(): void {
  draft.loginMethod = null
  codeSent.value = false
  phone.value = ''
  codeInput.value = ''
}

function sendCode(): void {
  if (!phoneValid.value) {
    uni.showToast({ title: '请输入正确的 11 位手机号', icon: 'none' })
    return
  }
  sentCode.value = String(Math.floor(100000 + Math.random() * 900000))
  codeSent.value = true
  codeInput.value = ''
  codeFocus.value = true
  uni.showModal({
    title: '演示验证码',
    content: `本次验证码：${sentCode.value}\n（真实环境由短信下发）`,
    showCancel: false,
  })
}

/* ── 身高体重：0.5 精度滚轮 + 手输 ── */
interface HalfField {
  key: 'heightCm' | 'weightKg'
  label: string
  unit: string
  min: number
  max: number
  options: string[]
}
function halfRange(min: number, max: number): string[] {
  const out: string[] = []
  for (let v = min; v <= max + 1e-9; v += 0.5) out.push(v.toFixed(1))
  return out
}
const halfFields: HalfField[] = [
  { key: 'heightCm', label: '身高', unit: 'cm', min: 145, max: 205, options: halfRange(145, 205) },
  { key: 'weightKg', label: '体重', unit: 'kg', min: 35, max: 130, options: halfRange(35, 130) },
]
function fmt(v: unknown): string {
  // 防御：状态里若混入字符串（URL 参数、手输中间态），不能让它把页面打崩
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
function pickerIndex(f: HalfField): number {
  const raw = (draft as never as Record<string, unknown>)[f.key]
  const v = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(v)) return 0
  return Math.min(f.options.length - 1, Math.max(0, Math.round((v - f.min) / 0.5)))
}
function onPick(f: HalfField, idx: number): void {
  const v = f.min + idx * 0.5
  ;(draft as never as Record<string, number>)[f.key] = Math.round(v * 10) / 10
}
/** 手输：容错处理，非法值不写入并提示 */
function onType(f: HalfField, raw: string): void {
  const v = Number(raw)
  if (!Number.isFinite(v)) return
  if (v < f.min || v > f.max) {
    uni.showToast({ title: `${f.label}需在 ${f.min}–${f.max} 之间`, icon: 'none' })
    return
  }
  // 对齐到 0.5
  ;(draft as never as Record<string, number>)[f.key] = Math.round(v * 2) / 2
}

const today = new Date().toISOString().slice(0, 10)
const cur = computed(() => steps[step.value - 1]!)
const gate = computed(() => {
  const base = canAdvance(step.value, draft, MAX_BRANDS)
  if (!base.ok) return base
  // 第 1 步的额外校验：手机号方式必须通过验证码
  if (step.value === 1 && draft.loginMethod === 'phone' && !codeValid.value) {
    return { ok: false, reason: codeSent.value ? '请输入 6 位验证码' : '请先获取验证码' }
  }
  return base
})
const age = computed(() => ageFromBirthday(draft.birthday))

const methods = (['phone', 'wechat', 'qq', 'email'] as LoginMethod[]).map((id) => ({
  id, label: LOGIN_LABEL[id],
  hex: { phone: '#8fa3b0', wechat: '#5aa35a', qq: '#4a8fd0', email: '#c9a98a' }[id],
}))

const girthFields = [
  { key: 'chestCm', label: '胸围', unit: 'cm', min: 68, max: 130 },
  { key: 'waistCm', label: '腰围', unit: 'cm', min: 50, max: 130 },
  { key: 'hipCm', label: '臀围', unit: 'cm', min: 72, max: 140 },
] as const

const styles = FASHION_STYLES
const avatarColors = ['#c9b8a8', '#8fa3b0', '#a8b39a', '#b7a9c9', '#d3a9a0', '#c9a98a']

/** 第 5 步：有搜索词就搜，否则按已选风格推荐 */
const shownBrands = computed(() => {
  const kw = brandKw.value.trim()
  return kw ? searchBrands(kw) : recommendBrands(draft.styles).slice(0, 60)
})

/**
 * 测试用：`?draft=birthday:1995-06-15,nickname:测试&step=4`
 *
 * 为什么要这个：H5 的日期选择器是原生组件，**无法程序化驱动**，
 * 于是第 3 步之后的流程自动化测不到。这个参数让人工验证与自动测试
 * 都能直接落到指定步骤，走的是与手动操作**完全相同**的状态。
 */
onLoad((q) => {
  const query = q as { draft?: string; step?: string } | undefined
  if (query?.draft) {
    for (const part of query.draft.split(',')) {
      const [k, v] = part.split(':')
      if (!k || v === undefined) continue
      if (k === 'styles') draft.styles = v.split('|')
      else if (k === 'brands') draft.brands = v.split('|')
      else if (k === 'gender') draft.gender = v === 'male' ? 'male' : 'female'
      else if (k === 'loginMethod') draft.loginMethod = v as never
      else if (k in draft) {
        // ⚠️ URL 参数一律是字符串，数值字段必须转成 number。
        // 否则后面的 toFixed / 数值比较会在运行时抛
        // 「a.toFixed is not a function」（自测抓到的真 bug）。
        const num = Number(v)
        ;(draft as never as Record<string, unknown>)[k] = Number.isFinite(num) && v.trim() !== '' ? num : v
      }
    }
  }
  const st = Number(query?.step)
  if (Number.isFinite(st) && st >= 1 && st <= steps.length) step.value = st
})

function styleName(id: string): string {
  return findStyle(id)?.name ?? id
}
function brandName(id: string): string {
  const b = findBrand(id)
  return b ? b.nameEn : id
}

function onBirthday(e: { detail: { value: string } }): void {
  draft.birthday = e.detail.value
}

function toggleStyle(id: string): void {
  const i = draft.styles.indexOf(id)
  if (i >= 0) draft.styles.splice(i, 1)
  else draft.styles.push(id)
  // 风格变了，之前选的品牌可能不再相关；但**不静默清空**，交给用户决定
}

function toggleBrand(id: string): void {
  const i = draft.brands.indexOf(id)
  if (i >= 0) {
    draft.brands.splice(i, 1)
    return
  }
  if (draft.brands.length >= MAX_BRANDS) {
    uni.showToast({ title: `最多选择 ${MAX_BRANDS} 个品牌`, icon: 'none' })
    return
  }
  draft.brands.push(id) // 顺序即优先级，主页取前 5 个
}

function removeBrand(id: string): void {
  const i = draft.brands.indexOf(id)
  if (i >= 0) draft.brands.splice(i, 1)
}

function next(): void {
  if (!gate.value.ok) {
    uni.showToast({ title: gate.value.reason ?? '请先完成本步', icon: 'none' })
    return
  }
  if (step.value < steps.length) {
    step.value++
    return
  }
  finish()
}

function finish(): void {
  const now = new Date().toISOString()
  const user: UserProfile = {
    code: nextUserCode(),
    status: 'active',
    nickname: draft.nickname.trim(),
    gender: draft.gender!,
    birthday: draft.birthday,
    avatarHex: draft.avatarHex,
    styles: [...draft.styles],
    brands: [...draft.brands],
    loginMethod: draft.loginMethod!,
    createdAt: now,
    privacy: { ...DEFAULT_PRIVACY },
    region: '中国',
    lastSeenAt: now,
    isOnline: true,
  }
  commitUser(user)
  uni.showToast({ title: `注册成功 ${user.code}`, icon: 'none' })
  setTimeout(() => uni.reLaunch({ url: '/pages/profile/profile' }), 900)
}
</script>

<style scoped>
.page { min-height: 100vh; background: #fbfbfb; display: flex; flex-direction: column; padding: 18px 16px 0; box-sizing: border-box; }
.prog { display: flex; gap: 6px; margin-bottom: 16px; }
.pdot { flex: 1; height: 4px; border-radius: 2px; background: #e8e8e8; }
.pdot.on { background: #1a1a1a; }
.pdot.cur { background: #1a1a1a; }
.ptitle { font-size: 20px; font-weight: 700; }
.phint { display: block; font-size: 11.5px; color: #a0a0a0; margin: 4px 0 16px; }
.body { flex: 1; min-height: 0; }
.list, .form { display: flex; flex-direction: column; }
.opt { display: flex; align-items: center; gap: 12px; padding: 14px; background: #fff; border-radius: 12px; margin-bottom: 9px; border: 1.5px solid transparent; }
.opt.on { border-color: #1a1a1a; }
.odot { width: 28px; height: 28px; border-radius: 9px; }
.olabel { flex: 1; font-size: 14px; }
.ocheck { font-size: 15px; color: #1a1a1a; }
.backline { margin-bottom: 12px; }
.backline text { font-size: 12.5px; color: #6a6a6a; }
.prow { display: flex; align-items: center; gap: 8px; background: #fff; border-radius: 11px; padding: 0 13px; height: 46px; }
.pcc { font-size: 14px; color: #333; }
.pinput { flex: 1; font-size: 15px; height: 46px; letter-spacing: 1.5px; }
.err { display: block; font-size: 11px; color: #c0504d; margin-top: 7px; }
.sendbtn { margin-top: 16px; height: 44px; border-radius: 11px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.sendbtn.dis { background: #cfcfcf; }
.sendbtn text { color: #fff; font-size: 14px; font-weight: 600; }
.codeboxes { display: flex; gap: 9px; margin: 12px 0 6px; }
.cbox { flex: 1; height: 56px; border-radius: 12px; background: #fff; border: 1.5px solid #e6e6e6; display: flex; align-items: center; justify-content: center; }
.cbox.filled { border-color: #1a1a1a; }
.cbox.cur { border-color: #1a1a1a; box-shadow: 0 0 0 3px rgba(26,26,26,.08); }
.cdigit { font-size: 26px; font-weight: 800; color: #111; letter-spacing: 0; }
.hiddeninput { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
.resend { margin-top: 14px; }
.resend text { font-size: 12.5px; color: #4a7fa5; }
.pk { flex: 1; min-width: 0; }
.pkbox { height: 40px; background: #fff; border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 6px; }
.pkval { font-size: 15px; font-weight: 600; color: #111; }
.pkarrow { font-size: 11px; color: #b0b0b0; }
.tinynum { width: 62px; height: 40px; background: #fff; border-radius: 10px; text-align: center; font-size: 13px; flex-shrink: 0; }
.warn { font-size: 10.5px; color: #b08040; margin-top: 6px; line-height: 16px; }
.lab { font-size: 12px; font-weight: 600; color: #333; margin: 14px 0 8px; }
.inp { height: 44px; background: #fff; border-radius: 11px; padding: 0 13px; font-size: 14px; }
.ph { color: #b0b0b0; }
.chips { display: flex; gap: 8px; }
.chip { flex: 1; height: 42px; border-radius: 11px; background: #f2f2f2; display: flex; align-items: center; justify-content: center; }
.chip text { font-size: 13.5px; color: #555; }
.chip.on { background: #1a1a1a; }
.chip.on text { color: #fff; font-weight: 600; }
.picker { height: 44px; background: #fff; border-radius: 11px; padding: 0 13px; display: flex; align-items: center; gap: 6px; }
.picker text { font-size: 14px; }
.age { color: #8a8a8a; font-size: 12.5px; }
.row { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.rlab { width: 42px; font-size: 11.5px; color: #666; flex-shrink: 0; }
.sld { flex: 1; min-width: 0; }
.rval { width: 58px; text-align: right; font-size: 11.5px; color: #333; flex-shrink: 0; }
.grid { display: flex; flex-wrap: wrap; gap: 10px; }
.scard { width: calc(50% - 5px); background: #fff; border-radius: 12px; overflow: hidden; border: 1.5px solid transparent; }
.scard.on { border-color: #1a1a1a; }
.scimg { height: 76px; display: flex; align-items: center; justify-content: center; }
.stick { color: #fff; font-size: 22px; font-weight: 700; text-shadow: 0 1px 4px rgba(0,0,0,.4); }
.scname { display: block; font-size: 13px; font-weight: 600; padding: 8px 10px 0; }
.scdesc { display: block; font-size: 10.5px; color: #a0a0a0; line-height: 15px; padding: 3px 10px 10px; }
.sbar { display: flex; align-items: center; gap: 10px; }
.sinput { flex: 1; height: 40px; background: #fff; border-radius: 11px; padding: 0 13px; font-size: 13.5px; }
.scount { font-size: 12px; color: #666; flex-shrink: 0; }
.picked { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pk { display: flex; align-items: center; gap: 5px; padding: 5px 9px; background: #1a1a1a; border-radius: 999px; }
.pkno { font-size: 9.5px; color: #9a9a9a; }
.pkname { font-size: 11.5px; color: #fff; }
.pkx { font-size: 11px; color: #9a9a9a; }
.blist { display: flex; flex-direction: column; gap: 7px; }
.brow { display: flex; align-items: center; gap: 11px; padding: 11px 12px; background: #fff; border-radius: 11px; border: 1.5px solid transparent; }
.brow.on { border-color: #1a1a1a; }
.brow.dis { opacity: .45; }
.bdot { width: 26px; height: 26px; border-radius: 8px; }
.binfo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.bname { font-size: 13px; color: #222; }
.bcn { font-size: 10.5px; color: #a0a0a0; }
.bcheck { font-size: 14px; color: #1a1a1a; }
.none { padding: 30px 0; text-align: center; color: #b8b8b8; font-size: 12px; }
.avatars { display: flex; flex-wrap: wrap; gap: 10px; }
.av { width: 58px; height: 58px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid transparent; }
.av.on { border-color: #1a1a1a; }
.avchk { color: #fff; font-size: 18px; font-weight: 700; }
.summary { margin-top: 22px; background: #fff; border-radius: 12px; padding: 13px 14px; }
.smt { font-size: 13px; font-weight: 600; display: block; margin-bottom: 9px; }
.smrow { display: flex; gap: 10px; padding: 5px 0; }
.smk { width: 46px; font-size: 11.5px; color: #a0a0a0; flex-shrink: 0; }
.smv { flex: 1; font-size: 11.5px; color: #333; line-height: 17px; }
.foot { display: flex; gap: 10px; padding: 14px 0 6px; }
.btn { flex: 1; height: 46px; border-radius: 12px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.btn.dis { background: #cfcfcf; }
.btn.ghost { background: #f2f2f2; flex: 0 0 96px; }
.btn.ghost text { color: #555; }
.btn text { color: #fff; font-size: 15px; font-weight: 600; }
.gate { display: block; text-align: center; font-size: 10.5px; color: #b08040; padding-bottom: 14px; }
</style>
