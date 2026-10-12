/**
 * TryonEngine —— 3D 试穿引擎的门面。
 *
 * 职责：
 *   - 管理 scene / camera / renderer / 帧循环
 *   - 根据 BodyProfile 生成并重建人偶
 *   - 增删服装图层、切换穿法、调扣子
 *   - 提供不依赖 DOM 的相机控制接口（供宿主绑定触摸/鼠标事件）
 *
 * 平台无关性：本文件不出现 document / window / addEventListener。
 * 渲染器由 platform 注入，事件由宿主转发，因此同一份代码可在
 * H5 / App(webview) / 微信小程序 上运行。
 */
import * as THREE from 'three'
import type { BodyProfile, GarmentDimensions, WearMode } from '@cda/core'
import { defaultBodyProfile } from '@cda/core'
import {
  buildMannequin,
  createBodyModel,
  type BodyModel,
  type MannequinQuality,
} from './body'
import { createGarment, type Garment } from './garment'
import { MeshBody } from './mesh-body'
import type { CanvasLike, RendererLike, TryonPlatform } from './platform'

export interface TryonEngineOptions {
  platform: TryonPlatform
  canvas: CanvasLike
  width: number
  height: number
  /** 初始身型；不传则用默认值 */
  bodyProfile?: BodyProfile
}

const DEFAULT_BODY: BodyProfile = defaultBodyProfile('female')

export class TryonEngine {
  private readonly platform: TryonPlatform
  private readonly canvas: CanvasLike
  private readonly renderer: RendererLike
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly world: THREE.Group

  private mannequin: THREE.Group | null = null
  /**
   * 雕刻网格人体。非空时**取代** SDF 人台。
   *
   * SDF 模型仍然保留（`this.model`），因为服装壳的射线求交依赖它 ——
   * 两者由同一份身型数据驱动，所以大致对齐。
   */
  private meshBody: MeshBody | null = null
  /** 脚下假阴影。用程序化纹理而非 shadowMap，移动端更省 */
  private groundShadow: THREE.Mesh | null = null
  /**
   * 身体模型（骨架 + 肉块 + SDF）。
   * 服装要靠它求表面半径，所以必须留一份给 garment 用。
   */
  private model: BodyModel
  private readonly garments = new Map<string, Garment>()
  /** 记住每件单品的成衣尺寸，身型变化后重建服装时要用 */
  private readonly garmentDimensions = new Map<string, GarmentDimensions>()

  private frameHandle: number | null = null
  private running = false
  private dirty = true

  /** 相机轨道参数 */
  private azimuth = 0
  private elevation = 0.06
  private distance = 2.7
  /** 由身高推导出的「刚好装下全身」的距离，缩放以此为基准 */
  private baseDistance = 2.7
  private targetY = 0.95

  private width: number
  private height: number

  constructor(opts: TryonEngineOptions) {
    this.platform = opts.platform
    this.canvas = opts.canvas
    this.width = opts.width
    this.height = opts.height
    this.model = createBodyModel({ ...DEFAULT_BODY, ...(opts.bodyProfile ?? {}) })

    this.renderer = this.platform.createRenderer(this.canvas, { antialias: true, alpha: true })
    this.renderer.setPixelRatio(this.platform.getPixelRatio())
    this.renderer.setSize(this.width, this.height, false)

    this.scene = new THREE.Scene()
    this.world = new THREE.Group()
    this.scene.add(this.world)

    this.camera = new THREE.PerspectiveCamera(34, this.width / this.height, 0.05, 50)

    this.setupLights()
    this.groundShadow = this.createGroundShadow()
    this.scene.add(this.groundShadow)
    this.rebuildMannequin()
    this.frameBody()
    this.updateCamera()
  }

