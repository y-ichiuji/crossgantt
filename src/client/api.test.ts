import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultFilter, encodeNameList, parseNameList } from '../shared/filter'
import { decodeState } from '../shared/oauth'
import { NOW } from '../shared/test-fixtures'
import type { IssuesQuery } from '../shared/types'
import {
  ApiError,
  getIcons,
  getIssues,
  getMembers,
  getProjects,
  getSession,
  getStatuses,
  isServerAvailable,
  logout,
  startLogin
} from './api'
import { installBootstrap, installScriptRun, removeBootstrap } from './test-utils'
import type { ScriptRunStub } from './test-utils'

let stub: ScriptRunStub | null = null

function install(responder: Parameters<typeof installScriptRun>[0]) {
  stub = installScriptRun(responder)
  return stub
}

/** 成功の応答を返す。 */
function ok(data: unknown) {
  return install(() => ({ ok: true as const, data }))
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

afterEach(() => {
  stub?.restore()
  stub = null
  removeBootstrap()
  vi.restoreAllMocks()
})

describe('呼び出しの共通挙動', () => {
  it('サーバーが無い環境では 503 を投げる', async () => {
    const thrown = (await getProjects(false).catch((error: unknown) => error)) as ApiError

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown.status).toBe(503)
    expect(isServerAvailable()).toBe(false)
  })

  it('サーバーがあれば isServerAvailable が true になる', () => {
    ok([])
    expect(isServerAvailable()).toBe(true)
  })

  it('エラーの応答はサーバーのメッセージを ApiError にして投げる', async () => {
    install(() => ({ ok: false as const, status: 401, error: 'ログインしていません', detail: null }))

    const thrown = (await getProjects(false).catch((error: unknown) => error)) as ApiError
    expect(thrown.status).toBe(401)
    expect(thrown.message).toBe('ログインしていません')
    expect(thrown.isUnauthorized).toBe(true)
  })

  it('detail も保持する', async () => {
    install(() => ({ ok: false as const, status: 400, error: 'まずい', detail: '詳細' }))

    const thrown = (await getProjects(false).catch((error: unknown) => error)) as ApiError
    expect(thrown.detail).toBe('詳細')
    expect(thrown.isUnauthorized).toBe(false)
  })

  it('サーバー側の呼び出し自体が失敗したら 500 にする', async () => {
    install(() => new Error('Script function not found'))

    const thrown = (await getProjects(false).catch((error: unknown) => error)) as ApiError
    expect(thrown.status).toBe(500)
    expect(thrown.message).toBe('Script function not found')
  })

  it('解釈できない応答は 502 にする', async () => {
    // 成功ハンドラに渡る文字列が JSON でない場合。
    stub = installScriptRun(() => ({ ok: true as const, data: undefined }))
    const carrier = window as unknown as {
      google: { script: { run: { withSuccessHandler: (handler: (value: string) => void) => unknown } } }
    }
    const original = carrier.google.script.run
    carrier.google.script.run = {
      withSuccessHandler: (handler) => ({
        withFailureHandler: () => ({
          apiCall: () => {
            queueMicrotask(() => handler('not json'))
          }
        })
      })
    } as typeof original

    const thrown = (await getProjects(false).catch((error: unknown) => error)) as ApiError
    expect(thrown.status).toBe(502)
  })

  it('中断されたら AbortError を投げ、結果を捨てる', async () => {
    ok([])
    const controller = new AbortController()
    const promise = getProjects(false, controller.signal)
    controller.abort()

    const thrown = (await promise.catch((error: unknown) => error)) as DOMException
    expect(thrown.name).toBe('AbortError')
  })

  it('すでに中断済みなら呼び出さない', async () => {
    const stubbed = ok([])
    const controller = new AbortController()
    controller.abort()

    await expect(getProjects(false, controller.signal)).rejects.toThrow(DOMException)
    expect(stubbed.calls).toHaveLength(0)
  })
})

describe('getSession / logout', () => {
  it('接続ユーザーを返す', async () => {
    const stubbed = ok({ id: 42, userId: null, name: '山田太郎', space: 'example.backlog.jp' })

    const viewer = await getSession()
    expect(viewer.name).toBe('山田太郎')
    expect(stubbed.calls[0]).toEqual({ name: 'session', params: {} })
  })

  it('ログアウトは logout を呼ぶ', async () => {
    const stubbed = ok(null)

    await expect(logout()).resolves.toBeUndefined()
    expect(stubbed.calls[0].name).toBe('logout')
  })
})

