/**
 * 3D 舞台的宿主适配。
 *
 * H5 下：uni-app 的 <view id="..."> 会渲染成真实 <div>，我们往里挂一个原生 canvas。
 * 小程序下：不存在 document，需要用 uni.createSelectorQuery() 拿到 canvas 节点，
 *          并配合 threejs-miniprogram 的适配层 —— 见 TODO 标注处。
 *
 * 把这段“取 canvas”的逻辑单独抽出来，是为了让 3D 引擎本体保持平台无关。
 */
import type { CanvasLike } from '@cda/tryon-engine'

export interface StageHost {
  canvas: CanvasLike
  width: number
  height: number
  /** 监听容器尺寸变化，返回取消函数 */
  onResize(cb: (w: number, h: number) => void): () => void
  /** 读取容器在当前视口中的矩形，用于判断拖拽是否落在舞台上 */
  getRect(): { left: number; top: number; width: number; height: number }
  dispose(): void
}

/** H5 / App(webview) 实现 */
export function mountStageH5(hostId: string): StageHost {
  const host = document.getElementById(hostId)
  if (!host) throw new Error(`找不到舞台容器 #${hostId}`)

  const canvas = document.createElement('canvas')
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'
  host.appendChild(canvas)

  const measure = () => {
    const r = host.getBoundingClientRect()
    return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }
  }

  const size = measure()

  let ro: ResizeObserver | null = null
  const bindResize = (cb: (w: number, h: number) => void) => {
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        const s = measure()
        cb(s.width, s.height)
      })
      ro.observe(host)
      return () => {
        ro?.disconnect()
        ro = null
      }
    }
    const onWinResize = () => {
      const s = measure()
      cb(s.width, s.height)
    }
    window.addEventListener('resize', onWinResize)
    return () => window.removeEventListener('resize', onWinResize)
  }

  return {
    canvas: canvas as unknown as CanvasLike,
    width: size.width,
    height: size.height,
    onResize: bindResize,
    getRect() {
      const r = host.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    },
    dispose() {
      ro?.disconnect()
      canvas.remove()
    },
  }
}

/**
 * TODO(Phase 2 小程序)：实现 mountStageMp()。
 *
 * 思路：
 *   const query = uni.createSelectorQuery()
 *   query.select('#tryon-stage').fields({ node: true, size: true }, (res) => {
 *     const canvas = res.node            // 小程序 canvas 节点
 *     const ctx = canvas.getContext('webgl')  // 交给 threejs-miniprogram 包装
 *     ...
 *   }).exec()
 *
 * 因为返回类型完全一致（CanvasLike + width/height），TryonEngine 无需任何改动。
 */
export function mountStage(hostId: string): StageHost {
  // 目前只实现了 H5；小程序分支在 Phase 2 补齐
  return mountStageH5(hostId)
}
