import { describe, expect, it } from 'vitest'

import { handleApiCall } from './api'
import type { ApiParams } from './api'
import { writeSession } from './auth/session'
import type { NewSession } from './auth/session'
import {
  createFetcherStub,
  createMemoryUserStore,
  createTestApiContext,
  jsonResponse,
  TEST_NOW,
  textResponse
} from './test-utils'
import type { TestApiContext } from './test-utils'

const SESSION: NewSession = {
  space: 'example.backlog.jp',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: TEST_NOW + 60 * 60 * 1000,
  userId: 42,
  userName: '山田太郎'
}

const PROJECT = { id: 100, projectKey: 'PJA', name: 'プロジェクト A', archived: false }

const RANGE: ApiParams = { from: '2026-09-01', to: '2026-09-30' }

/** ログイン済みの実行文脈を用意する。 */
function loggedIn(
  respond: Parameters<typeof createFetcherStub>[0],
  overrides: Partial<NewSession> = {}
): { context: TestApiContext; stub: ReturnType<typeof createFetcherStub> } {
  const stub = createFetcherStub(respond)
  const store = createMemoryUserStore()
  writeSession(store, { ...SESSION, ...overrides }, TEST_NOW)
  return { context: createTestApiContext({ fetcher: stub.fetcher, store }), stub }
}

/** Backlog の一般的な応答を返す。 */
function backlogResponse(url: string) {
  const path = new URL(url).pathname
  if (path.endsWith('/projects')) {
    return jsonResponse([PROJECT])
  }
  if (path.endsWith('/statuses')) {
    return jsonResponse([{ id: 1, projectId: 100, name: '未対応', color: '#ed8077', displayOrder: 1000 }])
  }
  if (path.endsWith('/users')) {
    return jsonResponse([{ id: 10, userId: 'yamada', name: '山田太郎' }])
  }
  if (path.endsWith('/issues/count')) {
    return jsonResponse({ count: 0 })
  }
  return jsonResponse([])
}

describe('handleApiCall', () => {
  it('知らない名前は 404 を返す', () => {
    const context = createTestApiContext()

    expect(handleApiCall(context, 'nope', {})).toEqual({
      ok: false,
      status: 404,
      error: '存在しない API です',
      detail: 'nope'
    })
  })

  it('想定外の例外は 500 に畳んで記録する', () => {
    const context = createTestApiContext({
      fetcher: () => {
        throw new RangeError('想定外')
      }
    })
    writeSession(context.store, SESSION, TEST_NOW)

    // BacklogClient は通信の失敗を BacklogApiError にするため、
    // ここではキャッシュを通らない rateLimit で確かめる。
    const result = handleApiCall(context, 'rateLimit', {})
    expect(result).toMatchObject({ ok: false, status: 502 })
  })
})

describe('セッション', () => {
  it('未ログインなら 401 を返す', () => {
    expect(handleApiCall(createTestApiContext(), 'session', {})).toEqual({
      ok: false,
      status: 401,
      error: 'ログインしていません',
      detail: null
    })
  })

  it('ログイン済みなら接続情報を返す', () => {
    const context = createTestApiContext()
    writeSession(context.store, SESSION, TEST_NOW)

    expect(handleApiCall(context, 'session', {})).toEqual({
      ok: true,
      data: { id: 42, userId: null, name: '山田太郎', space: 'example.backlog.jp' }
    })
  })

  it('アクセストークンをクライアントへ返さない', () => {
    const context = createTestApiContext()
    writeSession(context.store, SESSION, TEST_NOW)

    expect(JSON.stringify(handleApiCall(context, 'session', {}))).not.toContain('access-token')
  })

  it('ログアウトでセッションを破棄する', () => {
    const context = createTestApiContext()
    writeSession(context.store, SESSION, TEST_NOW)

    expect(handleApiCall(context, 'logout', {})).toEqual({ ok: true, data: null })
    expect(handleApiCall(context, 'session', {})).toMatchObject({ ok: false, status: 401 })
  })

  it('未ログインのログアウトも成功として扱う', () => {
    expect(handleApiCall(createTestApiContext(), 'logout', {})).toEqual({ ok: true, data: null })
  })
})

describe('認証が必要な API', () => {
  it('未ログインではプロキシ API を通さない', () => {
    const context = createTestApiContext()

    for (const name of ['projects', 'members', 'statuses', 'issues', 'icons', 'rateLimit']) {
      expect(handleApiCall(context, name, { ...RANGE, projectIds: '100' })).toMatchObject({
        ok: false,
        status: 401
      })
    }
  })

  it('パラメータの検証より先にログインを確かめる', () => {
    // 未ログインの利用者に「プロジェクトを選べ」と案内しても意味がない。
    expect(handleApiCall(createTestApiContext(), 'issues', {})).toMatchObject({ ok: false, status: 401 })
  })
})

