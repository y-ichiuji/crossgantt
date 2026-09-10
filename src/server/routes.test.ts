import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppBindings } from './auth/config'
import { getSession } from './auth/session'
import { resetHolidayMemo } from './holidays'
import { api } from './routes'
import { createMemoryKV, jsonResponse, seedSession } from './test-utils'

const originalFetch = globalThis.fetch

function createEnv(kv: KVNamespace): AppBindings {
  return {
    SESSIONS: kv,
    BACKLOG_CLIENT_ID: 'test-client-id',
    BACKLOG_CLIENT_SECRET: 'test-client-secret'
  } as AppBindings
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('セッションによる保護', () => {
  it('Cookie が無ければ 401', async () => {
    const kv = createMemoryKV()
    const response = await api.request('/projects', {}, createEnv(kv))
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('ログインしていません')
  })

  it('未知のセッション ID なら 401', async () => {
    const kv = createMemoryKV()
    const response = await api.request('/projects', { headers: { Cookie: 'cg_session=unknown' } }, createEnv(kv))
    expect(response.status).toBe(401)
  })

  it('認証情報を含むレスポンスはキャッシュさせない', async () => {
    const kv = createMemoryKV()
    const response = await api.request('/projects', {}, createEnv(kv))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('/holidays', () => {
  let kv: KVNamespace
  let cookie: string

  beforeEach(async () => {
    kv = createMemoryKV()
    const seeded = await seedSession(kv)
    cookie = seeded.cookie
    resetHolidayMemo()
  })

  afterEach(() => resetHolidayMemo())

  it('表示期間内の祝日を返す', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ '2026-09-21': '敬老の日', '2026-09-23': '秋分の日' })
    ) as unknown as typeof fetch

    const response = await api.request(
      '/holidays?from=2026-09-01&to=2026-09-30',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      { dateKey: '2026-09-21', name: '敬老の日' },
      { dateKey: '2026-09-23', name: '秋分の日' }
    ])
  })

  it('日付が不正なら 400', async () => {
    const response = await api.request(
      '/holidays?from=zzz&to=2026-09-30',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(400)
  })

  it('開始日が終了日より後なら 400', async () => {
    const response = await api.request(
      '/holidays?from=2026-09-30&to=2026-09-01',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(400)
  })

  it('期間が長すぎれば 400', async () => {
    const response = await api.request(
      '/holidays?from=2000-01-01&to=2099-12-31',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(400)
  })

  it('未ログインなら 401', async () => {
    const response = await api.request('/holidays?from=2026-09-01&to=2026-09-30', {}, createEnv(createMemoryKV()))
    expect(response.status).toBe(401)
  })
})

describe('/issues のパラメータ検証', () => {
  let kv: KVNamespace
  let cookie: string

  beforeEach(async () => {
    kv = createMemoryKV()
    const seeded = await seedSession(kv)
    cookie = seeded.cookie
  })

  it('プロジェクト未指定なら 400', async () => {
    const response = await api.request(
      '/issues?from=2026-09-01&to=2026-09-30',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('プロジェクト')
  })

  it('日付形式が不正なら 400', async () => {
    const response = await api.request(
      '/issues?projectIds=1&from=2026-13-01&to=2026-09-30',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(400)
  })

  it('期間が逆転していたら 400', async () => {
    const response = await api.request(
      '/issues?projectIds=1&from=2026-10-01&to=2026-09-01',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('開始日')
  })

  it('期間が長すぎたら 400', async () => {
    const response = await api.request(
      '/issues?projectIds=1&from=2000-01-01&to=2999-12-31',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('長すぎます')
  })

  it('参加していないプロジェクトだけを指定したら 403 で、Backlog の課題検索は呼ばない', async () => {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push(url)
      return jsonResponse([{ id: 1, projectKey: 'PJA', name: 'プロジェクトA', archived: false }])
    }) as typeof fetch

    const response = await api.request(
      '/issues?projectIds=999&from=2026-09-01&to=2026-09-30',
      { headers: { Cookie: cookie } },
      createEnv(kv)
    )

    expect(response.status).toBe(403)
    // 参加プロジェクトの確認だけで、課題検索へは進まない。
    expect(calls.filter((url) => url.includes('/issues'))).toHaveLength(0)
  })
})

describe('参加していないプロジェクト ID の扱い', () => {
  it('/members は参加しているプロジェクトだけを問い合わせる', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    const calls: string[] = []

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push(url)
      if (url.includes('/api/v2/projects/')) {
        return jsonResponse([{ id: 7, userId: 'taro', name: '山田太郎' }])
      }
      return jsonResponse([{ id: 1, projectKey: 'PJA', name: 'プロジェクトA', archived: false }])
    }) as typeof fetch

    // 1 は参加中、999 は他人のプロジェクト（共有 URL 経由で紛れ込むケース）。
    const response = await api.request('/members?projectIds=1,999', { headers: { Cookie: cookie } }, createEnv(kv))

    // 999 をそのまま投げると 404 で全体が失敗していた。絞り込んで成功させる。
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: 7, name: '山田太郎' }])
    expect(calls.some((url) => url.includes('/projects/999/'))).toBe(false)
    expect(calls.some((url) => url.includes('/projects/1/users'))).toBe(true)
  })
})

