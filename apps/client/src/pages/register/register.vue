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
          <!--
            验证码输入：**真实输入框透明覆盖在 6 个格子上**。
            ⚠️ 曾经把输入框放在 left:-9999px 的屏幕外，且格子没有点击聚焦，
            结果是**用户点哪都输不进去** —— 验证码步骤直接卡死。
            覆盖式布局在 H5 与小程序都可靠：点格子等于点输入框。
          -->
          <view class="codewrap">
            <view class="codeboxes">
              <view
                v-for="i in 6"
                :key="i"
                class="cbox"
                :class="{ filled: codeInput.length >= i, cur: codeInput.length === i - 1 }"
              >
                <text class="cdigit">{{ codeInput[i - 1] ?? '' }}</text>
              </view>
            </view>
            <input
              v-model="codeInput"
              class="codeinput"
              type="number"
              :maxlength="6"
              :focus="codeFocus"
              confirm-type="done"
            />
          </view>
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

        <view class="hwcard">
          <view v-for="f in halfFields" :key="f.key" class="hwrow">
            <text class="hwlabel">{{ f.label }}</text>
            <picker
              class="hwpick"
              mode="selector"
              :range="f.options"
              :value="pickerIndex(f)"
              @change="(e: any) => onPick(f, e.detail.value)"
            >
              <view class="hwval">
                <text class="hwnum">{{ fmt((draft as any)[f.key]) }}</text>
                <text class="hwunit">{{ f.unit }}</text>
                <text class="hwarrow">⌄</text>
              </view>
            </picker>
            <view class="hwtype">
              <input
                class="hwinput"
                type="digit"
                :value="String((draft as any)[f.key])"
                @blur="(e: any) => onType(f, e.detail.value)"
              />
              <text class="hwpen">✎</text>
            </view>
          </view>
          <text class="hwhint">点数字滚动选择，或直接输入（支持 0.5，如 177.5）</text>
        </view>

        <view class="estbar">
          <view class="estbtn" @click="doEstimate">
            <text>按身高体重估算三围</text>
          </view>
          <text v-if="bmiText" class="estbmi">{{ bmiText }}</text>
        </view>
        <text class="esthint">
          依据中国成人标准（BMI 健康区间 18.5–23.9、腰围上限男 90/女 85cm、
          腰高比 &lt;0.5）由身高体重推算，可逐项修改
        </text>

        <text class="lab">三围</text>
        <view class="girths">
          <view v-for="f in girthFields" :key="f.key" class="gcol">
            <text class="glabel">{{ f.label }}</text>
            <view class="gbox" :class="{ bad: !!girthErr[f.key] }">
              <input
                class="ginput"
                type="digit"
                :value="String((draft as any)[f.key])"
                @blur="(e: any) => onGirth(f, e.detail.value)"
              />
              <text class="gunit">cm</text>
            </view>
            <text v-if="girthErr[f.key]" class="gerr">{{ girthErr[f.key] }}</text>
          </view>
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
        <view v-if="!draft.brands.length" class="skipnote">
          <text>这一步可以跳过 —— 之后随时能在个人主页补充</text>
        </view>

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

        <text class="lab">设置密码（至少 6 位）</text>
        <input v-model="password" class="inp" password placeholder="用于登录" placeholder-class="ph" :maxlength="32" />

        <text class="lab">邀请码</text>
        <input v-model="inviteCode" class="inp" placeholder="内测邀请码（如 BETA-001）" placeholder-class="ph" :maxlength="32" />
        <text class="esthint">内测阶段需要邀请码 —— 短信与微信登录需企业资质，暂未开通</text>

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
      <!-- 第 5 步是选填，给出明确的跳过入口 -->
      <view v-if="step === 5" class="btn ghost" @click="skipBrands"><text>跳过</text></view>
      <view class="btn" :class="{ dis: !gate.ok || (step === 6 && password.length < 6) }" @click="next">
        <text>{{ step === 6 ? (submitting ? '提交中…' : '完成注册') : '下一步' }}</text>
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
  recommendBrands, searchBrands, DEFAULT_PRIVACY, estimateGirths,
  type LoginMethod, type RegisterDraft, type UserProfile,
} from '@cda/core'
import { applyServerUser } from '@/store/app-store'
import { api, errText, setToken } from '@/api/client'

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
const password = ref('')
const inviteCode = ref('')
const submitting = ref(false)

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
  // 第 6 步：密码至少 6 位
  if (step.value === 6 && password.value.length < 6) {
    return { ok: false, reason: '请设置至少 6 位密码' }
  }
  // 第 3 步：三围有校验错误时不得继续
  if (step.value === 3 && Object.values(girthErr).some((x) => x)) {
    return { ok: false, reason: '三围填写有误，请检查' }
  }
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

