import { defineConfig } from 'vitest/config'

/**
 * テストは実装ファイルと同じディレクトリに `*.test.ts(x)` として置く。
 *
 * サーバー・共有ロジックは Node 環境、クライアントは DOM が必要なため
 * happy-dom 環境で動かす。両者を projects で分けている。
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['src/**/*.test.ts'],
          exclude: ['src/client/**'],
          environment: 'node'
        }
      },
      {
        test: {
          name: 'client',
          include: ['src/client/**/*.test.ts', 'src/client/**/*.test.tsx'],
          environment: 'happy-dom',
          setupFiles: ['./vitest.setup.ts']
        }
      }
    ]
  }
})