  /**
   * 生成脚下的柔和阴影。
   *
   * 刻意不用 renderer.shadowMap：真实阴影贴图在移动端开销明显，
   * 而这里只需一个「落地感」。用 DataTexture 程序化画径向渐变，
   * 既省 GPU，又**完全不依赖 DOM**（不能用 document.createElement('canvas')，
   * 否则小程序端会直接崩）。
   */
  private createGroundShadow(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial({
      map: createRadialShadowTexture(),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = -1
    return mesh
  }

  // ------------------------------------------------------------ 初始化

  private setupLights(): void {
    // 环境光压低：白模靠明暗塑形，环境光过强会一片死白、失去体积感
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb9b2a8, 0.55)
    this.scene.add(hemi)

    // 主光：左上前方
    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(1.8, 3.4, 2.6)
    this.scene.add(key)

    // 辅光：右侧补暗部，避免死黑
    const fill = new THREE.DirectionalLight(0xffffff, 0.6)
    fill.position.set(-2.4, 1.4, 1.4)
    this.scene.add(fill)

    // 轮廓光：从背后打，勾出白色人台与背景的分界。
    // 白模最不能缺的就是这一盏 —— 没有它，白色形体边缘会溶进背景
    const rim = new THREE.DirectionalLight(0xffffff, 1.5)
    rim.position.set(-0.8, 1.8, -3.2)
    this.scene.add(rim)
  }

  /**
   * 重建人台网格。
   * preview 会显著提高体素边长 —— 拖动滑杆时用它保持跟手。
   */
  private rebuildMannequin(quality: MannequinQuality = 'final'): void {
    // 用雕刻网格时不必重建 SDF 人台 —— 改体型从约 200ms 降到几毫秒
    if (this.meshBody) {
      this.meshBody.setProfile(this.model.profile)
      this.meshBody.object3D.visible = true
      if (this.mannequin) this.mannequin.visible = false
      const H0 = this.model.skeleton.height
      if (this.groundShadow) {
        const s0 = H0 / 1.68
        this.groundShadow.position.y = 0.004
        this.groundShadow.scale.set(s0, s0, s0)
      }
      this.dirty = true
      return
    }
    if (this.mannequin) {
      this.world.remove(this.mannequin)
      disposeObject(this.mannequin)
    }
    this.mannequin = buildMannequin(this.model, quality)
    this.world.add(this.mannequin)

    // 阴影贴在脚底，并随身高缩放
    const H = this.model.skeleton.height
    if (this.groundShadow) {
      const s = H / 1.68
      this.groundShadow.position.y = 0.004
      this.groundShadow.scale.set(s, s, s)
    }

    this.dirty = true
  }

  /**
   * 让相机恰好装下整个人偶。
   * 距离由身高与相机垂直 FOV 反解得到，因此改变身高后取景依然合理。
   */
  private frameBody(): void {
    const bodyHeight = this.model.skeleton.height
    this.targetY = bodyHeight * 0.5
    const fovRad = (this.camera.fov * Math.PI) / 180
    // 留 18% 余量，避免头顶/脚底贴边
    this.baseDistance = (bodyHeight * 1.18) / (2 * Math.tan(fovRad / 2))
    this.distance = this.baseDistance
  }

  // ------------------------------------------------------------ 身型

  /**
   * 更新身型数据。会重建身体模型、人台网格，并按其新体型重算所有已穿服装。
   *
   * quality='preview' 用于拖动滑杆的过程中：只降人台精度，
   * 服装仍会重算（否则衣服会在拖动时脱离身体），但整体开销可控。
   */
  setBodyProfile(profile: BodyProfile, quality: MannequinQuality = 'final'): void {
    this.model = createBodyModel(profile)
    this.rebuildMannequin(quality)
    this.frameBody()

    // 服装几何依赖身体截面，身型变了必须重建
    const entries = [...this.garments.entries()]
    for (const [productId] of entries) {
      const g = this.garments.get(productId)!
      const mode = g.wearMode
      const closed = g.fastenerClosed
      this.removeGarment(productId)
      const next = this.addGarment(productId)
      if (next) {
        next.setWearMode(mode)
        next.setFastenerClosed(closed)
      }
    }
    this.dirty = true
  }

  getBodyProfile(): BodyProfile {
    return { ...this.model.profile }
  }

  /**
   * 切换到雕刻网格人体。
   *
   * 解剖细节由 MakeHuman 的 CC0 雕刻提供，体型变化由耦合模型重拟合 ——
   * 见 mesh-body.ts 的算法说明。
   */
  async useMeshBody(url: string): Promise<void> {
    const profile = this.model.profile
    const mb = await MeshBody.loadFromUrl(url, profile, profile.gender)
    if (this.meshBody) {
      this.world.remove(this.meshBody.object3D)
      this.meshBody.dispose()
    }
    this.meshBody = mb
    this.world.add(mb.object3D)
    mb.setProfile(profile)
    if (this.mannequin) this.mannequin.visible = false
    this.dirty = true


  }

  /** 是否正在使用雕刻网格人体 */
  get usingMeshBody(): boolean {
    return this.meshBody !== null
  }

  // ------------------------------------------------------------ 服装

  /** 把一件单品穿到人偶上。返回该图层，若该单品无 3D 描述则返回 null */
  addGarment(productId: string, colorHex?: number, dimensions?: GarmentDimensions): Garment | null {
    const existing = this.garments.get(productId)
    if (existing) return existing

    if (dimensions) this.garmentDimensions.set(productId, dimensions)
    const dims = dimensions ?? this.garmentDimensions.get(productId)
    // 有雕刻网格时，服装按**网格的实际表面**求交
    const garment = createGarment(this.model, productId, colorHex, dims, this.meshBody ?? undefined)
    if (!garment) return null

    // 按 bodySlot 决定层级顺序，保证外套在外、内衣在里
    const order = this.world.children.filter((c) => c.name.startsWith('garment:')).length
    garment.object3D.renderOrder = order

    this.garments.set(productId, garment)
    this.world.add(garment.object3D)
    this.dirty = true
    return garment
  }

  removeGarment(productId: string): void {
    const g = this.garments.get(productId)
    if (!g) return
    this.world.remove(g.object3D)
    disposeObject(g.object3D)
    this.garments.delete(productId)
    this.dirty = true
  }

  clearGarments(): void {
    for (const id of [...this.garments.keys()]) this.removeGarment(id)
  }

  hasGarment(productId: string): boolean {
    return this.garments.has(productId)
  }

  listGarments(): string[] {
    return [...this.garments.keys()]
  }

  getGarment(productId: string): Garment | undefined {
    return this.garments.get(productId)
  }

  setWearMode(productId: string, mode: WearMode): void {
    this.garments.get(productId)?.setWearMode(mode)
    this.dirty = true
  }

  setFastenerClosed(productId: string, n: number): void {
    this.garments.get(productId)?.setFastenerClosed(n)
    this.dirty = true
  }

  setGarmentColor(productId: string, hex: number): void {
    this.garments.get(productId)?.setColor(hex)
    this.dirty = true
  }

  // ------------------------------------------------------------ 相机

  /** 绕人偶旋转。参数为像素位移 */
  orbit(dxPx: number, dyPx: number): void {
    this.azimuth -= dxPx * 0.008
    this.elevation = clamp(this.elevation + dyPx * 0.005, -0.5, 0.9)
    this.dirty = true
  }

  /** 缩放。delta 为滚轮量或捏合比例 */
  zoom(delta: number): void {
    this.distance = clamp(this.distance + delta * 0.0025, 1.2, 5.5)
    this.dirty = true
  }

  resetCamera(): void {
    this.azimuth = 0
    this.elevation = 0.06
    this.distance = this.baseDistance
    this.dirty = true
  }

  private updateCamera(): void {
    const r = this.distance
    const x = Math.sin(this.azimuth) * Math.cos(this.elevation) * r
    const y = this.targetY + Math.sin(this.elevation) * r
    const z = Math.cos(this.azimuth) * Math.cos(this.elevation) * r
    this.camera.position.set(x, y, z)
    this.camera.lookAt(0, this.targetY, 0)
  }

  // ------------------------------------------------------------ 生命周期

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.width = width
    this.height = height
    this.renderer.setPixelRatio(this.platform.getPixelRatio())
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.dirty = true
    this.renderOnce()
  }

