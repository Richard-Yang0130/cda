import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url))

export default defineConfig({
  plugins: [uni()],

  resolve: {
    alias: {
      // 把工作区源码包直接指向真实源码路径。
      //
      // 为什么必须这样（已实际踩到两次）：
      //   1. 不设 exclude 时，Vite 会把它们预打包进 node_modules/.vite/deps 并缓存，
      //      改源码后页面完全不更新；
      //   2. 即使 exclude 了，Vite 的文件监视器默认忽略 node_modules 下的内容，
      //      而 pnpm 工作区包是通过符号链接挂在 node_modules/@cda/ 下的，
      //      于是 HMR 收不到变更 —— 表现为「改了代码、截图却一模一样」。
      //
      // 用 alias 指到 packages 下各包的 src 后，它们就是普通的项目内文件，
      // 既会被正确监视，也能享受正常 HMR。
      '@cda/core': pkg('core'),
      '@cda/tryon-engine': pkg('tryon-engine'),
    },
  },

  optimizeDeps: {
    exclude: ['@cda/core', '@cda/tryon-engine'],
  },

  server: {
    // 监听 0.0.0.0 以便手机在同一局域网内访问（发给用户试用）
    host: '0.0.0.0',
    port: 5173,
  },
})