/**
 * 三围改为输入框 + 校验（原先滑杆在手机上很难精确调到某一数值，
 * 而且视觉上与大面积的白色背景糊在一起）。
 * 范围按性别给出合理上下限，超出即报错且不写入。
 */
const girthErr = reactive<Record<string, string>>({})
const bmiText = ref('')

/** 由身高体重估算三围 —— 复用 3D 人偶同一套耦合模型，避免「填的数与人偶不符」 */
function doEstimate(): void {
  const h = Number((draft as never as Record<string, unknown>).heightCm)
  const w = Number((draft as never as Record<string, unknown>).weightKg)
  if (!Number.isFinite(h) || !Number.isFinite(w)) {
    uni.showToast({ title: '请先填写身高体重', icon: 'none' })
    return
  }
  const r = estimateGirths(draft.gender ?? 'female', h, w)
  draft.chestCm = Math.round(r.chestCm)
  draft.waistCm = Math.round(r.waistCm)
  draft.hipCm = Math.round(r.hipCm)
  // 估算值同样要过校验，不合法就提示
  for (const f of girthFields) {
    const v = (draft as never as Record<string, number>)[f.key]
    const { min, max } = girthRange(f.key)
    girthErr[f.key] = v < min || v > max ? `${min}–${max}` : ''
  }
  bmiText.value = `BMI ${r.bmi}`
  uni.showToast({ title: `已估算：${draft.chestCm} / ${draft.waistCm} / ${draft.hipCm}`, icon: 'none' })
}
function girthRange(key: string): { min: number; max: number } {
  const fem = draft.gender !== 'male'
  if (key === 'chestCm') return fem ? { min: 68, max: 120 } : { min: 76, max: 130 }
  if (key === 'waistCm') return fem ? { min: 52, max: 110 } : { min: 60, max: 125 }
  return fem ? { min: 76, max: 130 } : { min: 80, max: 135 }
}
function onGirth(f: { key: string; label: string }, raw: string): void {
  const v = Number(raw)
  const { min, max } = girthRange(f.key)
  if (raw.trim() === '' || !Number.isFinite(v)) {
    girthErr[f.key] = '请输入数字'
    return
  }
  if (v < min || v > max) {
    girthErr[f.key] = `${min}–${max}`
    return
  }
  girthErr[f.key] = ''
  ;(draft as never as Record<string, number>)[f.key] = Math.round(v)
}

