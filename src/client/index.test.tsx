import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installBootstrap, installScriptRun, removeBootstrap } from './test-utils'
import type { ScriptRunStub } from './test-utils'

let stub: ScriptRunStub | null = null

beforeEach(() => {
  vi.resetModules()
  document.body.replaceChildren()
  installBootstrap()
  // 起動直後にセッション確認へ行くため、未ログインの応答を返しておく。
  stub = installScriptRun(() => ({ ok: false, status: 401, error: 'ログインしていません', detail: null }))
})

afterEach(() => {
  stub?.restore()
  stub = null
  removeBootstrap()
  vi.restoreAllMocks()
})

describe('クライアントのエントリポイント', () => {
  it('#root があればアプリをマウントする', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    await import('./index')

    // createRoot().render() は非同期に反映されるため、描画されるまで待つ。
    // 未ログインの応答を返しているので、最終的にログイン画面になる。
    await waitFor(() => {
      expect(root.textContent).toContain('Backlog でログイン')
    })
  })

  it('#root が無ければ分かりやすいエラーを投げる', async () => {
    await expect(import('./index')).rejects.toThrow('マウント先の #root が見つかりません')
  })
})
