import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs'
import { defineConfig, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Flatten Vite HTML output into dist/popup and dist/options */
function flattenHtml(): Plugin {
  return {
    name: 'flatten-extension-html',
    closeBundle() {
      const moves = [
        {
          from: 'dist/src/popup/popup.html',
          to: 'dist/popup/popup.html',
          fix: (html: string) =>
            html
              .replace(/src="\/popup\/popup\.js"/g, 'src="./popup.js"')
              .replace(/src="\/chunks\//g, 'src="../chunks/')
              .replace(/href="\/chunks\//g, 'href="../chunks/')
        },
        {
          from: 'dist/src/options/options.html',
          to: 'dist/options/options.html',
          fix: (html: string) =>
            html
              .replace(/src="\/options\/options\.js"/g, 'src="./options.js"')
              .replace(/src="\/chunks\//g, 'src="../chunks/')
              .replace(/href="\/chunks\//g, 'href="../chunks/')
        }
      ]
      for (const m of moves) {
        const from = resolve(__dirname, m.from)
        if (!existsSync(from)) continue
        const to = resolve(__dirname, m.to)
        mkdirSync(dirname(to), { recursive: true })
        writeFileSync(to, m.fix(readFileSync(from, 'utf8')))
      }
      const stray = resolve(__dirname, 'dist/src')
      if (existsSync(stray)) rmSync(stray, { recursive: true, force: true })
    }
  }
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        'content/selection': resolve(__dirname, 'src/content/selection.ts'),
        'content/page-translate': resolve(__dirname, 'src/content/page-translate.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.html'),
        'options/options': resolve(__dirname, 'src/options/options.html')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'icons/*', dest: 'icons' }
      ]
    }),
    flattenHtml()
  ]
})
