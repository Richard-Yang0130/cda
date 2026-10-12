<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  console.log('[CDA] App launched')
})
</script>

<style>
page {
  background-color: #f5f5f7;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
  color: #1a1a1a;
}

/*
 * uni-app H5 下 <text> 默认是 inline，长句子在部分布局里不会正确换行，
 * 会把卡片撑破、导致整页横向溢出（曾出现推荐语和脚注被右边缘截断）。
 * 这里统一约束常用的长文本类为块级并允许任意位置断行。
 */
.intro-line,
.reason,
.footnote text,
.sim-note text,
.warn text,
.cand-reason,
.row-meta-text {
  display: block;
  width: 100%;
  box-sizing: border-box;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}
</style>
