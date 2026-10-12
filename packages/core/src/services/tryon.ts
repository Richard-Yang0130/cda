/**
 * 2D AI 虚拟试穿 —— 服务层。
 *
 * 设计目标（很重要）：**接口形状与真实云端调用完全一致**。
 * 现在因为没有 fal.ai 额度，用的是 Mock 实现；
 * 将来只要把 provider 换成 FalTryOnProvider，页面代码一行都不用改。
 *
 * 为什么不做自研模型：
 *   - 可商用的开源 VTON 极少（多数是 CC BY-NC-SA，仅限研究）
 *   - 本机仅 16GB 内存，跑不动 SDXL 级模型
 *   - 托管 API 单张约 $0.075，比自建 GPU 划算得多
 */

export type TryOnGarmentCategory = 'top' | 'bottom' | 'dress'

export interface TryOnRequest {
  /** 人物照片。H5 下是 dataURL / blob，小程序下是临时文件路径 */
  personImage: string
  /** 平铺单品图 */
  garmentImage: string
  category: TryOnGarmentCategory
  /** 固定随机种子，便于对比不同参数 */
  seed?: number
}

/**
 * 占位实现返回的叠加信息。
 *
 * 真实 provider 直接返回合成好的图片，不需要这个字段；
 * Mock 没有推理能力，改为把单品图叠加到人物图上来模拟效果 ——
 * 这样演示时「能看到东西」，而不是一张写着"占位"的卡片。
 */
export interface TryOnOverlay {
  garmentImage: string
  /** 相对人物图的归一化矩形（0..1） */
  rect: { x: number; y: number; w: number; h: number }
  opacity: number
}

export interface TryOnResult {
  id: string
  /**
   * 结果图。
   * - 真实 provider：模型生成的图片 URL
   * - Mock：原人物图（配合 overlay 字段在页面上叠加）
   */
  imageUrl: string
  overlay?: TryOnOverlay
  provider: string
  /** true = 不是真实模型输出，仅为流程占位 */
  simulated: boolean
  elapsedMs: number
  createdAt: string
}

export interface TryOnProvider {
  readonly name: string
  readonly simulated: boolean
  /** 是否具备真实调用条件（例如已配置 API key） */
  isAvailable(): boolean
  generate(request: TryOnRequest): Promise<TryOnResult>
}

// ────────────────────────────────────────────────────────────
// Mock 实现
// ────────────────────────────────────────────────────────────

/**
 * 各类目在人物图上的默认落位（归一化）。
 *
 * 这组数值是按 samplePersonUrl() 那张示例人像的构图调的（400x600），
 * 换成真实用户照片时位置不会准 —— 这正是 Mock 的能力边界。
 * 真实 provider 会返回模型合成的整图，不使用这个字段。
 */
export const CATEGORY_ANCHOR: Record<TryOnGarmentCategory, TryOnOverlay['rect']> = {
  top: { x: 0.31, y: 0.24, w: 0.38, h: 0.29 },
  bottom: { x: 0.34, y: 0.49, w: 0.33, h: 0.44 },
  dress: { x: 0.3, y: 0.24, w: 0.4, h: 0.7 },
}

export interface MockTryOnOptions {
  /** 模拟推理耗时区间（毫秒），默认 1200–2200，让 loading 状态可感知 */
  delayRange?: [number, number]
  /** 注入随机源，便于测试 */
  random?: () => number
}

export class MockTryOnProvider implements TryOnProvider {
  readonly name = 'mock'
  readonly simulated = true

  private readonly delayRange: [number, number]
  private readonly random: () => number

  constructor(options: MockTryOnOptions = {}) {
    this.delayRange = options.delayRange ?? [1200, 2200]
    this.random = options.random ?? Math.random
  }

  isAvailable(): boolean {
    return true
  }

  async generate(request: TryOnRequest): Promise<TryOnResult> {
    const started = Date.now()
    const [min, max] = this.delayRange
    const wait = min + this.random() * (max - min)
    await new Promise((resolve) => setTimeout(resolve, wait))

    return {
      id: `tryon_${started.toString(36)}`,
      imageUrl: request.personImage,
      overlay: {
        garmentImage: request.garmentImage,
        rect: CATEGORY_ANCHOR[request.category],
        opacity: 0.88,
      },
      provider: this.name,
      simulated: true,
      elapsedMs: Date.now() - started,
      createdAt: new Date().toISOString(),
    }
  }
}

// ────────────────────────────────────────────────────────────
// fal.ai 真实实现
// ────────────────────────────────────────────────────────────

export interface FalTryOnConfig {
  apiKey: string
  /** 默认 fal-ai/fashn/tryon/v1.5：$0.075/张，且明确允许商用 */
  endpoint?: string
  baseUrl?: string
  /** 便于测试注入 */
  fetchImpl?: typeof fetch
}

/**
 * fal.ai 的 FASHN 试穿模型。
 *
 * ⚠️ 说明：由于当前没有 API key，**这段映射未经真实联调**。
 * 拿到 key 后需要按官方最新文档核对一次请求/响应字段
 * （尤其是 category 取值与 images 数组结构）。
 * 之所以现在就写出来，是为了把接口形状固定下来。
 */
export class FalTryOnProvider implements TryOnProvider {
  readonly name = 'fal:fashn-tryon-v1.5'
  readonly simulated = false

  constructor(private readonly config: FalTryOnConfig) {}

  isAvailable(): boolean {
    return Boolean(this.config.apiKey)
  }

  async generate(request: TryOnRequest): Promise<TryOnResult> {
    if (!this.isAvailable()) {
      throw new Error('未配置 fal.ai API key，无法进行真实试穿')
    }

    const baseUrl = this.config.baseUrl ?? 'https://fal.run'
    const endpoint = this.config.endpoint ?? 'fal-ai/fashn/tryon/v1.5'
    const doFetch = this.config.fetchImpl ?? fetch
    const started = Date.now()

    const response = await doFetch(`${baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_image: request.personImage,
        garment_image: request.garmentImage,
        category: request.category,
        seed: request.seed,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`试穿请求失败（${response.status}）：${text.slice(0, 200)}`)
    }

    const payload = (await response.json()) as { images?: Array<{ url?: string }> }
    const imageUrl = payload.images?.[0]?.url
    if (!imageUrl) {
      throw new Error('试穿返回结果中没有图片')
    }

    return {
      id: `tryon_${started.toString(36)}`,
      imageUrl,
      provider: this.name,
      simulated: false,
      elapsedMs: Date.now() - started,
      createdAt: new Date().toISOString(),
    }
  }
}

// ────────────────────────────────────────────────────────────
// 工厂
// ────────────────────────────────────────────────────────────

export interface TryOnProviderConfig {
  /** 有 key 就走真实模型，否则回落到 Mock */
  falApiKey?: string
  falEndpoint?: string
  fetchImpl?: typeof fetch
  mock?: MockTryOnOptions
}

/**
 * 按可用性自动挑选 provider。
 * 这样开发者本地没配 key 也能跑通完整流程，配了 key 就自动升级为真实推理。
 */
export function createTryOnProvider(config: TryOnProviderConfig = {}): TryOnProvider {
  if (config.falApiKey) {
    return new FalTryOnProvider({
      apiKey: config.falApiKey,
      endpoint: config.falEndpoint,
      fetchImpl: config.fetchImpl,
    })
  }
  return new MockTryOnProvider(config.mock)
}
