import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMemoryKV, jsonResponse, seedSession } from '../test-utils'
import type { AppBindings } from './config'
import { auth } from './routes'
import { getSession, putState, readCookie, takeState } from './session'

const originalFetch = globalThis.fetch

function createEnv(kv: KVNamespace, overrides: Partial<AppBindings> = {}): AppBindings {
  return {
    SESSIONS: kv,
    BACKLOG_CLIENT_ID: 'client-id',
    BACKLOG_CLIENT_SECRET: 'client-secret',
    ...overrides
  } as AppBindings
}

const BASE = 'https://crossgantt.example.workers.dev'

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('GET /login', () => {
  it('Backlog の認可画面へリダイレクトし、state を保存する', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(`${BASE}/login?space=example.backlog.jp`, {}, createEnv(kv))

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location') ?? '')
    expect(location.origin).toBe('https://example.backlog.jp')
    expect(location.pathname).toBe('/OAuth2AccessRequest.action')
    expect(location.searchParams.get('client_id')).toBe('client-id')
    expect(location.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/callback`)

    const state = location.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(await takeState(kv, state as string)).toEqual({ space: 'example.backlog.jp', returnTo: '/' })
  })

  it('state を HttpOnly Cookie にも入れる', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(`${BASE}/login?space=example.backlog.jp`, {}, createEnv(kv))
    const setCookie = response.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('cg_oauth_state=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
  })

  it('returnTo は相対パスだけを受け付ける', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(
      `${BASE}/login?space=example.backlog.jp&returnTo=${encodeURIComponent('//evil.example.com')}`,
      {},
      createEnv(kv)
    )
    const state = new URL(response.headers.get('Location') ?? '').searchParams.get('state') ?? ''
    const record = await takeState(kv, state)
    expect(record?.returnTo).toBe('/')
  })

  it('Backlog 以外のドメインは 400 で拒否する', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(`${BASE}/login?space=evil.example.com`, {}, createEnv(kv))
    expect(response.status).toBe(400)
  })

  it('OAuth 未設定なら 500 を返す', async () => {
    const kv = createMemoryKV()
    const env = { SESSIONS: kv } as AppBindings
    const response = await auth.request(`${BASE}/login?space=example.backlog.jp`, {}, env)
    expect(response.status).toBe(500)
  })
})

describe('GET /callback', () => {
  async function prepareState(kv: KVNamespace, returnTo = '/') {
    const state = 'state-token'
    await putState(kv, state, { space: 'example.backlog.jp', returnTo })
    return state
  }

  it('コードをトークンに交換してセッションを作る', async () => {
    const kv = createMemoryKV()
    const state = await prepareState(kv, '/?projects=1')

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/v2/oauth2/token')) {
        return jsonResponse({
          access_token: 'access',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'refresh'
        })
      }
      return jsonResponse({ id: 7, userId: 'yamada', name: '山田太郎' })
    }) as typeof fetch

    const response = await auth.request(
      `${BASE}/callback?code=the-code&state=${state}`,
      { headers: { Cookie: `cg_oauth_state=${state}` } },
      createEnv(kv)
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?projects=1')

    const cookies = response.headers.getSetCookie()
    const sessionCookie = cookies.find((value) => value.startsWith('cg_session='))
    expect(sessionCookie).toContain('HttpOnly')

    const sessionId = readCookie(sessionCookie, 'cg_session') as string
    const session = await getSession(kv, sessionId)
    expect(session).toMatchObject({
      space: 'example.backlog.jp',
      accessToken: 'access',
      refreshToken: 'refresh',
      userId: 7,
      userName: '山田太郎'
    })
  })

  it('Cookie の state と一致しなければ拒否する', async () => {
    const kv = createMemoryKV()
    const state = await prepareState(kv)

    const response = await auth.request(
      `${BASE}/callback?code=the-code&state=${state}`,
      { headers: { Cookie: 'cg_oauth_state=different' } },
      createEnv(kv)
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/?auth_error=state_mismatch')
  })

  it('保存されていない state は期限切れとして扱う', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(
      `${BASE}/callback?code=the-code&state=unknown`,
      { headers: { Cookie: 'cg_oauth_state=unknown' } },
      createEnv(kv)
    )
    expect(response.headers.get('Location')).toBe('/?auth_error=state_expired')
  })

  it('code が無ければエラーとして戻す', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(`${BASE}/callback?state=abc`, {}, createEnv(kv))
    expect(response.headers.get('Location')).toBe('/?auth_error=missing_code')
  })

  it('Backlog がエラーを返した場合はその内容を戻す', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(`${BASE}/callback?error=access_denied`, {}, createEnv(kv))
    expect(response.headers.get('Location')).toBe('/?auth_error=access_denied')
  })

  it('トークン交換に失敗したらエラーとして戻す', async () => {
    const kv = createMemoryKV()
    const state = await prepareState(kv)
    globalThis.fetch = vi.fn(async () => new Response('invalid_grant', { status: 400 })) as typeof fetch

    const response = await auth.request(
      `${BASE}/callback?code=bad&state=${state}`,
      { headers: { Cookie: `cg_oauth_state=${state}` } },
      createEnv(kv)
    )
    expect(response.headers.get('Location')).toBe('/?auth_error=token_exchange_failed')
  })
})

describe('GET /session', () => {
  it('ログイン済みなら接続ユーザーを返す', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    const response = await auth.request(`${BASE}/session`, { headers: { Cookie: cookie } }, createEnv(kv))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 42,
      userId: null,
      name: '山田太郎',
      space: 'example.backlog.jp'
    })
  })

  it('Cookie が無ければ 401', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(`${BASE}/session`, {}, createEnv(kv))
    expect(response.status).toBe(401)
  })

  it('セッションが失効していれば 401', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(`${BASE}/session`, { headers: { Cookie: 'cg_session=gone' } }, createEnv(kv))
    expect(response.status).toBe(401)
  })
})

describe('POST /logout', () => {
  it('セッションを破棄して Cookie を消す', async () => {
    const kv = createMemoryKV()
    const { sessionId, cookie } = await seedSession(kv)

    const response = await auth.request(
      `${BASE}/logout`,
      { method: 'POST', headers: { Cookie: cookie } },
      createEnv(kv)
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect(await getSession(kv, sessionId)).toBeNull()
  })

  it('未ログインでも 204 を返す', async () => {
    const kv = createMemoryKV()
    const response = await auth.request(`${BASE}/logout`, { method: 'POST' }, createEnv(kv))
    expect(response.status).toBe(204)
  })
})
