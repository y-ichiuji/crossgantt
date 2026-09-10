import { describe, expect, it } from 'vitest'

import { type AppBindings, CALLBACK_PATH, defaultRedirectUri, isSecureRequest, resolveOAuthConfig } from './config'

function createEnv(overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    BACKLOG_CLIENT_ID: 'client-id',
    BACKLOG_CLIENT_SECRET: 'client-secret',
    ...overrides
  } as AppBindings
}

describe('isSecureRequest', () => {
  it('https なら true', () => {
    expect(isSecureRequest('https://example.workers.dev/api/auth/login')).toBe(true)
  })

  it('http なら false（ローカル開発）', () => {
    expect(isSecureRequest('http://localhost:5173/api/auth/login')).toBe(false)
  })
})

describe('defaultRedirectUri', () => {
  it('リクエストのオリジンからコールバック URL を作る', () => {
    expect(defaultRedirectUri('https://crossgantt.example.workers.dev/api/auth/login?space=x')).toBe(
      `https://crossgantt.example.workers.dev${CALLBACK_PATH}`
    )
  })

  it('ポート付きのローカル開発でも正しく組み立てる', () => {
    expect(defaultRedirectUri('http://localhost:5173/api/auth/login')).toBe(`http://localhost:5173${CALLBACK_PATH}`)
  })
})

describe('resolveOAuthConfig', () => {
  it('クライアント ID とシークレットが揃っていれば設定を返す', () => {
    const config = resolveOAuthConfig(createEnv(), 'https://example.workers.dev/api/auth/login')
    expect(config).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: `https://example.workers.dev${CALLBACK_PATH}`
    })
  })

  it('クライアント ID が無ければ null', () => {
    expect(resolveOAuthConfig(createEnv({ BACKLOG_CLIENT_ID: undefined }), 'https://x/api')).toBeNull()
  })

  it('シークレットが無ければ null', () => {
    expect(resolveOAuthConfig(createEnv({ BACKLOG_CLIENT_SECRET: undefined }), 'https://x/api')).toBeNull()
  })

  it('空文字は未設定として扱う', () => {
    expect(resolveOAuthConfig(createEnv({ BACKLOG_CLIENT_ID: '' }), 'https://x/api')).toBeNull()
  })

  it('OAUTH_REDIRECT_URI が設定されていればそちらを優先する', () => {
    const config = resolveOAuthConfig(
      createEnv({ OAUTH_REDIRECT_URI: 'https://fixed.example.com/api/auth/callback' }),
      'https://example.workers.dev/api/auth/login'
    )
    expect(config?.redirectUri).toBe('https://fixed.example.com/api/auth/callback')
  })
})
