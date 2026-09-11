import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * クライアント（ブラウザで動く部分）のビルド設定。
 *
 * 成果物は Apps Script の HTML へ丸ごと差し込むため、JS と CSS を
 * それぞれ 1 ファイルにまとめる。分割して読み込むための URL が
 * Web アプリ側に存在しないためである。
 *
 * サーバー（Apps Script 上で動く部分）は esbuild で別にまとめる。
 * 組み立ては scripts/build-gas.mjs が行う。
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: true,
    // 別ファイルを先読みさせる仕組みは使えない。
    modulePreload: false,
    rolldownOptions: {
      input: 'src/client/index.tsx',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]'
      }
    }
  }
})
