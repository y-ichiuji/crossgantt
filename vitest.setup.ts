// vitest の globals を有効にしていない（describe / it は明示的に import している）ため、
// Testing Library の自動 cleanup は働かない。ここで自前で片付ける必要がある。
// oxlint-disable-next-line testing-library/no-manual-cleanup
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/** クライアントテストの共通セットアップ。各テストの後に DOM を片付ける。 */
afterEach(() => {
  cleanup()
  localStorage.clear()
})
