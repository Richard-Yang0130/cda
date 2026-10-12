/**
 * 程序化生成的示例素材。
 *
 * 为什么用 SVG data URL 而不是 png 文件：
 *   - demo 阶段零素材依赖，clone 下来就能跑通完整流程
 *   - 不用占仓库体积，也不用担心图片版权
 *   - 颜色可以跟随商品数据变化，视觉上更贴近真实商品
 *
 * 将来接入真实商品图时，把 garmentFlatUrl() 换成后台返回的图片地址即可。
 */
import type { Category } from './types'

function svgToDataUrl(svg: string): string {
  // 用 encodeURIComponent 是最稳妥的：SVG 里的 # 和引号在 data URL 中必须转义
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`
}

/** 单品平铺图的形状（viewBox 0 0 200 240） */
const GARMENT_PATHS: Record<string, string> = {
  top: 'M60 24 L86 10 Q100 24 114 10 L140 24 L176 62 L146 86 L132 68 L132 224 L68 224 L68 68 L54 86 L24 62 Z',
  outerwear:
    'M64 20 L88 8 L100 30 L112 8 L136 20 L172 58 L144 84 L132 66 L132 222 L110 222 L100 46 L90 222 L68 222 L68 66 L56 84 L28 58 Z',
  bottom:
    'M58 14 L142 14 L150 108 L142 232 L114 232 L100 118 L86 232 L58 232 L50 108 Z',
  dress: 'M70 18 L100 6 L130 18 L158 66 L138 78 L150 232 L50 232 L62 78 L42 66 Z',
  accessory: 'M54 16 L146 16 L152 46 L110 58 L110 214 L90 214 L90 58 L48 46 Z',
  shoes: 'M40 60 Q60 40 100 48 L160 90 Q176 104 168 126 L36 126 Q24 100 40 60 Z',
  bag: 'M52 84 L148 84 L160 214 L40 214 Z M76 84 L76 56 Q76 30 100 30 Q124 30 124 56 L124 84',
  hat: 'M40 150 Q40 60 100 60 Q160 60 160 150 L176 166 L24 166 Z',
}

/**
 * 生成单品平铺图。category 决定轮廓，color 决定填充色 ——
 * 因此同一件商品的不同配色会得到不同的图，视觉上更真实。
 */
export function garmentFlatUrl(category: Category, color: string): string {
  const path = GARMENT_PATHS[category] ?? GARMENT_PATHS.top
  const stroke = 'rgba(0,0,0,0.14)'
  const isBag = category === 'bag'
  // 刻意不画底板：留透明背景，这样叠加到人像上时只有衣服轮廓，
  // 不会出现一块白矩形（曾经就是这样，看起来像贴了张白纸）
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240">
    <path d="${path}" fill="${color}" stroke="${stroke}" stroke-width="2"
      ${isBag ? 'fill-rule="evenodd"' : ''}/>
  </svg>`
  return svgToDataUrl(svg)
}

/**
 * 示例人像。
 *
 * 真实的 AI 试穿需要用户上传自己的照片；demo 里提供一个占位人像，
 * 让用户不准备素材也能立刻看到完整流程。
 *
 * 注意：Mock 方案的叠加位置（CATEGORY_ANCHOR）是按这个人像的构图调的，
 * 换成真实用户照片时位置不会准 —— 这正是 Mock 的能力边界，
 * 真实效果必须由模型生成。
 */
export function samplePersonUrl(): string {
  const skin = '#c9b3a0'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e6e0d8"/>
        <stop offset="100%" stop-color="#cfc7bd"/>
      </linearGradient>
    </defs>
    <rect width="400" height="600" fill="url(#bg)"/>
    <ellipse cx="200" cy="566" rx="120" ry="18" fill="rgba(0,0,0,0.10)"/>
    <circle cx="200" cy="88" r="44" fill="${skin}"/>
    <rect x="182" y="126" width="36" height="28" fill="${skin}"/>
    <path d="M142 152 Q200 140 258 152 L270 300 Q200 316 130 300 Z" fill="${skin}"/>
    <rect x="112" y="158" width="32" height="196" rx="16" fill="${skin}"/>
    <rect x="256" y="158" width="32" height="196" rx="16" fill="${skin}"/>
    <path d="M140 300 L198 300 L198 552 L148 552 Z" fill="${skin}"/>
    <path d="M202 300 L260 300 L252 552 L202 552 Z" fill="${skin}"/>
  </svg>`
  return svgToDataUrl(svg)
}
