/**
 * 照片人体比例估算。
 *
 * ── 这个模块解决什么 ──
 * MakeHuman 人偶的痛点是「用户要填一大堆身体数据」。实际上用户最愿意做的
 * 是拍一张全身照，所以这里把照片变成**比例参数**，直接驱动现有人偶。
 *
 * ── 一个必须说清的边界 ──
 * **单张正面照片无法可靠测量围度。** 正面只能看到宽度，看不到身体厚度：
 * 同样是腰部 30cm 宽的人，可能是「正面窄、身体厚」也可能是「正面宽、身体薄」，
 * 围度可以差出一个尺码。所以这里：
 *   ✅ 只估**长度与宽度比例**（肩宽、颈长、躯干长、四肢长）
 *   ❌ 不估胸围/腰围/臀围 —— 那继续由身高体重先验（estimateGirths）负责
 * 这既避免了伪造用户数据，也让两类信息各司其职：
 *   比例来自照片（个性化），围度来自身高体重（生理可信）。
 *
 * ── 为什么围度不能从照片「顺便估一下」 ──
 * 宽松衣服会把轮廓撑大，用户会被估胖一到两个尺码。这是任何单图方案
 * 都解决不了的问题（PIFuHD 这类重建同样无法穿透衣服），不要假装能解决。
 *
 * ── 纯函数设计 ──
 * 入参是**关键点数组**，不是图片。这样：
 *   1. 算法可在 Node 里用合成数据穷举测试，不需要浏览器
 *   2. 换检测模型（MediaPipe / 其他）不影响这里
 *   3. 照片永远不必离开用户设备
 */

import type { BodyState, FrameKey } from '../body-model'
// Gender 定义在 types.ts，body-model 只是内部引用它 —— 从源头导入而不是转发
import type { Gender } from '../types'
import { FRAME_RANGES, HEIGHT_RANGE, setFrame, setHeight } from '../body-model'

/** 算法版本。改了映射逻辑就递增，便于对比不同版本的结果 */
export const PROPORTION_ALGO_VERSION = '1.0.0'

/**
 * MediaPipe Pose 的 33 个关键点索引。
 * 只列出用到的，避免魔法数字散落在计算里。
 */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
} as const

export interface PosePoint {
  x: number
  y: number
  z?: number
  /** 0..1，模型给出的「该点可见且未被遮挡」的置信度 */
  visibility?: number
}

/** 人体像素范围（归一化 0..1，y 向下）。来自分割掩膜，比关键点外推更可靠 */
export interface PersonBounds {
  top: number
  bottom: number
  left: number
  right: number
}

export type QualityCode =
  | 'no_person'
  | 'multiple_people'
  | 'not_full_body'
  | 'too_small'
  | 'not_frontal'
  | 'arms_not_apart'
  | 'low_visibility'
  | 'height_out_of_range'
  | 'low_confidence'

export interface QualityIssue {
  code: QualityCode
  message: string
  /** block = 不能继续；warn = 可以继续但结果不可靠 */
  severity: 'block' | 'warn'
}

export interface FrameEstimate {
  key: FrameKey
  /** 估算值（未夹紧） */
  valueCm: number
  /** 0..1 */
  confidence: number
  /** 夹紧到 FRAME_RANGES 之后实际会写入的值 */
  clampedCm: number
  /** 是否被范围夹紧（说明照片结果超出现有模型的合法区间） */
  clamped: boolean
}

export interface ProportionInput {
  /** 33 个关键点（归一化坐标）。人不在画面里时传空数组 */
  landmarks: PosePoint[]
  /** 检测到的人数。>1 直接拒绝 —— 无法判断该用谁 */
  personCount: number
  /** 图片宽高比 width/height。x 与 y 的归一化尺度不同，算距离必须换算 */
  aspect: number
  /** 真实身高（cm）。没有它就得不到绝对尺度 —— 这是唯一必须用户输入的量 */
  heightCm: number
  gender: Gender
  /** 人体外接框（归一化）。有分割掩膜时传入，用于判断是否全身入镜 */
  bounds?: PersonBounds
}

export interface ProportionResult {
  version: string
  heightCm: number
  /** 头顶到脚底的像素高度（以「图片高度」为单位） */
  pixelHeight: number
  frames: FrameEstimate[]
  quality: QualityIssue[]
  /** 综合置信度 0..1 */
  confidence: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 可见度：缺字段时按 0.5 处理，不假装很确信也不直接丢弃 */
function vis(p: PosePoint | undefined): number {
  if (!p) return 0
  return typeof p.visibility === 'number' ? clamp01(p.visibility) : 0.5
}

function mid(a: PosePoint, b: PosePoint): PosePoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(vis(a), vis(b)),
  }
}

