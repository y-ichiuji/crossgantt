import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadLastSpace, saveLastSpace } from './storage'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadLastSpace / saveLastSpace', () => {
  it('保存した値を読み出せる', () => {
    saveLastSpace('example.backlog.jp')
    expect(loadLastSpace()).toBe('example.backlog.jp')
  })

  it('未保存なら空文字を返す', () => {
    expect(loadLastSpace()).toBe('')
  })

  it('読み出しが例外を投げても空文字にフォールバックする', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })
    expect(loadLastSpace()).toBe('')
  })

  it('書き込みが例外を投げても呼び出し側へ伝播させない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveLastSpace('example.backlog.jp')).not.toThrow()
  })

  it('秘密情報を保存する API を持たない', () => {
    // 認証情報は HttpOnly Cookie とサーバー側セッションで扱うため、
    // このモジュールが公開するのはスペースの読み書きだけであるべき。
    saveLastSpace('example.backlog.jp')
    const stored = Object.entries(localStorage).map(([key, value]) => `${key}=${String(value)}`)
    expect(stored).toEqual(['crossgantt.lastSpace=example.backlog.jp'])
  })
})