describe('getProjects / getMembers / getStatuses', () => {
  it('refresh を付けない', async () => {
    const stubbed = ok([])
    await getProjects(false)
    expect(stubbed.calls[0]).toEqual({ name: 'projects', params: {} })
  })

  it('refresh=1 を付ける', async () => {
    const stubbed = ok([])
    await getProjects(true)
    expect(stubbed.calls[0].params).toEqual({ refresh: '1' })
  })

  it('プロジェクト ID をカンマ区切りで渡す', async () => {
    const stubbed = ok([])
    await getMembers([3, 1], false)
    expect(stubbed.calls[0]).toEqual({ name: 'members', params: { projectIds: '3,1' } })
  })

  it('ステータスも同じ形式で渡す', async () => {
    const stubbed = ok([])
    await getStatuses([5], true)
    expect(stubbed.calls[0]).toEqual({ name: 'statuses', params: { projectIds: '5', refresh: '1' } })
  })
})

describe('getIssues', () => {
  const response = { issues: [], truncated: false, requestCount: 0, fetchedAt: '' }

  it('必須パラメータだけを送る', async () => {
    const stubbed = ok(response)
    const query = baseQuery()

    await getIssues(query, false)

    expect(stubbed.calls[0]).toEqual({
      name: 'issues',
      params: { projectIds: '1,2', from: query.from, to: query.to }
    })
  })

  it('指定された条件をすべて送る', async () => {
    const stubbed = ok(response)

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

    expect(stubbed.calls[0].params).toMatchObject({
      assigneeIds: '10,20',
      statuses: encodeNameList(['未対応', '処理中']),
      keyword: 'API',
      closed: '1',
      nodate: '1',
      refresh: '1'
    })
  })

  it('カンマを含むステータス名でも要素の境界が壊れない', async () => {
    const stubbed = ok(response)
    const statusNames = ['レビュー中（PR作成済み, 未マージ）', '未対応']

    await getIssues(baseQuery({ statusNames }), false)

    // サーバーは `parseNameList` で戻すため、往復して同じ並びになることが要件。
    expect(parseNameList(stubbed.calls[0].params.statuses)).toEqual(statusNames)
  })

  it('レスポンスをそのまま返す', async () => {
    const body = { issues: [], truncated: true, requestCount: 7, fetchedAt: '2026-09-10T00:00:00.000Z' }
    ok(body)
    expect(await getIssues(baseQuery(), false)).toEqual(body)
  })
})

describe('getIcons', () => {
  it('ID をカンマ区切りで渡す', async () => {
    const stubbed = ok({ 10: 'data:image/png;base64,AAAA' })

    expect(await getIcons([10, 20])).toEqual({ 10: 'data:image/png;base64,AAAA' })
    expect(stubbed.calls[0]).toEqual({ name: 'icons', params: { userIds: '10,20' } })
  })

  it('ID が無ければ呼び出さない', async () => {
    const stubbed = ok({})

    expect(await getIcons([])).toEqual({})
    expect(stubbed.calls).toHaveLength(0)
  })
})

describe('startLogin', () => {
  /** `target="_top"` のリンクをクリックして最上位フレームを遷移させる。 */
  function captureNavigation(): HTMLAnchorElement[] {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
    return clicked
  }

  it('認可画面へのリンクを最上位フレームで開く', () => {
    const bootstrap = installBootstrap()
    const clicked = captureNavigation()

    startLogin('example.backlog.jp', 'projects=1,2&from=2026-09-01')

    expect(clicked).toHaveLength(1)
    expect(clicked[0].target).toBe('_top')

    const url = new URL(clicked[0].href)
    expect(url.origin).toBe('https://example.backlog.jp')
    expect(url.pathname).toBe('/OAuth2AccessRequest.action')
    expect(url.searchParams.get('client_id')).toBe('client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(bootstrap.redirectUri)
    expect(decodeState(url.searchParams.get('state'))).toEqual({
      nonce: bootstrap.nonce,
      space: 'example.backlog.jp',
      query: 'projects=1,2&from=2026-09-01'
    })
  })

  it('リンクは後片付けする', () => {
    installBootstrap()
    captureNavigation()

    startLogin('example.backlog.jp', '')

    expect(document.querySelectorAll('a')).toHaveLength(0)
  })

  it('Backlog 以外のドメインは拒否する', () => {
    installBootstrap()
    const clicked = captureNavigation()

    expect(() => startLogin('evil.example.com', '')).toThrow(ApiError)
    expect(clicked).toHaveLength(0)
  })

  it('OAuth の設定が未完了なら拒否する', () => {
    installBootstrap({ configured: false })
    const clicked = captureNavigation()

    expect(() => startLogin('example.backlog.jp', '')).toThrow(ApiError)
    expect(clicked).toHaveLength(0)
  })
})