/**
 * 两点距离，单位是「图片高度」。
 *
 * ⚠️ 必须先乘 aspect：归一化坐标里 x 是「宽度占比」、y 是「高度占比」，
 * 直接 hypot(dx, dy) 会把距离算歪（非正方形图片下误差可达 30%+）。
 */
function dist(a: PosePoint, b: PosePoint, aspect: number): number {
  const dx = (a.x - b.x) * aspect
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}

/** 垂直距离（只看 y），用于长度类测量 */
function vdist(a: PosePoint, b: PosePoint): number {
  return Math.abs(a.y - b.y)
}

/** 左右取平均：两侧都可信时更稳，只有一侧时用单侧并降低置信度 */
function bilateral<T>(
  leftFn: () => T,
  rightFn: () => T,
  avg: (l: T, r: T) => T,
  leftOk: boolean,
  rightOk: boolean,
): { value: T | null; confidence: number } {
  if (leftOk && rightOk) return { value: avg(leftFn(), rightFn()), confidence: 1 }
  if (leftOk) return { value: leftFn(), confidence: 0.6 }
  if (rightOk) return { value: rightFn(), confidence: 0.6 }
  return { value: null, confidence: 0 }
}

function avgNum(l: number, r: number): number {
  return (l + r) / 2
}

export function estimateBodyProportion(input: ProportionInput): ProportionResult {
  const { landmarks: lm, personCount, aspect, heightCm, bounds } = input
  const quality: QualityIssue[] = []

  // ── 前置校验：人数 ──
  if (personCount === 0 || lm.length < 33) {
    quality.push({ code: 'no_person', message: '没有检测到人物，请重新拍摄', severity: 'block' })
    return emptyResult(heightCm, quality)
  }
  if (personCount > 1) {
    quality.push({ code: 'multiple_people', message: '画面里有不止一个人，请只拍一个人', severity: 'block' })
    return emptyResult(heightCm, quality)
  }

  // ── 身高校验：超出现有模型区间时明确拒绝，而不是静默夹紧 ──
  const hr = HEIGHT_RANGE[input.gender]
  if (heightCm < hr.min || heightCm > hr.max) {
    quality.push({
      code: 'height_out_of_range',
      message: `当前人偶支持 ${hr.min}–${hr.max}cm，${heightCm}cm 无法准确生成`,
      severity: 'block',
    })
    return emptyResult(heightCm, quality)
  }

  const p = (i: number): PosePoint | undefined => lm[i]

  // ── 像素高度 ──
  // 优先用分割掩膜的外接框（含头顶与脚底，最可靠）；
  // 没有掩膜时用「耳朵/鼻子上方 + 脚踝下方」外推，并降低置信度。
  let pixelHeight: number
  let heightConfidence: number
  if (bounds && bounds.bottom > bounds.top) {
    pixelHeight = bounds.bottom - bounds.top
    heightConfidence = 1
  } else {
    const headCandidates = [p(LM.nose), p(LM.leftEar), p(LM.rightEar)].filter(Boolean) as PosePoint[]
    const footCandidates = [p(LM.leftAnkle), p(LM.rightAnkle), p(LM.leftHeel), p(LM.rightHeel)].filter(Boolean) as PosePoint[]
    if (!headCandidates.length || !footCandidates.length) {
      quality.push({ code: 'low_visibility', message: '看不清头顶或脚部，请拍摄完整全身', severity: 'block' })
      return emptyResult(heightCm, quality)
    }
    const topY = Math.min(...headCandidates.map((q) => q.y))
    const bottomY = Math.max(...footCandidates.map((q) => q.y))
    // 头顶约在耳朵上方 8% 身高、脚底约在脚踝下方 4% 身高（经验修正）
    const span = bottomY - topY
    pixelHeight = span * 1.12
    heightConfidence = 0.7
  }

  if (pixelHeight <= 0.01) {
    quality.push({ code: 'no_person', message: '检测结果异常，请重新拍摄', severity: 'block' })
    return emptyResult(heightCm, quality)
  }

  // ── 构图检查 ──
  if (bounds) {
    const span = bounds.bottom - bounds.top
    if (span < 0.55) {
      quality.push({ code: 'too_small', message: '人物在画面里太小，请靠近一些重拍', severity: 'block' })
    }
    if (bounds.top < 0.015 || bounds.bottom > 0.985) {
      quality.push({ code: 'not_full_body', message: '头顶或脚底可能被裁掉了，请把全身拍完整', severity: 'warn' })
    }
  }

  /** 归一化长度 → 厘米 */
  const toCm = (units: number) => (units / pixelHeight) * heightCm

  const shL = p(LM.leftShoulder)
  const shR = p(LM.rightShoulder)
  const elL = p(LM.leftElbow)
  const elR = p(LM.rightElbow)
  const wrL = p(LM.leftWrist)
  const wrR = p(LM.rightWrist)
  const hpL = p(LM.leftHip)
  const hpR = p(LM.rightHip)
  const knL = p(LM.leftKnee)
  const knR = p(LM.rightKnee)
  const anL = p(LM.leftAnkle)
  const anR = p(LM.rightAnkle)

  if (!shL || !shR || !hpL || !hpR) {
    quality.push({ code: 'low_visibility', message: '肩部或髋部不可见，无法测量躯干，请正对镜头重拍', severity: 'block' })
    return emptyResult(heightCm, quality)
  }

  const shoulderMid = mid(shL, shR)
  const hipMid = mid(hpL, hpR)

  // ── 姿态检查：是否正对镜头 ──
  // 转身时两肩的 z 差会明显变大（z 是相对髋部的深度）
  const shoulderDepth = Math.abs((shL.z ?? 0) - (shR.z ?? 0))
  const shoulderWidthPx = dist(shL, shR, aspect)
  if (shoulderWidthPx > 0 && shoulderDepth / Math.max(1e-6, shoulderWidthPx) > 0.55) {
    quality.push({ code: 'not_frontal', message: '身体似乎侧转了，请正对镜头重拍', severity: 'warn' })
  }
  // 肩宽明显小于髋宽也可能是侧身
  const hipWidthPx = dist(hpL, hpR, aspect)
  if (shoulderWidthPx < hipWidthPx * 0.75) {
    quality.push({ code: 'not_frontal', message: '肩宽看起来偏窄，可能侧身了', severity: 'warn' })
  }

  // ── 姿态检查：手臂是否贴着身体 ──
  /*
   * 判据是**手腕相对肩线的水平位置**，不是「手腕离髋部多远」。
   *
   * 后者会误判：自然下垂时手腕本就在髋外侧（肩半宽约 21cm、髋半宽约 15cm），
   * 按「离髋近」判断会把正常站姿也报成手臂贴身。
   * 而手臂真正贴住身体时，手腕会明显收进肩线以内。
   *
   * 说明：本模块测的是**关节间距**而非轮廓，所以手臂贴身其实不会直接
   * 污染测量结果；这条提示的意义在于此时 MediaPipe 的关键点误差更大，
   * 因此只作告警、不阻断。
   */
  const wrist = wrL && wrR ? (vis(wrL) >= vis(wrR) ? wrL : wrR) : (wrL ?? wrR)
  if (wrist) {
    const shoulderHalf = shoulderWidthPx / 2
    const wristOffset = Math.abs((wrist.x - shoulderMid.x) * aspect)
    if (shoulderHalf > 1e-6 && wristOffset < shoulderHalf * 0.85) {
      quality.push({ code: 'arms_not_apart', message: '手臂贴着身体，请稍微张开手臂重拍', severity: 'warn' })
    }
  }

  const frames: FrameEstimate[] = []

  const push = (
    key: FrameKey,
    valueCm: number | null,
    confidence: number,
    extra = 0,
  ): void => {
    if (valueCm === null || !Number.isFinite(valueCm)) return
    const range = FRAME_RANGES[key]
    const clampedCm = Math.round(Math.min(range.max, Math.max(range.min, valueCm)) * 10) / 10
    const clamped = Math.abs(clampedCm - valueCm) > 0.05
    // 被夹紧说明照片结果与模型区间冲突，此时不该再给它高置信度
    const finalConf = clamp01((confidence * heightConfidence) - (clamped ? 0.3 : 0) + extra)
    frames.push({
      key,
      valueCm: Math.round(valueCm * 10) / 10,
      confidence: finalConf,
      clampedCm,
      clamped,
    })
  }

  // 肩宽：肩峰间距
  push('shoulderWidthCm', toCm(shoulderWidthPx), Math.min(vis(shL), vis(shR)))

  // 颈长：肩线 → 耳中（MediaPipe 没有下巴点，用耳中近似头颈交界）
  const earL = p(LM.leftEar)
  const earR = p(LM.rightEar)
  if (earL && earR) {
    const earMid = mid(earL, earR)
    push('neckLengthCm', toCm(vdist(shoulderMid, earMid)), Math.min(vis(earL), vis(earR)))
  }

  // 躯干长：肩线中点 → 髋线中点
  push('torsoLengthCm', toCm(vdist(shoulderMid, hipMid)), Math.min(vis(shL), vis(shR), vis(hpL), vis(hpR)))

  // 大臂：肩 → 肘
  {
    const r = bilateral(
      () => dist(shL!, elL!, aspect),
      () => dist(shR!, elR!, aspect),
      avgNum,
      !!elL && vis(elL) > 0.5,
      !!elR && vis(elR) > 0.5,
    )
    push('upperArmCm', r.value === null ? null : toCm(r.value), r.confidence * 0.95)
  }

  // 小臂：肘 → 腕
  {
    const r = bilateral(
      () => dist(elL!, wrL!, aspect),
      () => dist(elR!, wrR!, aspect),
      avgNum,
      !!elL && !!wrL && vis(wrL) > 0.5,
      !!elR && !!wrR && vis(wrR) > 0.5,
    )
    push('forearmCm', r.value === null ? null : toCm(r.value), r.confidence * 0.9)
  }

  // 大腿：髋 → 膝
  {
    const r = bilateral(
      () => dist(hpL!, knL!, aspect),
      () => dist(hpR!, knR!, aspect),
      avgNum,
      !!knL && vis(knL) > 0.5,
      !!knR && vis(knR) > 0.5,
    )
    push('thighCm', r.value === null ? null : toCm(r.value), r.confidence * 0.95)
  }

  // 小腿：膝 → 踝
  {
    const r = bilateral(
      () => dist(knL!, anL!, aspect),
      () => dist(knR!, anR!, aspect),
      avgNum,
      !!knL && !!anL && vis(anL) > 0.5,
      !!knR && !!anR && vis(anR) > 0.5,
    )
    push('calfCm', r.value === null ? null : toCm(r.value), r.confidence * 0.9)
  }

  // 关键点整体可见度
  const tracked = [
    LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip,
    LM.leftElbow, LM.rightElbow, LM.leftKnee, LM.rightKnee,
  ].map((i) => vis(lm[i]))
  const avgVis = tracked.reduce((a, b) => a + b, 0) / tracked.length
  if (avgVis < 0.6) {
    quality.push({ code: 'low_visibility', message: '部分身体部位看不清，结果可能不准', severity: 'warn' })
  }

  const confidence = frames.length
    ? frames.reduce((a, f) => a + f.confidence, 0) / frames.length
    : 0

  if (confidence < 0.4) {
    quality.push({ code: 'low_confidence', message: '这张照片的测量可信度偏低，建议重拍', severity: 'warn' })
  }

  return {
    version: PROPORTION_ALGO_VERSION,
    heightCm,
    pixelHeight,
    frames,
    quality,
    confidence: Math.round(confidence * 100) / 100,
  }
}

