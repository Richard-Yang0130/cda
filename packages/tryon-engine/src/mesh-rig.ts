/**
 * MakeHuman CC0 雕刻网格的关键点数据。
 *
 * 这些数字是**实测出来的**，不是估的 ——
 * MakeHuman 的 proxy OBJ 没有顶点组（`g` 行数为 0），拿不到现成骨架，
 * 只能从几何本身逐层分析得出。测量脚本见 scripts/measure-mesh.py（可重跑复核）。
 *
 * 采集方法：以身体中轴为原点归一化（脚底 y=0，头顶 y=1），
 * 按高度切片统计水平半径，从腰部骤宽处（手臂）与骤窄处（颈）定出关节。
 *
 * 用途：把这块网格**重新拟合**到用户的身型数据上。
 * 解剖细节来自雕刻（我们生成不了），体型变化由耦合模型驱动（我们自己的成果）。
 */

export interface MeshRig {
  /** 归一化身高处的关节位置（0 = 脚底，1 = 头顶） */
  ankle: number
  knee: number
  crotch: number
  hip: number
  waist: number
  chest: number
  shoulder: number
  chin: number
  /** 该网格的原始身高（模型单位），用于换算到米 */
  rawHeight: number
}

/**
 * 实测值。male_muscle_13290（13290 顶点 / 13288 四边形面）。
 *
 * 注意这几个高度与 body.ts 里 buildSkeleton 的比例**不完全一致** ——
 * 那是按人体测量均值推的，这是真实雕刻的实际比例。
 * 做重拟合时必须以这里的值为准，否则关节会对不上。
 */
export const MALE_MESH_RIG: MeshRig = {
  ankle: 0.075,
  knee: 0.28,
  crotch: 0.5,
  hip: 0.53,
  waist: 0.6,
  chest: 0.72,
  shoulder: 0.82,
  chin: 0.87,
  rawHeight: 17.48,
}

export const FEMALE_MESH_RIG: MeshRig = {
  ankle: 0.075,
  knee: 0.28,
  crotch: 0.5,
  hip: 0.53,
  waist: 0.6,
  chest: 0.72,
  shoulder: 0.82,
  chin: 0.87,
  rawHeight: 17.48,
}

/**
 * ⚠️ 打包体积是一个必须提前面对的问题。
 *
 * male.obj 1.17MB + female.obj 1.30MB = 2.5MB 纯 OBJ 文本。
 * 微信小程序主包上限 2MB（分包总计 20MB），所以**不能直接打进主包**。
 *
 * 处理方向（按优先级）：
 *   1. 转成 GLB 并对顶点/索引做 Draco 压缩，通常能压到原体积的 15–25%
 *   2. 按性别分包，首次进入试穿页时再拉取
 *   3. 若仍不够，对网格做一次简化（13k 顶点里有很多落在脚趾、耳朵等
 *      试穿场景看不清的部位）
 */
export const MESH_SIZE_WARNING = true
