// vitest の globals を有効にしていない（describe / it は明示的に import している）ため、
// Testing Library の自動 cleanup は働かない。ここで自前で片付ける必要がある。
// oxlint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import { resetBootstrap } from './src/client/bootstrap'
import { resetIconCache } from './src/client/icons'

/**
 * クライアントテストの共通セットアップ。
 *
 * DOM に加えて、モジュールに閉じた状態（起動時の設定とアイコンの取得結果）も
 * 捨てる。これらはテストをまたいで残ると結果が前のテストに依存してしまう。
 */
afterEach(() => {
  cleanup()
  localStorage.clear()
  resetBootstrap()
  resetIconCache()
})