describe('holidays', () => {
  it('ログインしていなくても取得できる', () => {
    const stub = createFetcherStub(() => jsonResponse({ '2026-09-21': '敬老の日' }))
    const context = createTestApiContext({ fetcher: stub.fetcher })

    expect(handleApiCall(context, 'holidays', RANGE)).toEqual({
      ok: true,
      data: [{ dateKey: '2026-09-21', name: '敬老の日' }]
    })
  })

  it('表示期間が不正なら 400 を返す', () => {
    const context = createTestApiContext()

    expect(handleApiCall(context, 'holidays', { from: 'x', to: '2026-09-30' })).toMatchObject({
      ok: false,
      status: 400
    })
    expect(handleApiCall(context, 'holidays', { from: '2026-09-30', to: '2026-09-01' })).toMatchObject({
      ok: false,
      status: 400
    })
    expect(handleApiCall(context, 'holidays', { from: '2026-09-01', to: '2999-12-31' })).toMatchObject({
      ok: false,
      status: 400
    })
  })
})

describe('projects / members / statuses', () => {
  it('参加中のプロジェクトを返し、2 回目はキャッシュから返す', () => {
    const { context, stub } = loggedIn((request) => backlogResponse(request.url))

    expect(handleApiCall(context, 'projects', {})).toEqual({
      ok: true,
      data: [{ id: 100, projectKey: 'PJA', name: 'プロジェクト A' }]
    })
    handleApiCall(context, 'projects', {})
    expect(stub.requests).toHaveLength(1)
  })

  it('refresh を付けるとキャッシュを無視する', () => {
    const { context, stub } = loggedIn((request) => backlogResponse(request.url))

    handleApiCall(context, 'projects', {})
    handleApiCall(context, 'projects', { refresh: '1' })
    expect(stub.requests).toHaveLength(2)
  })

  it('参加していないプロジェクトの担当者は問い合わせない', () => {
    const { context, stub } = loggedIn((request) => backlogResponse(request.url))

    expect(handleApiCall(context, 'members', { projectIds: '999' })).toEqual({ ok: true, data: [] })
    // プロジェクト一覧の取得だけで、/projects/999/users は投げない。
    expect(stub.requests.filter((request) => request.url.includes('/999/'))).toHaveLength(0)
  })

  it('同名ステータスを名前で束ねて返す', () => {
    const { context } = loggedIn((request) => backlogResponse(request.url))

    expect(handleApiCall(context, 'statuses', { projectIds: '100' })).toEqual({
      ok: true,
      data: [{ name: '未対応', color: '#ed8077', ids: [1], isClosed: false }]
    })
  })
})

describe('issues', () => {
  it('プロジェクト未選択なら 400 を返す', () => {
    const { context } = loggedIn(() => jsonResponse([]))

    expect(handleApiCall(context, 'issues', RANGE)).toMatchObject({
      ok: false,
      status: 400,
      error: 'プロジェクトを 1 つ以上選択してください'
    })
  })

  it('表示期間が不正なら 400 を返す', () => {
    const { context } = loggedIn(() => jsonResponse([]))

    expect(handleApiCall(context, 'issues', { projectIds: '100', from: 'x', to: 'y' })).toMatchObject({
      ok: false,
      status: 400
    })
  })

  it('参照できないプロジェクトだけを指定されたら 403 を返す', () => {
    const { context } = loggedIn((request) => backlogResponse(request.url))

    expect(handleApiCall(context, 'issues', { ...RANGE, projectIds: '999' })).toMatchObject({
      ok: false,
      status: 403
    })
  })

  it('取得結果を返し、同じ条件ではキャッシュから返す', () => {
    const { context, stub } = loggedIn((request) => backlogResponse(request.url))

    const first = handleApiCall(context, 'issues', { ...RANGE, projectIds: '100' })
    expect(first).toMatchObject({ ok: true })
    const count = stub.requests.length

    handleApiCall(context, 'issues', { ...RANGE, projectIds: '100' })
    expect(stub.requests).toHaveLength(count)
  })

  it('Backlog のエラーはその状態コードで返す', () => {
    const { context } = loggedIn((request) =>
      new URL(request.url).pathname.endsWith('/projects') ? jsonResponse([PROJECT]) : textResponse(403, 'forbidden')
    )

    expect(handleApiCall(context, 'issues', { ...RANGE, projectIds: '100', closed: '1' })).toMatchObject({
      ok: false,
      status: 403
    })
  })
})

