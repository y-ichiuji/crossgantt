import { describe, expect, it, vi } from 'vitest'

import { jsonResponse } from '../test-utils'
import {
  buildAuthorizeUrl,
  exchangeCode,
  needsRefresh,
  OAuthError,
  type OAuthConfig,
  refreshTokens,
  TOKEN_REFRESH_MARGIN_MS
} from './oauth'

const SPACE = 'example.backlog.jp'
const NOW = Date.parse('2026-09-10T00:00:00Z')

const CONFIG: OAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://crossgantt.example.workers.dev/api/auth/callback'
}

describe('buildAuthorizeUrl', () => {
  it('スペースの認可エンドポイントへ必要なパラメータを付ける', () => {
    const url = new URL(buildAuthorizeUrl(SPACE, CONFIG, 'state-value'))
    expect(url.origin).toBe(`https://${SPACE}`)
    expect(url.pathname).toBe('/OAuth2AccessRequest.action')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri)
    expect(url.searchParams.get('state')).toBe('state-value')
  })

  it('クライアントシークレットを認可 URL に載せない', () => {
    expect(buildAuthorizeUrl(SPACE, CONFIG, 'state-value')).not.toContain(CONFIG.clientSecret)
  })
})

describe('exchangeCode', () => {
  it('認可コードをトークンに交換する', async () => {
    const captured: { url: string; body: string }[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), body: String(init?.body) })
      return jsonResponse({
        access_token: 'access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh'
      })
    }) as unknown as typeof fetch

    const tokens = await exchangeCode(SPACE, CONFIG, 'the-code', NOW, fetchImpl)

    expect(tokens).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: NOW + 3600 * 1000
    })
    expect(captured[0].url).toBe(`https://${SPACE}/api/v2/oauth2/token`)

    const body = new URLSearchParams(captured[0].body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('redirect_uri')).toBe(CONFIG.redirectUri)
    expect(body.get('client_id')).toBe('client-id')
    expect(body.get('client_secret')).toBe('client-secret')
  })

  it('400 が返ったら 401 相当のエラーにする', async () => {
    const fetchImpl = vi.fn(async () => new Response('invalid_grant', { status: 400 })) as unknown as typeof fetch
    await expect(exchangeCode(SPACE, CONFIG, 'bad', NOW, fetchImpl)).rejects.toMatchObject({
      name: 'OAuthError',
      status: 401
    })
  })

  it('500 が返ったら 502 相当のエラーにする', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    await expect(exchangeCode(SPACE, CONFIG, 'code', NOW, fetchImpl)).rejects.toMatchObject({ status: 502 })
  })

  it('レスポンスの形が想定と違えばエラーにする', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ unexpected: true })) as unknown as typeof fetch
    await expect(exchangeCode(SPACE, CONFIG, 'code', NOW, fetchImpl)).rejects.toThrow(OAuthError)
  })

  it('通信そのものに失敗したら 502 にする', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    await expect(exchangeCode(SPACE, CONFIG, 'code', NOW, fetchImpl)).rejects.toMatchObject({ status: 502 })
  })
})

describe('refreshTokens', () => {
  it('リフレッシュトークンで更新する', async () => {
    const captured: string[] = []
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(String(init?.body))
      return jsonResponse({
        access_token: 'new-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new-refresh'
      })
    }) as unknown as typeof fetch

    const tokens = await refreshTokens(SPACE, CONFIG, 'old-refresh', NOW, fetchImpl)

    expect(tokens.accessToken).toBe('new-access')
    expect(tokens.refreshToken).toBe('new-refresh')

    const body = new URLSearchParams(captured[0])
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('old-refresh')
  })

  it('リフレッシュトークンが返らない場合は元の値を引き継ぐ', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: 'new-access', token_type: 'Bearer', expires_in: 3600, refresh_token: '' })
    ) as unknown as typeof fetch

    const tokens = await refreshTokens(SPACE, CONFIG, 'old-refresh', NOW, fetchImpl)
    expect(tokens.refreshToken).toBe('old-refresh')
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
