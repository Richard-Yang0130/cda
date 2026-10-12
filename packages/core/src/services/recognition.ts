/**
 * 拍照识别单品 —— 服务层。
 *
 * 目标：把「拍一张衣服照片 → 在商品库里找到它」做成一个可替换的 provider。
 *
 * 真实实现的技术路线（已在调研中确认可行）：
 *   1. 检测 + 分割：GroundingDINO（开放词表检测，Apache-2.0）+ SAM2 抠图
 *   2. 特征提取：fashion-clip（MIT）或 SigLIP，得到向量
 *   3. 向量检索：Faiss / pgvector 做近邻召回
 *   4. 属性过滤重排：类目 + 颜色
 *
 * 调研得到的精度预期（真实链路，非本 Mock）：
 *   - 类目识别 >90%、颜色 >85%
 *   - 同款 SKU Top-10 命中 50–70%
 *
 * 当前没有部署这条链路，也不方便在浏览器里跑模型，
 * 因此 Mock 用图像内容的哈希做确定性排序 —— 好处是**同一张图结果稳定、
 * 不同图结果不同**，演示时不会显得是写死的。
 */
import type { Category, Product } from '../types'
import { CATEGORY_LABEL } from '../types'

export interface RecognitionCandidate {
  productId: string
  /** 0..1 */
  confidence: number
  /** 给用户看的命中理由 */
  reason: string
}

export interface RecognitionResult {
  id: string
  candidates: RecognitionCandidate[]
  /** 粗判的类目与颜色，用于构造穿搭特征 */
  detectedCategory?: Category
  detectedColorHex?: string
  provider: string
  simulated: boolean
  elapsedMs: number
}

export interface RecognitionRequest {
  /** 图片路径或 dataURL */
  image: string
}

export interface RecognitionProvider {
  readonly name: string
  readonly simulated: boolean
  isAvailable(): boolean
  recognize(request: RecognitionRequest): Promise<RecognitionResult>
}

/** FNV-1a：给图像内容算一个稳定的哈希，用于 Mock 的确定性排序 */
function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 由哈希派生的稳定伪随机数，范围 [0,1) */
function pseudoRandom(seed: number, salt: number): number {
  const x = Math.sin(seed * 0.0001 + salt * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export interface MockRecognitionOptions {
  delayRange?: [number, number]
  /** 返回的候选数量 */
  limit?: number
  /** 用于匹配的商品库，由应用层注入（core 不反向依赖具体数据） */
  catalog?: Product[]
}

export class MockRecognitionProvider implements RecognitionProvider {
  readonly name = 'mock'
  readonly simulated = true

  private readonly delayRange: [number, number]
  private readonly limit: number
  private readonly catalog: Product[]

  constructor(options: MockRecognitionOptions = {}) {
    this.delayRange = options.delayRange ?? [900, 1700]
    this.limit = options.limit ?? 4
    this.catalog = options.catalog ?? []
  }

  isAvailable(): boolean {
    return true
  }

  async recognize(request: RecognitionRequest): Promise<RecognitionResult> {
    const started = Date.now()
    const [min, max] = this.delayRange
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)))

    const seed = hashString(request.image)

    const scored = this.catalog
      .map((product, index) => {
        const noise = pseudoRandom(seed, index + 1)
        // 让置信度落在一个"看起来合理"的区间：0.42 ~ 0.94
        const confidence = 0.42 + noise * 0.52
        return { product, confidence }
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.limit)

    const top = scored[0]

    return {
      id: `rec_${started.toString(36)}`,
      candidates: scored.map((s) => ({
        productId: s.product.id,
        confidence: Math.round(s.confidence * 100) / 100,
        reason: describeReason(s.product, s.confidence),
      })),
      detectedCategory: top?.product.category,
      detectedColorHex: top?.product.colors[0]?.hex,
      provider: this.name,
      simulated: true,
      elapsedMs: Date.now() - started,
    }
  }
}

function describeReason(product: Product, confidence: number): string {
  if (confidence > 0.85) return `版型与配色高度接近「${product.title}」`
  if (confidence > 0.7) return '品类一致，颜色相近'
  if (confidence > 0.55) return `同为${CATEGORY_LABEL[product.category]}，细节存在差异`
  return '相似度较低，建议人工确认'
}

// ────────────────────────────────────────────────────────────
// 真实实现（占位，形状已固定）
// ────────────────────────────────────────────────────────────

export interface HttpRecognitionConfig {
  /** 自建识别服务的地址，返回 RecognitionResult 的 JSON */
  endpoint: string
  apiKey?: string
  fetchImpl?: typeof fetch
}

/**
 * 指向自建识别服务的 provider。
 * 服务端负责 检测→分割→embedding→向量召回→重排 的完整链路，
 * 客户端只拿结果，模型和 key 都不下发到端上。
 */
export class HttpRecognitionProvider implements RecognitionProvider {
  readonly name = 'http:recognition'
  readonly simulated = false

  constructor(private readonly config: HttpRecognitionConfig) {}

  isAvailable(): boolean {
    return Boolean(this.config.endpoint)
  }

  async recognize(request: RecognitionRequest): Promise<RecognitionResult> {
    if (!this.isAvailable()) throw new Error('未配置识别服务地址')

    const doFetch = this.config.fetchImpl ?? fetch
    const started = Date.now()

    const response = await doFetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({ image: request.image }),
    })

    if (!response.ok) {
      throw new Error(`识别请求失败（${response.status}）`)
    }

    const payload = (await response.json()) as Omit<RecognitionResult, 'elapsedMs' | 'provider' | 'simulated'>
    return {
      ...payload,
      provider: this.name,
      simulated: false,
      elapsedMs: Date.now() - started,
    }
  }
}

export interface RecognitionProviderConfig {
  endpoint?: string
  apiKey?: string
  fetchImpl?: typeof fetch
  /** Mock 用的商品库 */
  catalog?: Product[]
  mock?: MockRecognitionOptions
}

/** 配了服务地址就走真实识别，否则回落 Mock */
export function createRecognitionProvider(config: RecognitionProviderConfig = {}): RecognitionProvider {
  if (config.endpoint) {
    return new HttpRecognitionProvider({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      fetchImpl: config.fetchImpl,
    })
  }
  return new MockRecognitionProvider({ catalog: config.catalog, ...config.mock })
}
