import { describe, expect, it } from 'vitest'

import { createFetcherStub, jsonResponse, textResponse } from '../test-utils'
import { exchangeCode, needsRefresh, OAuthError, refreshTokens, TOKEN_REFRESH_MARGIN_MS } from './oauth'
import type { OAuthConfig } from './oauth'

const SPACE = 'example.backlog.jp'
const NOW = Date.parse('2026-09-10T00:00:00Z')

const CONFIG: OAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://script.google.com/macros/s/deployment-id/exec'
}

const TOKEN_BODY = {
  access_token: 'access',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh'
}

describe('exchangeCode', () => {
  it('認可コードをトークンに交換する', () => {
    const stub = createFetcherStub(() => jsonResponse(TOKEN_BODY))

    const tokens = exchangeCode(SPACE, CONFIG, 'the-code', NOW, stub.fetcher)

    expect(tokens).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: NOW + 3600 * 1000
    })
    expect(stub.requests[0].url).toBe(`https://${SPACE}/api/v2/oauth2/token`)
    expect(stub.requests[0].method).toBe('post')
    expect(stub.requests[0].contentType).toBe('application/x-www-form-urlencoded')

    const body = new URLSearchParams(stub.requests[0].payload)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('redirect_uri')).toBe(CONFIG.redirectUri)
    expect(body.get('client_id')).toBe('client-id')
    expect(body.get('client_secret')).toBe('client-secret')
  })

  it('クライアントシークレットを URL に載せない', () => {
    const stub = createFetcherStub(() => jsonResponse(TOKEN_BODY))

    exchangeCode(SPACE, CONFIG, 'the-code', NOW, stub.fetcher)

    expect(stub.requests[0].url).not.toContain(CONFIG.clientSecret)
  })

  it('400 が返ったら 401 相当のエラーにする', () => {
    const stub = createFetcherStub(() => textResponse(400, 'invalid_grant'))

    expect(() => exchangeCode(SPACE, CONFIG, 'bad', NOW, stub.fetcher)).toThrow(
      expect.objectContaining({ name: 'OAuthError', status: 401 })
    )
  })

  it('500 が返ったら 502 相当のエラーにする', () => {
    const stub = createFetcherStub(() => textResponse(500, 'boom'))

    expect(() => exchangeCode(SPACE, CONFIG, 'code', NOW, stub.fetcher)).toThrow(
      expect.objectContaining({ status: 502 })
    )
  })

  it('レスポンスの形が想定と違えばエラーにする', () => {
    const stub = createFetcherStub(() => jsonResponse({ unexpected: true }))

    expect(() => exchangeCode(SPACE, CONFIG, 'code', NOW, stub.fetcher)).toThrow(OAuthError)
  })

  it('JSON として読めない応答もエラーにする', () => {
    const stub = createFetcherStub(() => textResponse(200, 'not json'))

    expect(() => exchangeCode(SPACE, CONFIG, 'code', NOW, stub.fetcher)).toThrow(OAuthError)
  })

  it('通信そのものに失敗したら 502 にする', () => {
    const stub = createFetcherStub(() => {
      throw new TypeError('network down')
    })

    expect(() => exchangeCode(SPACE, CONFIG, 'code', NOW, stub.fetcher)).toThrow(
      expect.objectContaining({ status: 502 })
    )
  })
})

describe('refreshTokens', () => {
  it('リフレッシュトークンで更新する', () => {
    const stub = createFetcherStub(() =>
      jsonResponse({ ...TOKEN_BODY, access_token: 'new-access', refresh_token: 'new-refresh' })
    )

    const tokens = refreshTokens(SPACE, CONFIG, 'old-refresh', NOW, stub.fetcher)

    expect(tokens.accessToken).toBe('new-access')
    expect(tokens.refreshToken).toBe('new-refresh')

    const body = new URLSearchParams(stub.requests[0].payload)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('old-refresh')
  })

  it('リフレッシュトークンが返らない場合は元の値を引き継ぐ', () => {
    const stub = createFetcherStub(() => jsonResponse({ ...TOKEN_BODY, refresh_token: '' }))

    expect(refreshTokens(SPACE, CONFIG, 'old-refresh', NOW, stub.fetcher).refreshToken).toBe('old-refresh')
  })
})

describe('needsRefresh', () => {
  it('マージンより先に切れるなら更新が必要', () => {
    expect(needsRefresh(NOW + TOKEN_REFRESH_MARGIN_MS - 1, NOW)).toBe(true)
    expect(needsRefresh(NOW - 1, NOW)).toBe(true)
  })

  it('十分先ならまだ不要', () => {
    expect(needsRefresh(NOW + TOKEN_REFRESH_MARGIN_MS + 1, NOW)).toBe(false)
  })
})