  /** 渲染一帧 */
  renderOnce(): void {
    this.updateCamera()
    this.renderer.render(this.scene, this.camera)
    this.dirty = false
  }

  /** 启动帧循环。demo 阶段按需渲染：无变化时跳过重绘以省电 */
  start(): void {
    if (this.running) return
    this.running = true
    const loop = () => {
      if (!this.running) return
      if (this.dirty) this.renderOnce()
      this.frameHandle = this.platform.requestFrame(loop)
    }
    this.frameHandle = this.platform.requestFrame(loop)
  }

  stop(): void {
    this.running = false
    if (this.frameHandle !== null) {
      this.platform.cancelFrame(this.frameHandle)
      this.frameHandle = null
    }
  }

  dispose(): void {
    this.stop()
    this.clearGarments()
    if (this.mannequin) disposeObject(this.mannequin)
    this.renderer.dispose()
  }

  /** 暴露底层对象，供高级用法（如自定义拾取）使用 */
  get raw() {
    return {
      scene: this.scene,
      camera: this.camera,
      world: this.world,
      renderer: this.renderer,
      canvas: this.canvas,
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * 程序化生成径向渐变阴影贴图。
 * 与 document / canvas 无关，因此 H5 与微信小程序都能用。
 */
function createRadialShadowTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  const center = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) / center
      const dy = (y - center) / center
      const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy))
      // 中心最浓，向边缘平滑淡出
      const alpha = Math.pow(1 - dist, 2.4)
      const i = (y * size + x) * 4
      data[i] = 38
      data[i + 1] = 34
      data[i + 2] = 30
      data[i + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
}

/** 释放对象树上的几何与材质，避免热更新 / 切人偶时泄漏 */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) (mat as THREE.Material).dispose()
  })
}
