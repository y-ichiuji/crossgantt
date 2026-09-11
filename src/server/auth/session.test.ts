import { describe, expect, it } from 'vitest'

import { createMemoryUserStore, TEST_NOW } from '../test-utils'
import {
  clearSession,
  consumeNonce,
  issueNonce,
  MAX_PENDING_NONCES,
  NONCE_TTL_SECONDS,
  readSession,
  SESSION_TTL_SECONDS,
  writeSession
} from './session'
import type { NewSession } from './session'

const SESSION: NewSession = {
  space: 'example.backlog.jp',
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: TEST_NOW + 60 * 60 * 1000,
  userId: 42,
  userName: '山田太郎'
}

describe('セッションの保存と取得', () => {
  it('保存した内容をそのまま取り出せる', () => {
    const store = createMemoryUserStore()
    writeSession(store, SESSION, TEST_NOW)

    expect(readSession(store, TEST_NOW)).toEqual({
      ...SESSION,
      sessionExpiresAt: TEST_NOW + SESSION_TTL_SECONDS * 1000
    })
  })

  it('何も保存されていなければ null を返す', () => {
    expect(readSession(createMemoryUserStore(), TEST_NOW)).toBeNull()
  })

  it('壊れた値が入っていても null を返す', () => {
    const store = createMemoryUserStore({ session: 'not json' })
    expect(readSession(store, TEST_NOW)).toBeNull()
  })

  it('項目の足りない値は受け付けない', () => {
    const store = createMemoryUserStore({ session: JSON.stringify({ space: 'example.backlog.jp' }) })
    expect(readSession(store, TEST_NOW)).toBeNull()
  })

  it('削除できる', () => {
    const store = createMemoryUserStore()
    writeSession(store, SESSION, TEST_NOW)
    clearSession(store)

    expect(readSession(store, TEST_NOW)).toBeNull()
  })

  it('有効期限を過ぎたら読めなくなり、保存先からも消える', () => {
    const store = createMemoryUserStore()
    writeSession(store, SESSION, TEST_NOW)

    const later = TEST_NOW + (SESSION_TTL_SECONDS + 1) * 1000
    expect(readSession(store, later)).toBeNull()
    expect(store.snapshot().session).toBeUndefined()
  })

  it('保存し直すたびに期限が伸びる', () => {
    const store = createMemoryUserStore()
    writeSession(store, SESSION, TEST_NOW)

    const later = TEST_NOW + 10 * 24 * 60 * 60 * 1000
    writeSession(store, SESSION, later)

    expect(readSession(store, later)?.sessionExpiresAt).toBe(later + SESSION_TTL_SECONDS * 1000)
  })
})

describe('nonce の払い出しと消費', () => {
  it('払い出した nonce は一度だけ使える', () => {
    const store = createMemoryUserStore()
    issueNonce(store, 'abc', TEST_NOW)

    expect(consumeNonce(store, 'abc', TEST_NOW)).toBe(true)
    expect(consumeNonce(store, 'abc', TEST_NOW)).toBe(false)
  })

  it('払い出していない nonce は受け付けない', () => {
    const store = createMemoryUserStore()
    expect(consumeNonce(store, 'unknown', TEST_NOW)).toBe(false)
  })

  it('期限を過ぎた nonce は受け付けない', () => {
    const store = createMemoryUserStore()
    issueNonce(store, 'abc', TEST_NOW)

    expect(consumeNonce(store, 'abc', TEST_NOW + (NONCE_TTL_SECONDS + 1) * 1000)).toBe(false)
  })

  it('複数のタブで開いても、それぞれの nonce が使える', () => {
    const store = createMemoryUserStore()
    issueNonce(store, 'first', TEST_NOW)
    issueNonce(store, 'second', TEST_NOW)

    // 先に開いたタブからのログインも成立する。
    expect(consumeNonce(store, 'first', TEST_NOW)).toBe(true)
    expect(consumeNonce(store, 'second', TEST_NOW)).toBe(true)
  })

  it('覚えておく数には上限があり、古いものから捨てる', () => {
    const store = createMemoryUserStore()
    for (let index = 0; index < MAX_PENDING_NONCES + 1; index += 1) {
      issueNonce(store, `nonce-${index}`, TEST_NOW)
    }

    expect(consumeNonce(store, 'nonce-0', TEST_NOW)).toBe(false)
    expect(consumeNonce(store, `nonce-${MAX_PENDING_NONCES}`, TEST_NOW)).toBe(true)
  })

  it('すべて消費したら保存先からも消える', () => {
    const store = createMemoryUserStore()
    issueNonce(store, 'only', TEST_NOW)
    consumeNonce(store, 'only', TEST_NOW)

    expect(store.snapshot().oauthNonces).toBeUndefined()
  })
})
