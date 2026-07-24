import { build } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync } from 'fs'

const root = dirname(fileURLToPath(import.meta.url))

const entries = [
  { name: 'background', input: 'src/background.ts', format: 'es' },
  { name: 'content/selection', input: 'src/content/selection.ts', format: 'iife' },
  { name: 'content/page-translate', input: 'src/content/page-translate.ts', format: 'iife' },
  { name: 'popup/popup', input: 'src/popup/popup.ts', format: 'es' },
  { name: 'options/options', input: 'src/options/options.ts', format: 'es' }
]

const dist = resolve(root, 'dist')
if (existsSync(dist)) rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

for (const entry of entries) {
  await build({
    root,
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      target: 'es2022',
      modulePreload: false,
      rollupOptions: {
        input: resolve(root, entry.input),
        output: {
          format: entry.format,
          entryFileNames: `${entry.name}.js`,
          inlineDynamicImports: true,
          name: entry.format === 'iife' ? entry.name.replace(/\W/g, '_') : undefined
        }
      }
    }
  })
}

cpSync(resolve(root, 'icons'), resolve(dist, 'icons'), { recursive: true })

// 版本与仓库根 package.json 对齐，写入 dist/manifest（避免扩展与桌面版本漂移）
const repoVersion = JSON.parse(
  readFileSync(resolve(root, '../../package.json'), 'utf8')
).version
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
manifest.version = repoVersion
writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
// 同步源文件，便于 Load unpacked 以外的场景也一致
writeFileSync(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const extPkgPath = resolve(root, 'package.json')
const extPkg = JSON.parse(readFileSync(extPkgPath, 'utf8'))
if (extPkg.version !== repoVersion) {
  extPkg.version = repoVersion
  writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + '\n')
}

/**
 * Emit popup/options HTML next to their JS under dist/.
 * Covers source `./foo.ts`, Vite absolute `/popup/…`, and relative `../../popup/…`
 * so Load unpacked resolves within dist/ (Task 5 path fix).
 */
function rewriteExtensionHtml(html, scriptSrc) {
  return html
    .replace(/src="\.\/[^"]+\.(?:ts|js)"/g, `src="${scriptSrc}"`)
    .replace(/src="(?:\.\/|\.\.\/)+(?:popup|options)\/[^"]+\.(?:js|ts)"/g, `src="${scriptSrc}"`)
    .replace(/src="\/(?:popup|options)\/[^"]+\.(?:js|ts)"/g, `src="${scriptSrc}"`)
}

for (const p of [
  { src: 'src/popup/popup.html', dest: 'dist/popup/popup.html', script: './popup.js' },
  { src: 'src/options/options.html', dest: 'dist/options/options.html', script: './options.js' }
]) {
  const to = resolve(root, p.dest)
  mkdirSync(dirname(to), { recursive: true })
  const html = rewriteExtensionHtml(readFileSync(resolve(root, p.src), 'utf8'), p.script)
  writeFileSync(to, html)
}

console.log('extension build complete → dist/')
