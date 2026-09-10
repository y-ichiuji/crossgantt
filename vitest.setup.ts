import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/** クライアントテストの共通セットアップ。各テストの後に DOM を片付ける。 */
afterEach(() => {
  cleanup()
  localStorage.clear()
})
