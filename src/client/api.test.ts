import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultFilter } from '../shared/filter'
import { NOW } from '../shared/test-fixtures'
import type { IssuesQuery } from '../shared/types'
import { ApiError, getIssues, getMembers, getProjects, getSession, getStatuses, logout, startLogin } from './api'

const originalFetch = globalThis.fetch

type Call = { url: string; init: RequestInit | undefined }

let calls: Call[]

function stubFetch(responder: (url: string) => Response) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    return responder(url)
  }) as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function baseQuery(overrides: Partial<IssuesQuery> = {}): IssuesQuery {
  const base = defaultFilter(NOW)
  return {
    projectIds: [1, 2],
    assigneeIds: [],
    statusNames: [],
    from: base.from,
    to: base.to,
    keyword: '',
    includeClosed: false,
    includeNoDate: false,
    ...overrides
  }
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('リクエストの共通挙動', () => {
  it('same-origin で Cookie を送る', async () => {
    stubFetch(() => json({ id: 1, userId: null, name: 'x', space: 'example.backlog.jp' }))
    await getSession()
    expect(calls[0].init?.credentials).toBe('same-origin')
  })

  it('エラー時はサーバーのメッセージを ApiError にして投げる', async () => {
    stubFetch(() => json({ error: 'ログインしていません' }, 401))
    const thrown = (await getProjects(false).catch((error: unknown) => error)) as ApiError

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown.status).toBe(401)
    expect(thrown.message).toBe('ログインしていません')
    expect(thrown.isUnauthorized).toBe(true)
  })

  it('detail も保持する', async () => {
    stubFetch(() => json({ error: 'まずい', detail: '詳細' }, 400))
    const thrown = (await getProjects(false).catch((error: unknown) => error)) as ApiError
    expect(thrown.detail).toBe('詳細')
    expect(thrown.isUnauthorized).toBe(false)
  })

  it('JSON で無いエラー本文でもステータスから既定のメッセージを作る', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))
    const thrown = (await getProjects(false).catch((error: unknown) => error)) as ApiError
    expect(thrown.status).toBe(500)
    expect(thrown.message).toContain('500')
  })
})

describe('getSession', () => {
  it('接続ユーザーを返す', async () => {
    stubFetch(() => json({ id: 42, userId: null, name: '山田太郎', space: 'example.backlog.jp' }))
    const viewer = await getSession()

    expect(viewer.name).toBe('山田太郎')
    expect(calls[0].url).toBe('/api/auth/session')
  })
})

describe('startLogin', () => {
  // location を差し替えたまま返すと、以降のテストでは pathname と search しか
  // 生えていない偽物が残り、history.replaceState も効かなくなる。
  // vi.restoreAllMocks() では defineProperty を取り消せないため明示的に戻す。
  const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')
  afterEach(() => {
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation)
    }
  })

  it('スペースと戻り先を付けてログインへ遷移する', () => {
    window.history.replaceState(null, '', '/?projects=1,2')
    const assigned: string[] = []
    // happy-dom では location.href への代入で遷移が起きるため、差し替えて記録する。
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        pathname: '/',
        search: '?projects=1,2',
        set href(value: string) {
          assigned.push(value)
        },
        get href() {
          return 'http://localhost/'
        }
      }
    })

    startLogin('example.backlog.jp')

    const url = new URL(assigned[0], 'http://localhost')
    expect(url.pathname).toBe('/api/auth/login')
    expect(url.searchParams.get('space')).toBe('example.backlog.jp')
    expect(url.searchParams.get('returnTo')).toBe('/?projects=1,2')
  })
})

describe('logout', () => {
  it('POST で呼び出し、204 でも例外にならない', async () => {
    stubFetch(() => new Response(null, { status: 204 }))
    await expect(logout()).resolves.toBeUndefined()
    expect(calls[0].url).toBe('/api/auth/logout')
    expect(calls[0].init?.method).toBe('POST')
  })
})

describe('getProjects', () => {
  it('refresh を付けない', async () => {
    stubFetch(() => json([]))
    await getProjects(false)
    expect(calls[0].url).toBe('/api/projects')
  })

  it('refresh=1 を付ける', async () => {
    stubFetch(() => json([]))
    await getProjects(true)
    expect(calls[0].url).toBe('/api/projects?refresh=1')
  })
})

describe('getMembers / getStatuses', () => {
  it('プロジェクト ID をカンマ区切りで渡す', async () => {
    stubFetch(() => json([]))
    await getMembers([3, 1], false)
    expect(new URL(calls[0].url, 'http://x').searchParams.get('projectIds')).toBe('3,1')
  })

  it('ステータスも同じ形式で渡す', async () => {
    stubFetch(() => json([]))
    await getStatuses([5], true)
    const url = new URL(calls[0].url, 'http://x')
    expect(url.pathname).toBe('/api/statuses')
    expect(url.searchParams.get('projectIds')).toBe('5')
    expect(url.searchParams.get('refresh')).toBe('1')
  })
})

describe('getIssues', () => {
  it('必須パラメータだけを送る', async () => {
    stubFetch(() => json({ issues: [], truncated: false, requestCount: 0, fetchedAt: '' }))
    await getIssues(baseQuery(), false)

    const url = new URL(calls[0].url, 'http://x')
    expect(url.pathname).toBe('/api/issues')
    expect(url.searchParams.get('projectIds')).toBe('1,2')
    expect(url.searchParams.has('assigneeIds')).toBe(false)
    expect(url.searchParams.has('statuses')).toBe(false)
    expect(url.searchParams.has('keyword')).toBe(false)
    expect(url.searchParams.has('closed')).toBe(false)
    expect(url.searchParams.has('nodate')).toBe(false)
    expect(url.searchParams.has('refresh')).toBe(false)
  })

  it('指定された条件をすべて送る', async () => {
    stubFetch(() => json({ issues: [], truncated: false, requestCount: 0, fetchedAt: '' }))
    await getIssues(
      baseQuery({
        assigneeIds: [10, 20],
        statusNames: ['未対応', '処理中'],
        keyword: 'API',
        includeClosed: true,
        includeNoDate: true
      }),
      true
    )

    const url = new URL(calls[0].url, 'http://x')
    expect(url.searchParams.get('assigneeIds')).toBe('10,20')
    expect(url.searchParams.get('statuses')).toBe('未対応,処理中')
    expect(url.searchParams.get('keyword')).toBe('API')
    expect(url.searchParams.get('closed')).toBe('1')
    expect(url.searchParams.get('nodate')).toBe('1')
    expect(url.searchParams.get('refresh')).toBe('1')
  })

  it('レスポンスをそのまま返す', async () => {
    const body = { issues: [], truncated: true, requestCount: 7, fetchedAt: '2026-09-10T00:00:00.000Z' }
    stubFetch(() => json(body))
    expect(await getIssues(baseQuery(), false)).toEqual(body)
  })
})
