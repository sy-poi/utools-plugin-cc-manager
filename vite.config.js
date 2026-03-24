import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// 构建时将 SVG logo 转为 PNG
function svgToPngPlugin() {
  return {
    name: 'svg-to-png',
    async writeBundle(options) {
      const sharp = (await import('sharp')).default
      const svgPath = resolve(__dirname, 'public/logo.svg')
      const outDir = options.dir || resolve(__dirname, 'dist')
      const svgBuffer = readFileSync(svgPath)
      await sharp(svgBuffer).resize(256, 256).png().toFile(resolve(outDir, 'logo.png'))
      console.log('\x1b[32m✓\x1b[0m logo.svg → logo.png (256x256)')
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), svgToPngPlugin()],
  base: './'
})
