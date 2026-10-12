/**
 * 应用运行时配置。
 *
 * 试穿服务会根据 falApiKey 是否存在自动切换实现：
 *   - 没配 → MockTryOnProvider（占位合成，流程完整可跑）
 *   - 配了 → FalTryOnProvider（真实模型推理）
 *
 * 因此页面代码不需要任何 if 分支，拿到 key 只需在 .env 里填一行。
 */
export const tryOnConfig = {
  /** 在 apps/client/.env 里设置 VITE_FAL_API_KEY */
  falApiKey: (import.meta.env?.VITE_FAL_API_KEY as string | undefined) ?? '',
  /** 可选：覆盖默认模型端点 */
  falEndpoint: (import.meta.env?.VITE_FAL_ENDPOINT as string | undefined) || undefined,
  /**
   * 自建识别服务的地址。留空则用占位识别。
   * 服务端负责 检测→分割→embedding→向量召回→重排，模型不下发到端上。
   */
  recognitionEndpoint: (import.meta.env?.VITE_RECOGNITION_ENDPOINT as string | undefined) || undefined,
}
