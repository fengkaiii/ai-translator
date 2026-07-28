import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 共享包是 TS 源码，需打进 bundle，不能当 node 外部依赖
const bundleWorkspace = externalizeDepsPlugin({
  exclude: ['@ai-translator/translate-core', '@ai-translator/clipboard-history']
})

export default defineConfig({
  main: {
    plugins: [bundleWorkspace],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [bundleWorkspace],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          'clipboard-history': resolve(__dirname, 'clipboard-history.html')
        }
      }
    },
    plugins: [react()]
  }
})
