<template>
  <NavShell current="">
    <view class="page">
      <!-- 合规横幅：不能让用户在不知情时以为真的付了钱 -->
      <view v-if="!provider.live" class="notice">
        <text class="n-title">演示环境 · 未接入真实支付</text>
        <text class="n-sub">{{ licenseNote }}</text>
      </view>

      <template v-if="product">
        <!-- 订单 -->
        <view class="order">
          <view class="thumb" :style="{ background: swatch }" />
          <view class="oinfo">
            <text class="otitle">{{ product.title }}</text>
            <text class="osub">{{ CATEGORY_LABEL[product.category] }} · 来自帖子</text>
          </view>
          <text class="price">¥{{ formatPrice(product.priceCents) }}</text>
        </view>

        <!-- 通道 -->
        <text class="group">支付方式</text>
        <view class="channels">
          <view
            v-for="c in channels"
            :key="c.id"
            class="ch"
            :class="{ on: channel === c.id, dis: c.locked }"
            @click="pickChannel(c.id, c.locked)"
          >
            <view class="ch-left">
              <text class="ch-name">{{ c.name }}</text>
              <text v-if="c.locked" class="ch-lock">{{ c.lockReason }}</text>
            </view>
            <view class="radio" :class="{ on: channel === c.id }" />
          </view>
        </view>

        <!-- 第三方说明（未拿资质时唯一合规通道） -->
        <view v-if="channel === 'thirdparty'" class="tip">
          <text>{{ THIRD_PARTY_NOTE }}</text>
        </view>

        <!-- 结果 -->
        <view v-if="result" class="result" :class="{ ok: result.ok }">
          <text class="r-title">{{ result.ok ? (result.redirectUrl ? '即将跳转' : '支付完成') : '支付失败' }}</text>
          <text class="r-msg">{{ result.message }}</text>
          <text v-if="result.redirectUrl" class="r-url">{{ result.redirectUrl }}</text>
        </view>

        <view class="actions">
          <view class="primary" :class="{ dis: paying }" @click="submit">
            <text>{{ paying ? '处理中…' : channel === 'thirdparty' ? '前往第三方平台' : `支付 ¥${formatPrice(product.priceCents)}` }}</text>
          </view>
          <text class="foot">订单号：{{ orderId || '—' }}</text>
        </view>
      </template>

      <view v-else class="empty"><text>商品不存在</text></view>
    </view>
  </NavShell>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  CATEGORY_LABEL, THIRD_PARTY_NOTE, createPaymentProvider, findProduct, formatPrice,
  type PaymentChannel, type PaymentResult,
} from '@cda/core'
import NavShell from '@/components/NavShell.vue'

/**
 * 支付页。
 *
 * ⚠️ 当前**未接入真实支付** —— 微信支付/支付宝需企业主体 + 营业执照 + 商户号。
 * 页面与流程已完整，拿到资质后只需实现 PaymentProvider 并在 config 切换，
 * 这一页一行都不用改。见 packages/core/src/services/payment.ts。
 */
const provider = createPaymentProvider()
const productId = ref('')
const channel = ref<PaymentChannel>('thirdparty')
const paying = ref(false)
const result = ref<PaymentResult | null>(null)
const orderId = ref('')

const licenseNote =
  '微信支付 / 支付宝需企业主体与营业执照。未取得前，交易请走第三方平台完成。'

const product = computed(() => (productId.value ? findProduct(productId.value) : undefined))
const swatch = computed(() => product.value?.colors[0]?.hex ?? '#dddddd')

const channels = computed(() => [
  {
    id: 'thirdparty' as const,
    name: '跳转第三方平台',
    locked: false,
    lockReason: '',
  },
  {
    id: 'wechat' as const,
    name: '微信支付',
    locked: !provider.live,
    lockReason: '需企业主体 + 营业执照 + 商户号',
  },
  {
    id: 'alipay' as const,
    name: '支付宝',
    locked: !provider.live,
    lockReason: '需企业主体 + 营业执照 + 商户号',
  },
])

onLoad((q) => {
  const id = (q as { productId?: string } | undefined)?.productId
  productId.value = id ?? ''
})

function pickChannel(id: PaymentChannel, locked: boolean): void {
  if (locked) {
    uni.showToast({ title: '该通道需资质，暂未开通', icon: 'none' })
    return
  }
  channel.value = id
  result.value = null
}

async function submit(): Promise<void> {
  const p = product.value
  if (!p || paying.value) return
  paying.value = true
  result.value = null
  try {
    const order = await provider.createOrder({
      productId: p.id,
      title: p.title,
      amountCents: p.priceCents,
      channel: channel.value,
    })
    orderId.value = order.id
    result.value = await provider.pay(order)
  } catch (err) {
    result.value = null
    uni.showModal({
      title: '支付不可用',
      content: String(err),
      showCancel: false,
    })
  } finally {
    paying.value = false
  }
}
</script>

<style scoped>
.page {
  padding: 16px 16px 30px;
}
.notice {
  background: #fdf6e8;
  border-left: 3px solid #d9a441;
  border-radius: 10px;
  padding: 11px 13px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.n-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #8a6420;
}
.n-sub {
  font-size: 11px;
  color: #9a7a40;
  line-height: 16px;
}
.order {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.05);
}
.thumb {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  flex-shrink: 0;
}
.oinfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.otitle {
  font-size: 13.5px;
  font-weight: 600;
}
.osub {
  font-size: 11px;
  color: #a0a0a0;
}
.price {
  font-size: 16px;
  font-weight: 700;
}
.group {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #333;
  margin: 20px 0 8px;
}
.channels {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 14px;
  background: #fff;
  border-radius: 12px;
  border: 1.5px solid transparent;
}
.ch.on {
  border-color: #1a1a1a;
}
.ch.dis {
  opacity: 0.55;
}
.ch-left {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ch-name {
  font-size: 13.5px;
  color: #222;
}
.ch-lock {
  font-size: 10.5px;
  color: #b08040;
}
.radio {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #d5d5d5;
  box-sizing: border-box;
}
.radio.on {
  border-color: #1a1a1a;
  background: radial-gradient(circle, #1a1a1a 0 5px, transparent 5px);
}
.tip {
  margin-top: 12px;
  padding: 11px 13px;
  background: #f7f5f2;
  border-radius: 10px;
}
.tip text {
  font-size: 11.5px;
  color: #7a7a7a;
  line-height: 17px;
}
.result {
  margin-top: 16px;
  padding: 13px 14px;
  border-radius: 12px;
  background: #fdecec;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.result.ok {
  background: #eef7ee;
}
.r-title {
  font-size: 13.5px;
  font-weight: 600;
}
.r-msg {
  font-size: 11.5px;
  color: #6a6a6a;
  line-height: 17px;
}
.r-url {
  font-size: 10.5px;
  color: #4a7fa5;
  word-break: break-all;
}
.actions {
  margin-top: 22px;
}
.primary {
  height: 46px;
  border-radius: 12px;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
}
.primary.dis {
  background: #cfcfcf;
}
.primary text {
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
.foot {
  display: block;
  text-align: center;
  font-size: 10.5px;
  color: #c0c0c0;
  margin-top: 10px;
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: #b0b0b0;
  font-size: 13px;
}
</style>
