import { afterEach, describe, expect, it, vi } from 'vitest'

import app from './index'
import type { AppBindings } from './server/auth/config'
import { createMemoryKV, seedSession } from './server/test-utils'

const originalFetch = globalThis.fetch

function createEnv(kv: KVNamespace): AppBindings {
  return {
    SESSIONS: kv,
    BACKLOG_CLIENT_ID: 'client-id',
    BACKLOG_CLIENT_SECRET: 'client-secret'
  } as AppBindings
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('HTML の配信', () => {
  it('ルートで HTML を返す', async () => {
    const kv = createMemoryKV()
    const response = await app.request('https://crossgantt.test/', {}, createEnv(kv))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')

    const html = await response.text()
    expect(html).toContain('<div id="root"')
    expect(html).toContain('CrossGantt for Backlog')
    expect(html).toContain('lang="ja"')
  })

  it('存在しないパスでも HTML を返す（クライアント側ルーティング用）', async () => {
    const kv = createMemoryKV()
    const response = await app.request('https://crossgantt.test/anything', {}, createEnv(kv))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<div id="root"')
  })
})

describe('API のマウント', () => {
  it('/api/auth はセッションなしでも到達できる', async () => {
    const kv = createMemoryKV()
    const response = await app.request('https://crossgantt.test/api/auth/session', {}, createEnv(kv))
    // HTML ではなく認証 API が応答している。
    expect(response.status).toBe(401)
    expect(response.headers.get('Content-Type')).toContain('application/json')
  })

  it('/api/auth/login は認可画面へリダイレクトする', async () => {
    const kv = createMemoryKV()
    const response = await app.request(
      'https://crossgantt.test/api/auth/login?space=example.backlog.jp',
      {},
      createEnv(kv)
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toContain('https://example.backlog.jp/OAuth2AccessRequest.action')
  })

  it('/api 配下はセッションが無ければ 401', async () => {
    const kv = createMemoryKV()
    const response = await app.request('https://crossgantt.test/api/projects', {}, createEnv(kv))
    expect(response.status).toBe(401)
  })

  it('セッションがあれば /api 配下が通る', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    globalThis.fetch = vi.fn(async () => Response.json([], { status: 200 })) as typeof fetch

    const response = await app.request(
      'https://crossgantt.test/api/projects',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(200)
  })
})