const girthFields = [
  { key: 'chestCm', label: '胸围' },
  { key: 'waistCm', label: '腰围' },
  { key: 'hipCm', label: '臀围' },
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

function skipBrands(): void {
  draft.brands = []
  step.value++
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

/**
 * 完成注册 —— **调后端**，不再本地生成用户码。
 *
 * 演示环境没有短信资质，手机号只作为账号标识，不校验验证码真伪；
 * 真实接入短信后把 code 一起提交即可（接口已预留字段位置）。
 */
async function finish(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    const res = await api.register({
      inviteCode: inviteCode.value.trim() || undefined,
      phone: draft.loginMethod === 'phone' ? phone.value : undefined,
      email: draft.loginMethod === 'email' ? phone.value : undefined,
      password: password.value,
      nickname: draft.nickname.trim(),
      gender: draft.gender,
      birthday: draft.birthday,
      avatarHex: draft.avatarHex,
      styles: draft.styles,
      brands: draft.brands,
      // 身型此前漏传了，导致个人主页显示的是本地默认值而不是用户填的
      heightCm: draft.heightCm,
      weightKg: draft.weightKg,
      chestCm: draft.chestCm,
      waistCm: draft.waistCm,
      hipCm: draft.hipCm,
      region: '中国',
    })
    setToken(res.token)
    applyServerUser(res.user)
    uni.showToast({ title: `注册成功 ${res.user.code}`, icon: 'none' })
    setTimeout(() => uni.reLaunch({ url: '/pages/profile/profile' }), 900)
  } catch (e) {
    uni.showModal({ title: '注册失败', content: errText(e), showCancel: false })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
/*
 * 必须锁死视口高度。
 * 原先只有 min-height: 100vh —— 内容一长页面就跟着变高，
 * 「下一步」被顶到滚动区最底部，用户**必须滑到最底才能看到**
 * （品牌页最长，所以那里最先暴露）。
 * height + overflow:hidden 让内部 scroll-view 自己滚，底部按钮常驻。
 */
.page { height: 100vh; overflow: hidden; background: #fbfbfb; display: flex; flex-direction: column; padding: 18px 16px 0; box-sizing: border-box; }
.prog { display: flex; gap: 6px; margin-bottom: 16px; }
.pdot { flex: 1; height: 4px; border-radius: 2px; background: #e8e8e8; }
.pdot.on { background: #1a1a1a; }
.pdot.cur { background: #1a1a1a; }
.ptitle { font-size: 20px; font-weight: 700; }
.phint { display: block; font-size: 11.5px; color: #a0a0a0; margin: 4px 0 16px; }
.body { flex: 1; min-height: 0; height: 0; }
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
.codewrap { position: relative; }
/*
 * uni-app 在 H5 会把 <input> 包成 <uni-input>，
 * 样式加在外层包装上时，**内层真正的 input 没有尺寸 → 点了聚焦不到**，
 * 于是验证码永远输不进去（自测实测：能提取到验证码但输入无效）。
 * 必须用 :deep() 把内层 input 也铺满。
 */
.codeinput {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  /* 不能用 display:none / visibility:hidden —— 那样无法聚焦 */
  background: transparent;
}
.codewrap :deep(input),
.codewrap :deep(.uni-input-wrapper),
.codewrap :deep(.uni-input-input) {
  width: 100%;
  height: 100%;
  opacity: 0;
  color: transparent;
  caret-color: transparent;
}
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
.hwcard { background: #fff; border-radius: 14px; padding: 6px 14px 10px; }
.hwrow { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f4f4f4; }
.hwrow:last-of-type { border-bottom: none; }
.hwlabel { width: 40px; font-size: 13.5px; color: #333; font-weight: 600; flex-shrink: 0; }
.hwpick { flex: 1; min-width: 0; }
.hwval { display: flex; align-items: baseline; gap: 4px; }
.hwnum { font-size: 24px; font-weight: 800; color: #111; letter-spacing: -.5px; }
.hwunit { font-size: 12px; color: #9a9a9a; }
.hwarrow { font-size: 13px; color: #b8b8b8; margin-left: 2px; }
.hwtype { position: relative; width: 66px; height: 38px; flex-shrink: 0; }
.hwinput {
  width: 100%; height: 38px; background: #f5f5f5; border-radius: 10px;
  text-align: center; font-size: 13.5px; color: #333; box-sizing: border-box;
}
.hwpen { position: absolute; right: 5px; top: 11px; font-size: 11px; color: #b0b0b0; pointer-events: none; }
.hwhint { display: block; font-size: 10.5px; color: #a8a8a8; line-height: 15px; padding: 4px 0 2px; }
.estbar { display: flex; align-items: center; gap: 10px; margin: 16px 0 6px; }
.estbtn {
  flex: 1; height: 40px; border-radius: 11px; background: #eef2f5;
  border: 1px solid #d8e0e6; display: flex; align-items: center; justify-content: center;
}
.estbtn text { font-size: 13px; color: #3d5a6c; font-weight: 600; }
.estbmi { font-size: 11.5px; color: #6a8a9a; flex-shrink: 0; }
.esthint { display: block; font-size: 10px; color: #a8a8a8; line-height: 15px; margin-bottom: 4px; }
.skipnote {
  margin: 10px 0 4px; padding: 10px 12px; background: #f7f5f2; border-radius: 10px;
}
.skipnote text { font-size: 11px; color: #8a8a8a; line-height: 16px; }
.girths { display: flex; gap: 10px; }
.gcol { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.glabel { font-size: 12px; color: #666; text-align: center; }
.gbox {
  display: flex; align-items: baseline; justify-content: center; gap: 3px;
  background: #fff; border-radius: 11px; border: 1.5px solid transparent; padding: 0 8px; height: 46px;
}
.gbox.bad { border-color: #d98a86; background: #fdf6f6; }
.ginput { flex: 1; min-width: 0; height: 46px; text-align: center; font-size: 19px; font-weight: 700; color: #111; }
.gunit { font-size: 10.5px; color: #a8a8a8; flex-shrink: 0; }
.gerr { font-size: 10px; color: #c0504d; text-align: center; }
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
.foot { display: flex; gap: 10px; padding: 14px 0 6px; flex-shrink: 0; background: #fbfbfb; }
.btn { flex: 1; height: 46px; border-radius: 12px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
.btn.dis { background: #cfcfcf; }
.btn.ghost { background: #f2f2f2; flex: 0 0 96px; }
.btn.ghost text { color: #555; }
.btn text { color: #fff; font-size: 15px; font-weight: 600; }
.gate { display: block; text-align: center; font-size: 10.5px; color: #b08040; padding-bottom: 14px; }
</style>
