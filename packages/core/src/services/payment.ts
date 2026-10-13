/**
 * 支付：接口先行，Mock 与真实实现同形。
 *
 * 与 tryon.ts / recognition.ts 沿用同一套 Provider 模式 ——
 * 调用方只依赖 PaymentProvider 接口，换实现不改业务代码。
 *
 * ⚠️ 合规前提（写在这里，避免以后忘记）：
 *   接入微信支付 / 支付宝需要**企业主体 + 营业执照 + 商户号**，
 *   个人主体无法开通。所以现在：
 *     - MockPaymentProvider 把流程跑通（下单 → 选通道 → 支付 → 结果）
 *     - WechatPayProvider / AlipayProvider 只留骨架，调用即抛出明确错误
 *   拿到执照后，只需实现这两个 Provider 并在 config 里切换，
 *   页面与业务流程一行都不用改。
 */

export type PaymentChannel = 'wechat' | 'alipay' | 'thirdparty'

export const CHANNEL_LABEL: Record<PaymentChannel, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
  thirdparty: '跳转第三方平台',
}

/** 未拿到支付资质时，唯一可用的通道：引导到第三方平台成交 */
export const THIRD_PARTY_NOTE =
  '本站未开通在线支付。点击后将跳转至第三方平台完成交易，' +
  '资金与售后由该平台保障。'

export interface OrderInput {
  productId: string
  title: string
  amountCents: number
  channel: PaymentChannel
}

export interface PaymentOrder extends OrderInput {
  id: string
  createdAt: string
  status: 'created' | 'paid' | 'failed' | 'cancelled'
}

export interface PaymentResult {
  ok: boolean
  order: PaymentOrder
  /** 面向用户的说明，直接展示 */
  message: string
  /** 跳转第三方平台时的地址 */
  redirectUrl?: string
  /** 真实支付时的二维码内容（微信 Native 支付等） */
  qrCode?: string
}

export interface PaymentProvider {
  readonly name: string
  /**
   * 是否已接入真实支付。
   * 页面据此决定是否展示「演示」标记 —— 不要让用户在不知情时以为真的付了钱。
   */
  readonly live: boolean
  createOrder(input: OrderInput): Promise<PaymentOrder>
  pay(order: PaymentOrder): Promise<PaymentResult>
  cancel(orderId: string): Promise<void>
}

function newOrderId(): string {
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 演示支付：把流程完整跑通，但**不产生任何真实资金往来**。
 * 通道选择会影响文案与耗时，便于把交互状态都验证到。
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock'
  readonly live = false

  async createOrder(input: OrderInput): Promise<PaymentOrder> {
    await delay(120)
    return {
      ...input,
      id: newOrderId(),
      createdAt: new Date().toISOString(),
      status: 'created',
    }
  }

  async pay(order: PaymentOrder): Promise<PaymentResult> {
    // 不同通道给不同耗时，方便验证加载态
    await delay(order.channel === 'thirdparty' ? 300 : 1400)

    if (order.channel === 'thirdparty') {
      return {
        ok: true,
        order: { ...order, status: 'cancelled' },
        message: THIRD_PARTY_NOTE,
        redirectUrl: thirdPartyUrl(order.productId),
      }
    }
    return {
      ok: true,
      order: { ...order, status: 'paid' },
      message: '【演示】支付流程已跑通，未发生真实扣款',
    }
  }

  async cancel(): Promise<void> {
    await delay(80)
  }
}

/**
 * 真实微信支付 —— **骨架，尚未接通**。
 *
 * 接通需要：企业主体、营业执照、微信支付商户号、已备案域名（用于回调）。
 * 实现要点（供以后参考，避免重新查文档）：
 *   1) 后端调用「JSAPI 下单」拿到 prepay_id（金额、订单号、回调地址）
 *   2) 后端用商户私钥签名，返回前端调起支付所需参数
 *   3) 前端 uni.requestPayment 调起，成功后跳结果页
 *   4) 后端接收异步回调验签，**以回调为准**改订单状态（不能信前端）
 */
export class WechatPayProvider implements PaymentProvider {
  readonly name = 'wechat-pay'
  readonly live = true

  async createOrder(): Promise<PaymentOrder> {
    throw new Error(
      '[CDA] 微信支付未接入：需企业主体 + 营业执照 + 商户号 + 已备案域名。',
    )
  }

  async pay(): Promise<PaymentResult> {
    throw new Error('[CDA] 微信支付未接入。')
  }

  async cancel(): Promise<void> {
    /* 占位 */
  }
}

/** 真实支付宝 —— 同样是骨架，接通条件与微信支付类似 */
export class AlipayProvider implements PaymentProvider {
  readonly name = 'alipay'
  readonly live = true

  async createOrder(): Promise<PaymentOrder> {
    throw new Error('[CDA] 支付宝未接入：需企业主体 + 营业执照 + 商户号。')
  }

  async pay(): Promise<PaymentResult> {
    throw new Error('[CDA] 支付宝未接入。')
  }

  async cancel(): Promise<void> {
    /* 占位 */
  }
}

/** 未接通时的兜底：引导到第三方平台成交，这是个体主体唯一合规的交易方式 */
function thirdPartyUrl(productId: string): string {
  // 真实项目里换成自己的闲鱼/微店商品链接
  return `https://www.goofish.com/search?q=${encodeURIComponent(productId)}`
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface PaymentProviderOptions {
  /** 'mock' | 'wechat' | 'alipay' —— 由环境变量注入 */
  provider?: string
}

/**
 * 支付 Provider 工厂。
 * 现在只可能返回 Mock —— 真实两个 Provider 会抛错，
 * 这样**误配置会立刻暴露**，而不是静默走到假成功。
 */
export function createPaymentProvider(opts: PaymentProviderOptions = {}): PaymentProvider {
  switch (opts.provider) {
    case 'wechat':
      return new WechatPayProvider()
    case 'alipay':
      return new AlipayProvider()
    default:
      return new MockPaymentProvider()
  }
}
