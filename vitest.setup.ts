// vitest の globals を有効にしていない（describe / it は明示的に import している）ため、
// Testing Library の自動 cleanup は働かない。ここで自前で片付ける必要がある。
// oxlint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from '@testing-library/react'
// happy-dom は IndexedDB を持たないため、実装が使う API をここで補う。
// oxlint-disable-next-line import/no-unassigned-import
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach } from 'vitest'

import { resetBootstrap } from './src/client/bootstrap'
import { resetFilterStore } from './src/client/filter-store'
import { resetIconCache } from './src/client/icons'

/**
 * クライアントテストの共通セットアップ。
 *
 * DOM に加えて、モジュールに閉じた状態（起動時の設定・アイコンの取得結果・
 * IndexedDB に保存した表示条件）も捨てる。これらはテストをまたいで残ると
 * 結果が前のテストに依存してしまう。
 */
afterEach(() => {
  cleanup()
  localStorage.clear()
  resetBootstrap()
  resetIconCache()
  resetFilterStore()
  // IndexedDB は削除より作り直すほうが速く、消し忘れも起きない。
  globalThis.indexedDB = new IDBFactory()
})
