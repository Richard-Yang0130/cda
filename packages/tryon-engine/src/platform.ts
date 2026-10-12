/**
 * 平台桥接层 —— tryon-engine 最关键的架构约束。
 *
 * 背景：微信小程序**没有 DOM**，不能直接 `new THREE.WebGLRenderer()`，
 * 也不存在 `document` / `window`。如果引擎里任何地方直接引用它们，
 * 到 Phase 2 接小程序时整个 3D 模块都要重写。
 *
 * 所以：引擎本体只使用 Three.js 的场景图与数学部分（它们不依赖 DOM），
 * 所有与渲染器 / canvas / 帧循环 / 事件相关的能力，一律从这里注入。
 *
 * H5 与 App 端用 `createH5Platform()`；
 * 小程序端后续实现 `createMpWeixinPlatform()`，把 canvas 换成
 * `wx.createSelectorQuery()` 拿到的节点即可，其余逻辑完全复用。
 *
 * 注意：Three.js 在模块顶层静态导入是**安全**的 —— 它的核心（场景图、数学、
 * 几何）不触碰 DOM。真正依赖 DOM 的只有 WebGLRenderer 的构造，而它被封装在
 * createRenderer() 里，只有浏览器环境才会调用。
 */
import * as THREE from 'three'

/** 最小 canvas 抽象：H5 下是 HTMLCanvasElement，小程序下是 canvas 节点 */
export interface CanvasLike {
  width: number
  height: number
  style?: { width?: string; height?: string }
  getContext?: (type: string, opts?: unknown) => unknown
  addEventListener?: (type: string, handler: (ev: unknown) => void) => void
  removeEventListener?: (type: string, handler: (ev: unknown) => void) => void
}

/** 最小渲染器抽象 */
export interface RendererLike {
  setSize(width: number, height: number, updateStyle?: boolean): void
  setPixelRatio(ratio: number): void
  render(scene: unknown, camera: unknown): void
  dispose(): void
  domElement?: unknown
}

/** 指针事件的最小描述（三端统一） */
export interface PointerLike {
  /** 相对 canvas 的 x，单位 px */
  x: number
  y: number
}

export interface TryonPlatform {
  readonly name: 'h5' | 'mp-weixin' | 'app'
  /** 创建渲染器 */
  createRenderer(canvas: CanvasLike, opts?: { antialias?: boolean; alpha?: boolean }): RendererLike
  /** 创建一个 canvas（小程序端不实现，由宿主传入） */
  createCanvas?(): CanvasLike
  /** 帧循环 */
  requestFrame(cb: (time: number) => void): number
  cancelFrame(handle: number): void
  /** 设备像素比 */
  getPixelRatio(): number
  /** 高精度时间戳 */
  now(): number
}

/**
 * H5 / App(webview) 平台实现。
 * 注意：所有 DOM 访问都写在函数体内部，只有真正在浏览器环境调用时才求值。
 */
export function createH5Platform(): TryonPlatform {
  return {
    name: 'h5',

    createRenderer(canvas, opts) {
      const renderer = new THREE.WebGLRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        antialias: opts?.antialias ?? true,
        alpha: opts?.alpha ?? true,
        preserveDrawingBuffer: true,
      })
      return renderer as unknown as RendererLike
    },

    createCanvas() {
      return document.createElement('canvas') as unknown as CanvasLike
    },

    requestFrame(cb) {
      if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
      return setTimeout(() => cb(Date.now()), 16) as unknown as number
    },

    cancelFrame(handle) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
    },

    getPixelRatio() {
      return Math.min(globalThis.devicePixelRatio || 1, 2)
    },

    now() {
      return globalThis.performance?.now?.() ?? Date.now()
    },
  }
}