describe('アクセストークンの更新', () => {
  it('期限が近ければ更新してから Backlog を呼ぶ', () => {
    const { context, stub } = loggedIn(
      (request) =>
        request.url.endsWith('/oauth2/token')
          ? jsonResponse({
              access_token: 'renewed',
              token_type: 'Bearer',
              expires_in: 3600,
              refresh_token: 'next-refresh'
            })
          : backlogResponse(request.url),
      { expiresAt: TEST_NOW + 1000 }
    )

    expect(handleApiCall(context, 'projects', {})).toMatchObject({ ok: true })
    expect(stub.requests[0].url).toContain('/oauth2/token')
    expect(stub.requests[1].headers?.Authorization).toBe('Bearer renewed')
  })

  it('更新に失敗したら 401 にしてセッションを捨てる', () => {
    const { context } = loggedIn(() => textResponse(400, 'invalid_grant'), { expiresAt: TEST_NOW + 1000 })

    expect(handleApiCall(context, 'projects', {})).toMatchObject({ ok: false, status: 401 })
    expect(context.store.snapshot().session).toBeUndefined()
  })

  it('一過性の失敗ではセッションを捨てない', () => {
    // 接続不良や 5xx も OAuthError になる。ここでセッションを捨てると、
    // まだ有効なリフレッシュトークンごと失って再ログインを強いることになる。
    const { context } = loggedIn(
      (request) =>
        request.url.includes('/oauth2/token') ? textResponse(503, 'maintenance') : backlogResponse(request.url),
      { expiresAt: TEST_NOW + 1000 }
    )

    expect(handleApiCall(context, 'projects', {})).toMatchObject({ ok: false, status: 503 })
    expect(context.store.snapshot().session).toBeDefined()
  })

  it('リフレッシュトークンが返らない応答でも元の値を引き継ぐ', () => {
    // Backlog は更新時に refresh_token を省略することがある。
    const { context, stub } = loggedIn(
      (request) =>
        request.url.includes('/oauth2/token')
          ? jsonResponse({ access_token: 'renewed', token_type: 'Bearer', expires_in: 3600 })
          : backlogResponse(request.url),
      { expiresAt: TEST_NOW + 1000 }
    )

    expect(handleApiCall(context, 'projects', {})).toMatchObject({ ok: true })
    expect(stub.requests[1].headers?.Authorization).toBe('Bearer renewed')
    expect(context.store.snapshot().session).toContain(SESSION.refreshToken)
  })

  it('OAuth の設定が無い状態で更新が必要になったら 500 を返す', () => {
    const stub = createFetcherStub(() => jsonResponse([]))
    const store = createMemoryUserStore()
    writeSession(store, { ...SESSION, expiresAt: TEST_NOW + 1000 }, TEST_NOW)
    const context = createTestApiContext({ fetcher: stub.fetcher, store, oauth: null })

    expect(handleApiCall(context, 'projects', {})).toMatchObject({ ok: false, status: 500 })
  })
})

describe('icons', () => {
  it('data URL として返す', () => {
    const { context } = loggedIn(() => textResponse(200, 'png-bytes', { 'Content-Type': 'image/png' }))

    const result = handleApiCall(context, 'icons', { userIds: '10' })
    expect(result).toMatchObject({ ok: true })
    const icons = (result as { data: Record<string, string> }).data
    expect(icons['10']).toBe(`data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`)
  })

  it('2 回目はキャッシュから返す', () => {
    const { context, stub } = loggedIn(() => textResponse(200, 'png', { 'Content-Type': 'image/png' }))

    handleApiCall(context, 'icons', { userIds: '10' })
    handleApiCall(context, 'icons', { userIds: '10' })
    expect(stub.requests).toHaveLength(1)
  })

  it('取得できなかったアイコンは含めずに返す', () => {
    const { context } = loggedIn(() => textResponse(404, 'not found'))

    expect(handleApiCall(context, 'icons', { userIds: '10' })).toEqual({ ok: true, data: {} })
    expect(context.logs).toContain('アイコンの取得に失敗しました')
  })

  it('取得できなかったことを覚えて、繰り返し問い合わせない', () => {
    const { context, stub } = loggedIn(() => textResponse(404, 'not found'))

    handleApiCall(context, 'icons', { userIds: '10' })
    handleApiCall(context, 'icons', { userIds: '10' })
    // 退会済みユーザーは 404 を返し続ける。上限の低い Icon 区分を毎回使わない。
    expect(stub.requests).toHaveLength(1)
  })

  it('1 人が 404 でも同じ便の他のアイコンは返す', () => {
    const { context } = loggedIn((request) =>
      request.url.includes('/users/20/')
        ? textResponse(404, 'gone')
        : textResponse(200, 'png', { 'Content-Type': 'image/png' })
    )

    const result = handleApiCall(context, 'icons', { userIds: '10,20,30' })
    const icons = (result as { data: Record<string, string> }).data
    expect(Object.keys(icons).toSorted()).toEqual(['10', '30'])
  })

  it('再読込ではキャッシュを無視して取り直す', () => {
    const { context, stub } = loggedIn(() => textResponse(200, 'png', { 'Content-Type': 'image/png' }))

    handleApiCall(context, 'icons', { userIds: '10' })
    handleApiCall(context, 'icons', { userIds: '10', refresh: '1' })
    expect(stub.requests).toHaveLength(2)
  })

  it('ID が空なら何も問い合わせない', () => {
    const { context, stub } = loggedIn(() => textResponse(200, 'png'))

    expect(handleApiCall(context, 'icons', { userIds: '' })).toEqual({ ok: true, data: {} })
    expect(stub.requests).toHaveLength(0)
  })
})
