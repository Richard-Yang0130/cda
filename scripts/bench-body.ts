/**
 * 人台生成性能基准。
 *
 * 用途：验证「轻量化」这个要求是否达标 —— 多边形化是 CPU 密集操作，
 * 必须知道它在量产手机上大概什么量级，而不是凭感觉说「应该够快」。
 *
 * 跑法（TS 需要先打包）：
 *   node_modules/.bin/esbuild scripts/bench-body.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/bench.mjs && node /tmp/bench.mjs
 */
import { createBodyModel, buildMannequin } from '../packages/tryon-engine/src/body'
import { defaultBodyProfile } from '../packages/core/src/mock'
import type { Gender } from '../packages/core/src/types'

function triangleCount(group: { traverse: (cb: (o: unknown) => void) => void }): number {
  let tris = 0
  group.traverse((o) => {
    const mesh = o as { geometry?: { index?: { count: number } } }
    if (mesh.geometry?.index) tris += mesh.geometry.index.count / 3
  })
  return Math.round(tris)
}

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000

for (const gender of ['female', 'male'] as Gender[]) {
  const profile = defaultBodyProfile(gender)

  // 预热一次，避免把 JIT 编译时间算进去
  createBodyModel(profile)

  const t0 = now()
  const model = createBodyModel(profile)
  const tModel = now() - t0

  const t1 = now()
  const finalGroup = buildMannequin(model, 'final')
  const tFinal = now() - t1

  const t2 = now()
  const previewGroup = buildMannequin(model, 'preview')
  const tPreview = now() - t2

  console.log(
    `${gender.padEnd(6)} 建模(骨架+SDF)=${tModel.toFixed(1)}ms  ` +
      `全精度网格=${tFinal.toFixed(1)}ms(${triangleCount(finalGroup)} 三角面)  ` +
      `预览网格=${tPreview.toFixed(1)}ms(${triangleCount(previewGroup)} 三角面)`,
  )
}
