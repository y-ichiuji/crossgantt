import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadFilterQuery, resetFilterStore, saveFilterQuery } from './filter-store'

const SPACE = 'example.backlog.jp'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveFilterQuery / loadFilterQuery', () => {
  it('保存した表示条件を読み出せる', async () => {
    await saveFilterQuery(SPACE, 'projects=100&from=2026-09-01&to=2026-12-31')
    expect(await loadFilterQuery(SPACE)).toBe('projects=100&from=2026-09-01&to=2026-12-31')
  })

  it('未保存なら null を返す', async () => {
    expect(await loadFilterQuery(SPACE)).toBeNull()
  })

  it('後から保存した内容で上書きする', async () => {
    await saveFilterQuery(SPACE, 'projects=100')
    await saveFilterQuery(SPACE, 'projects=200')
    expect(await loadFilterQuery(SPACE)).toBe('projects=200')
  })

  it('別スペースで保存した条件は読み出さない', async () => {
    // プロジェクト ID も担当者 ID もスペースごとの採番なので、
    // 別スペースへ入り直したときに流用すると存在しない ID を問い合わせてしまう。
    await saveFilterQuery('other.backlog.jp', 'projects=100')
    expect(await loadFilterQuery(SPACE)).toBeNull()
  })

  it('接続を作り直しても保存内容は残る', async () => {
    await saveFilterQuery(SPACE, 'projects=100')
    resetFilterStore()
    expect(await loadFilterQuery(SPACE)).toBe('projects=100')
  })
})

describe('IndexedDB が使えない場合', () => {
  it('読み出しは null を返す', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('access denied')
    })
    resetFilterStore()
    expect(await loadFilterQuery(SPACE)).toBeNull()
  })

  it('保存は例外を投げずに黙って諦める', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('access denied')
    })
    resetFilterStore()
    await expect(saveFilterQuery(SPACE, 'projects=100')).resolves.toBeUndefined()
  })

  it('indexedDB の参照そのものが例外でも Promise を拒否しない', async () => {
    // ストレージが遮断された文脈では、`window.indexedDB` への参照自体が
    // SecurityError を投げる。拒否のまま返すと、表示条件の復元が終わらず
    // 保存機能が黙って止まる。
    const original = Object.getOwnPropertyDescriptor(window, 'indexedDB')
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError')
      }
    })
    resetFilterStore()
    try {
      await expect(loadFilterQuery(SPACE)).resolves.toBeNull()
      await expect(saveFilterQuery(SPACE, 'projects=100')).resolves.toBeUndefined()
    } finally {
      if (original) {
        Object.defineProperty(window, 'indexedDB', original)
      }
      resetFilterStore()
    }
  })
})
