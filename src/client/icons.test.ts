import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { resetIconCache, useAssigneeIcon } from './icons'
import { installScriptRun } from './test-utils'
import type { ScriptRunCall, ScriptRunStub } from './test-utils'

let stub: ScriptRunStub | null = null

/** `icons` への呼び出しで頼まれた ID。 */
function requestedIds(calls: ScriptRunCall[]): string[][] {
  return calls.filter((call) => call.name === 'icons').map((call) => (call.params.userIds ?? '').split(','))
}

afterEach(() => {
  stub?.restore()
  stub = null
  resetIconCache()
})

describe('useAssigneeIcon', () => {
  it('まとめて 1 回で取りに行く', async () => {
    stub = installScriptRun(() => ({ ok: true as const, data: { 10: 'data:image/png;base64,a' } }))

    renderHook(() => useAssigneeIcon(10))
    renderHook(() => useAssigneeIcon(20))

    await waitFor(() => {
      expect(requestedIds(stub?.calls ?? [])).toEqual([['10', '20']])
    })
  })

  it('取得中に現れた ID のために、飛行中の ID を頼み直さない', async () => {
    // 待ち行列から外さないまま次の便を出すと、同じ ID を何度も頼むことになる。
    // アイコンはレート制限の区分がとりわけ厳しい。
    const pending: { release: (() => void) | null } = { release: null }
    stub = installScriptRun(async () => {
      await new Promise<void>((resolve) => {
        pending.release = resolve
      })
      return { ok: true as const, data: {} }
    })

    renderHook(() => useAssigneeIcon(10))
    renderHook(() => useAssigneeIcon(20))
    await waitFor(() => {
      expect(requestedIds(stub?.calls ?? [])).toHaveLength(1)
    })

    // 1 便目の応答を待っている間に新しいアバターが現れる。
    renderHook(() => useAssigneeIcon(30))
    await waitFor(() => {
      expect(requestedIds(stub?.calls ?? [])).toHaveLength(2)
    })

    expect(requestedIds(stub?.calls ?? [])).toEqual([['10', '20'], ['30']])
    pending.release?.()
  })

  it('取得できなかった ID は覚えて頼み直さない', async () => {
    stub = installScriptRun(() => ({ ok: true as const, data: {} }))

    const view = renderHook(() => useAssigneeIcon(10))
    await waitFor(() => {
      expect(requestedIds(stub?.calls ?? [])).toHaveLength(1)
    })
    view.unmount()

    renderHook(() => useAssigneeIcon(10))
    // 覚えていれば新しい便は出ない。出ないことを確かめるので少し待つ。
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80)
    })
    expect(requestedIds(stub?.calls ?? [])).toHaveLength(1)
  })
})