describe('Backlog への中継', () => {
  it('セッションのアクセストークンで Backlog を呼ぶ', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    const calls: { url: string; authorization: string | null }[] = []

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers)
      calls.push({ url, authorization: headers.get('Authorization') })
      return jsonResponse([{ id: 1, projectKey: 'PJA', name: 'プロジェクトA', archived: false }])
    }) as typeof fetch

    const response = await api.request('/projects', { headers: { Cookie: cookie } }, createEnv(kv))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: 1, projectKey: 'PJA', name: 'プロジェクトA' }])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('https://example.backlog.jp/api/v2/projects')
    expect(calls[0].authorization).toBe('Bearer test-access-token')
  })

  it('Backlog が 401 を返したらそのまま 401 として返す', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    globalThis.fetch = vi.fn(async () => new Response('unauthorized', { status: 401 })) as typeof fetch

    const response = await api.request('/projects', { headers: { Cookie: cookie } }, createEnv(kv))
    expect(response.status).toBe(401)
  })
})

describe('アクセストークンの自動更新', () => {
  it('期限が近いトークンは更新してから Backlog を呼ぶ', async () => {
    const kv = createMemoryKV()
    // 30 秒後に切れる = 更新マージン（60 秒）の内側。
    const { sessionId, cookie } = await seedSession(kv, { expiresAt: Date.now() + 30_000 })

    const urls: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      urls.push(url)
      if (url.includes('/api/v2/oauth2/token')) {
        return jsonResponse({
          access_token: 'refreshed-token',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'refreshed-refresh-token'
        })
      }
      return jsonResponse([])
    }) as typeof fetch

    const response = await api.request('/projects', { headers: { Cookie: cookie } }, createEnv(kv))

    expect(response.status).toBe(200)
    expect(urls[0]).toContain('/api/v2/oauth2/token')

    const stored = await getSession(kv, sessionId)
    expect(stored?.accessToken).toBe('refreshed-token')
    expect(stored?.refreshToken).toBe('refreshed-refresh-token')
    expect(stored?.expiresAt).toBeGreaterThan(Date.now() + 3_000_000)
  })

  it('更新に失敗したら 401 を返す', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv, { expiresAt: Date.now() + 1000 })
    globalThis.fetch = vi.fn(async () => new Response('invalid_grant', { status: 400 })) as typeof fetch

    const response = await api.request('/projects', { headers: { Cookie: cookie } }, createEnv(kv))
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('ログインし直して')
  })
})

describe('担当者アイコンの中継', () => {
  it('Backlog のアイコンをそのまま返す', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    const urls: string[] = []

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      urls.push(url)
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      })
    }) as typeof fetch

    const response = await api.request('/users/7/icon', { headers: { Cookie: cookie } }, createEnv(kv))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(urls[0]).toBe('https://example.backlog.jp/api/v2/users/7/icon')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('ブラウザにだけキャッシュさせる', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    globalThis.fetch = vi.fn(
      async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'image/png' } })
    ) as typeof fetch

    const response = await api.request('/users/7/icon', { headers: { Cookie: cookie } }, createEnv(kv))
    // 共有キャッシュに載せないよう private を付ける。
    expect(response.headers.get('Cache-Control')).toContain('private')
    expect(response.headers.get('Cache-Control')).toContain('max-age=3600')
  })

  it('ユーザー ID が不正なら 400', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    const response = await api.request('/users/abc/icon', { headers: { Cookie: cookie } }, createEnv(kv))
    expect(response.status).toBe(400)
  })

  it('未ログインなら 401', async () => {
    const kv = createMemoryKV()
    const response = await api.request('/users/7/icon', {}, createEnv(kv))
    expect(response.status).toBe(401)
  })

  it('Content-Type が無ければ image/png とみなす', async () => {
    const kv = createMemoryKV()
    const { cookie } = await seedSession(kv)
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as typeof fetch

    const response = await api.request('/users/7/icon', { headers: { Cookie: cookie } }, createEnv(kv))
    expect(response.headers.get('Content-Type')).toBe('image/png')
  })
})