function emptyResult(heightCm: number, quality: QualityIssue[]): ProportionResult {
  return {
    version: PROPORTION_ALGO_VERSION,
    heightCm,
    pixelHeight: 0,
    frames: [],
    quality,
    confidence: 0,
  }
}

/** 是否有阻断性问题（有就不能继续） */
export function hasBlockingIssue(r: ProportionResult): boolean {
  return r.quality.some((q) => q.severity === 'block')
}

export interface ApplyOptions {
  /** 低于该置信度的字段保留原值。默认 0.5 —— 宁可少改，不可改错 */
  minConfidence?: number
}

export interface ApplyReport {
  state: BodyState
  applied: FrameKey[]
  skipped: FrameKey[]
}

/**
 * 把估算结果写入 BodyState。
 *
 * 三条必须遵守的规则：
 *   1. **先 setHeight 再 setFrame** —— setHeight 会按身高比例缩放所有 frame，
 *      顺序反了会把刚估出来的长度再乘一遍比例。
 *   2. **低置信字段保留原值**，不要用不确定的数据覆盖用户原来的设置。
 *   3. **不碰 adiposity / build** —— 那是体脂与形体风格，照片给不出可靠结论；
 *      围度继续由身高体重的先验模型决定。
 */
export function applyBodyProportionEstimate(
  current: BodyState,
  est: ProportionResult,
  opts: ApplyOptions = {},
): ApplyReport {
  const min = opts.minConfidence ?? 0.5
  let next = setHeight(current, est.heightCm)
  const applied: FrameKey[] = []
  const skipped: FrameKey[] = []

  for (const f of est.frames) {
    if (f.confidence < min) {
      skipped.push(f.key)
      continue
    }
    // 走 setFrame，由其统一夹紧 —— 不在调用方复制一份 clamp 逻辑
    next = setFrame(next, f.key, f.clampedCm)
    applied.push(f.key)
  }
  return { state: next, applied, skipped }
}
