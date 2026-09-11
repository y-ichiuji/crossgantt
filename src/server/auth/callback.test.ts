import { describe, expect, it } from 'vitest'

import { encodeState } from '../../shared/oauth'
import {
  createFetcherStub,
  createMemoryUserStore,
  createTestApiContext,
  jsonResponse,
  TEST_NOW,
  textResponse
} from '../test-utils'
import type { TestApiContext } from '../test-utils'
import { handleAuthCallback, isAuthCallback } from './callback'
import { issueNonce, readSession, writeSession } from './session'
import type { NewSession } from './session'

const SPACE = 'example.backlog.jp'
const NONCE = 'a1b2c3d4e5f60718'
const QUERY = 'projects=1,2&from=2026-09-01'

const SESSION: NewSession = {
  space: SPACE,
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: TEST_NOW + 60 * 60 * 1000,
  userId: 42,
  userName: '山田太郎'
}

/** トークン交換と接続ユーザーの取得に成功する応答。 */
function successResponse(url: string) {
  if (url.endsWith('/oauth2/token')) {
    return jsonResponse({
      access_token: 'new-access',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'new-refresh'
    })
  }
  return jsonResponse({ id: 42, userId: 'yamada', name: '山田太郎' })
}

/** nonce を払い出し済みの実行文脈を用意する。 */
function withNonce(respond: Parameters<typeof createFetcherStub>[0]): {
  context: TestApiContext
  stub: ReturnType<typeof createFetcherStub>
} {
  const stub = createFetcherStub(respond)
  const store = createMemoryUserStore()
  issueNonce(store, NONCE, TEST_NOW)
  return { context: createTestApiContext({ fetcher: stub.fetcher, store }), stub }
}

const STATE = encodeState({ nonce: NONCE, space: SPACE, query: QUERY })

describe('isAuthCallback', () => {
  it('code か error があればコールバックとみなす', () => {
    expect(isAuthCallback({ code: 'x' })).toBe(true)
    expect(isAuthCallback({ error: 'access_denied' })).toBe(true)
  })

  it('通常の表示条件だけならコールバックではない', () => {
    expect(isAuthCallback({ projects: '1,2' })).toBe(false)
    expect(isAuthCallback({})).toBe(false)
  })
})

describe('handleAuthCallback', () => {
  it('認可コードをトークンに交換してセッションを作る', () => {
    const { context, stub } = withNonce((request) => successResponse(request.url))

    expect(handleAuthCallback(context, { code: 'the-code', state: STATE })).toEqual({
      query: QUERY,
      errorCode: null
    })

    const session = readSession(context.store, TEST_NOW)
    expect(session).toMatchObject({
      space: SPACE,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      userId: 42,
      userName: '山田太郎'
    })
    // トークンエンドポイントは state のスペースに対して叩く。
    expect(stub.requests[0].url).toBe(`https://${SPACE}/api/v2/oauth2/token`)
  })

  it('認可を拒否された場合は理由をそのまま返す', () => {
    const { context } = withNonce(() => jsonResponse({}))

    expect(handleAuthCallback(context, { error: 'access_denied' })).toEqual({
      query: '',
      errorCode: 'access_denied'
    })
  })

  it('code が無ければ missing_code', () => {
    const { context } = withNonce(() => jsonResponse({}))

    expect(handleAuthCallback(context, { state: STATE }).errorCode).toBe('missing_code')
  })

  it('state の形が合わなければ state_mismatch', () => {
    const { context } = withNonce(() => jsonResponse({}))

    expect(handleAuthCallback(context, { code: 'c', state: 'broken' }).errorCode).toBe('state_mismatch')
    expect(handleAuthCallback(context, { code: 'c' }).errorCode).toBe('state_mismatch')
  })

  it('許可されないスペースの state は受け付けない', () => {
    const { context, stub } = withNonce(() => jsonResponse({}))

    // 中継先を任意のホストに差し替えられないことを確かめる。
    expect(handleAuthCallback(context, { code: 'c', state: `${NONCE}|evil.example.com|` }).errorCode).toBe(
      'state_mismatch'
    )
    expect(stub.requests).toHaveLength(0)
  })

  it('払い出していない nonce は受け付けない', () => {
    const { context } = withNonce(() => jsonResponse({}))
    const otherState = encodeState({ nonce: 'ffffffffffffffff', space: SPACE, query: QUERY })

    expect(handleAuthCallback(context, { code: 'c', state: otherState })).toEqual({
      query: QUERY,
      errorCode: 'state_expired'
    })
  })

  it('nonce は一度しか使えない', () => {
    const { context } = withNonce((request) => successResponse(request.url))

    expect(handleAuthCallback(context, { code: 'c', state: STATE }).errorCode).toBeNull()
    // 2 回目はセッションができているため、失敗扱いにはせず画面を返す。
    expect(handleAuthCallback(context, { code: 'c', state: STATE })).toEqual({ query: QUERY, errorCode: null })
  })

  it('認可直後の再読込では、ログイン済みなら失敗扱いにしない', () => {
    const stub = createFetcherStub(() => jsonResponse({}))
    const store = createMemoryUserStore()
    writeSession(store, SESSION, TEST_NOW)
    const context = createTestApiContext({ fetcher: stub.fetcher, store })

    expect(handleAuthCallback(context, { code: 'stale', state: STATE })).toEqual({
      query: QUERY,
      errorCode: null
    })
    expect(stub.requests).toHaveLength(0)
  })

  it('OAuth の設定が無ければ not_configured', () => {
    const stub = createFetcherStub(() => jsonResponse({}))
    const store = createMemoryUserStore()
    issueNonce(store, NONCE, TEST_NOW)
    const context = createTestApiContext({ fetcher: stub.fetcher, store, oauth: null })

    expect(handleAuthCallback(context, { code: 'c', state: STATE }).errorCode).toBe('not_configured')
  })

  it('トークン交換に失敗したら token_exchange_failed', () => {
    const { context } = withNonce(() => textResponse(400, 'invalid_grant'))

    expect(handleAuthCallback(context, { code: 'c', state: STATE })).toEqual({
      query: QUERY,
      errorCode: 'token_exchange_failed'
    })
    expect(readSession(context.store, TEST_NOW)).toBeNull()
  })

  it('接続ユーザーの取得に失敗しても token_exchange_failed', () => {
    const { context } = withNonce((request) =>
      request.url.endsWith('/oauth2/token') ? successResponse(request.url) : textResponse(401, 'unauthorized')
    )

    expect(handleAuthCallback(context, { code: 'c', state: STATE }).errorCode).toBe('token_exchange_failed')
    expect(readSession(context.store, TEST_NOW)).toBeNull()
  })
})
