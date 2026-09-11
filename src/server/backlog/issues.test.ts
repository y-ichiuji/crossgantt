import { describe, expect, it } from 'vitest'

import { createFetcherStub, jsonResponse } from '../test-utils'
import type { BacklogIssue } from './api-types'
import { BacklogClient } from './client'
import { buildDateQueries, fetchGanttIssues, isClosedStatus, MAX_URL_LENGTH, normalizeIssue } from './issues'
import type { FetchIssuesParams } from './issues'

const SPACE = 'example.backlog.jp'

function makeRawIssue(overrides: Partial<BacklogIssue> = {}): BacklogIssue {
  return {
    id: 1,
    projectId: 100,
    issueKey: 'PJA-1',
    summary: '課題',
    status: { id: 1, projectId: 100, name: '未対応', color: '#ed8077', displayOrder: 1000 },
    assignee: { id: 10, userId: 'yamada', name: '山田太郎' },
    startDate: '2026-08-31T15:00:00Z',
    dueDate: '2026-09-14T15:00:00Z',
    estimatedHours: 8,
    actualHours: null,
    parentIssueId: null,
    milestone: [
      {
        id: 5,
        projectId: 100,
        name: 'v1.0',
        startDate: null,
        releaseDueDate: null,
        archived: false
      }
    ],
    ...overrides
  }
}

describe('isClosedStatus', () => {
  it('既定の完了ステータス ID を完了とみなす', () => {
    expect(isClosedStatus({ id: 4, name: 'なにか' })).toBe(true)
  })

  it('名称でも判定する', () => {
    expect(isClosedStatus({ id: 42, name: '完了' })).toBe(true)
    expect(isClosedStatus({ id: 42, name: 'Closed' })).toBe(true)
    expect(isClosedStatus({ id: 42, name: ' closed ' })).toBe(true)
  })

  it('それ以外は未完了', () => {
    expect(isClosedStatus({ id: 1, name: '未対応' })).toBe(false)
    expect(isClosedStatus({ id: 5, name: 'レビュー中' })).toBe(false)
  })
})

describe('buildDateQueries', () => {
  it('重なり条件・期限日条件・開始日条件の 3 本を作る', () => {
    const queries = buildDateQueries('2026-09-01', '2026-09-30')
    expect(queries).toEqual([
      { startDateUntil: '2026-09-30', dueDateSince: '2026-09-01' },
      { dueDateSince: '2026-09-01', dueDateUntil: '2026-09-30' },
      { startDateSince: '2026-09-01', startDateUntil: '2026-09-30' }
    ])
  })
})

describe('normalizeIssue', () => {
  it('Backlog のレスポンスを描画用に整形する', () => {
    const issue = normalizeIssue(SPACE, { 100: 'PJA' }, makeRawIssue())
    expect(issue).toMatchObject({
      id: 1,
      issueKey: 'PJA-1',
      url: 'https://example.backlog.jp/view/PJA-1',
      projectKey: 'PJA',
      assigneeName: '山田太郎',
      isClosed: false,
      startDate: '2026-09-01',
      dueDate: '2026-09-15',
      estimatedHours: 8,
      milestoneNames: ['v1.0']
    })
  })

  it('プロジェクトキーが未知なら課題キーから導出する', () => {
    const issue = normalizeIssue(SPACE, {}, makeRawIssue({ issueKey: 'ABC-DEF-42' }))
    expect(issue.projectKey).toBe('ABC-DEF')
  })

  it('担当者やマイルストーンが無くても壊れない', () => {
    const issue = normalizeIssue(SPACE, {}, makeRawIssue({ assignee: null, milestone: null }))
    expect(issue.assigneeId).toBeNull()
    expect(issue.assigneeName).toBeNull()
    expect(issue.milestoneNames).toEqual([])
  })
})

/** URL に応じた応答を返すクライアントを作る。 */
function createClient(handler: (url: URL) => unknown) {
  const stub = createFetcherStub((request) => jsonResponse(handler(new URL(request.url))))
  return { stub, client: new BacklogClient({ space: SPACE, accessToken: 'key', fetcher: stub.fetcher }) }
}

/** 取得条件の既定値。テストごとに必要な項目だけ上書きする。 */
function params(overrides: Partial<FetchIssuesParams> = {}): FetchIssuesParams {
  return {
    projectIds: [100],
    assigneeIds: [],
    statusIds: [],
    from: '2026-09-01',
    to: '2026-09-30',
    keyword: '',
    includeNoDate: false,
    ...overrides
  }
}

describe('fetchGanttIssues', () => {
  it('プロジェクト未選択なら Backlog を呼ばない', () => {
    const { client } = createClient(() => ({}))

    expect(fetchGanttIssues(client, {}, params({ projectIds: [] }))).toEqual({ issues: [], truncated: false })
    expect(client.requestCount).toBe(0)
  })

  it('3 本のクエリ結果を課題 ID でマージする', () => {
    const { client } = createClient((url) => {
      if (url.pathname.endsWith('/issues/count')) {
        return { count: 1 }
      }
      // クエリの種類ごとに異なる課題を返す。
      if (url.searchParams.has('startDateUntil') && url.searchParams.has('dueDateSince')) {
        return [makeRawIssue({ id: 1, issueKey: 'PJA-1' })]
      }
      if (url.searchParams.has('dueDateUntil')) {
        return [makeRawIssue({ id: 2, issueKey: 'PJA-2', startDate: null })]
      }
      return [makeRawIssue({ id: 1, issueKey: 'PJA-1' })]
    })

    const result = fetchGanttIssues(client, { 100: 'PJA' }, params({ assigneeIds: [10], statusIds: [1, 2] }))

    expect(result.issues.map((issue) => issue.id).toSorted((a, b) => a - b)).toEqual([1, 2])
    expect(result.truncated).toBe(false)
    // 3 クエリ × (件数 1 回 + ページ 1 回)
    expect(client.requestCount).toBe(6)
  })

  it('件数はまとめて 1 度に問い合わせる', () => {
    const { stub, client } = createClient((url) => (url.pathname.endsWith('/issues/count') ? { count: 0 } : []))

    fetchGanttIssues(client, {}, params())

    // 3 本の件数取得が 1 回のまとめ投げに収まる。
    expect(stub.batches).toHaveLength(1)
    expect(stub.batches[0]).toHaveLength(3)
  })

  it('件数が 0 のクエリではページ取得をしない', () => {
    const { client } = createClient((url) => (url.pathname.endsWith('/issues/count') ? { count: 0 } : []))

    fetchGanttIssues(client, {}, params())

    expect(client.requestCount).toBe(3)
  })

  it('件数が数値でなければ失敗として扱う', () => {
    const { client } = createClient((url) => (url.pathname.endsWith('/issues/count') ? { count: 'many' } : []))

    expect(() => fetchGanttIssues(client, {}, params())).toThrow(expect.objectContaining({ name: 'BacklogApiError' }))
  })

  it('日付未設定を含める場合は 4 本目のクエリを投げ、日付なしだけを採用する', () => {
    const { client } = createClient((url) => {
      if (url.pathname.endsWith('/issues/count')) {
        return { count: 1 }
      }
      const hasDateCondition =
        url.searchParams.has('startDateUntil') ||
        url.searchParams.has('dueDateUntil') ||
        url.searchParams.has('startDateSince')
      if (hasDateCondition) {
        return [makeRawIssue({ id: 1 })]
      }
      // 日付条件なしのクエリには日付ありの課題も混ざって返る。
      return [makeRawIssue({ id: 1 }), makeRawIssue({ id: 99, issueKey: 'PJA-99', startDate: null, dueDate: null })]
    })

    const result = fetchGanttIssues(client, {}, params({ includeNoDate: true }))

    expect(result.issues.map((issue) => issue.id).toSorted((a, b) => a - b)).toEqual([1, 99])
  })

  it('プロジェクトが多い場合は URL に収まる組に分けて問い合わせる', () => {
    // Apps Script の UrlFetchApp は 2KB を超える URL を受け付けない。
    const { stub, client } = createClient((url) => (url.pathname.endsWith('/issues/count') ? { count: 0 } : []))
    const projectIds = Array.from({ length: 200 }, (_value, index) => 100_000 + index)

    fetchGanttIssues(client, {}, params({ projectIds }))

    for (const request of stub.requests) {
      expect(request.url.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    }
    // 1 組では収まらないので、3 本の日付クエリが組の数だけ繰り返される。
    expect(stub.requests.length).toBeGreaterThan(3)
    expect(stub.requests.length % 3).toBe(0)
  })

  it('分けて問い合わせても課題は ID でマージする', () => {
    const { client } = createClient((url) => {
      if (url.pathname.endsWith('/issues/count')) {
        return { count: 1 }
      }
      // どの組にも同じ課題が含まれる状況を作る。
      const [first] = url.searchParams.getAll('projectId[]')
      return [makeRawIssue({ id: Number(first), issueKey: `PJA-${first}` })]
    })
    const projectIds = Array.from({ length: 200 }, (_value, index) => 100_000 + index)

    const result = fetchGanttIssues(client, {}, params({ projectIds }))

    const ids = result.issues.map((issue) => issue.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ステータスの指定が多すぎる場合は Backlog へ渡さず、取得後に絞る', () => {
    // ステータスの列挙だけで URL を埋め尽くす状況。プロジェクトを分けても収まらない。
    const statusIds = Array.from({ length: 200 }, (_value, index) => 1_000_000 + index)
    const status = (id: number) => ({ id, projectId: 100, name: 'なにか', color: '#ed8077', displayOrder: 1000 })
    const { stub, client } = createClient((url) =>
      url.pathname.endsWith('/issues/count')
        ? { count: 2 }
        : [
            makeRawIssue({ id: 1, status: status(statusIds[0]) }),
            makeRawIssue({ id: 2, issueKey: 'PJA-2', status: status(9_999_999) })
          ]
    )

    const result = fetchGanttIssues(client, {}, params({ statusIds }))

    for (const request of stub.requests) {
      expect(new URL(request.url).searchParams.has('statusId[]')).toBe(false)
      expect(request.url.length).toBeLessThanOrEqual(MAX_URL_LENGTH)
    }
    // Backlog 側で絞れなくても、結果は同じになる。
    expect(result.issues.map((issue) => issue.id)).toEqual([1])
  })

  it('担当者の指定が多すぎる場合も取得後に絞る', () => {
    const assigneeIds = Array.from({ length: 200 }, (_value, index) => 2_000_000 + index)
    const { stub, client } = createClient((url) =>
      url.pathname.endsWith('/issues/count')
        ? { count: 2 }
        : [
            makeRawIssue({ id: 1, assignee: { id: assigneeIds[0], userId: 'a', name: '担当 A' } }),
            makeRawIssue({ id: 2, issueKey: 'PJA-2', assignee: { id: 9_999_999, userId: 'b', name: '担当 B' } })
          ]
    )

    const result = fetchGanttIssues(client, {}, params({ assigneeIds }))

    for (const request of stub.requests) {
      expect(new URL(request.url).searchParams.has('assigneeId[]')).toBe(false)
    }
    expect(result.issues.map((issue) => issue.id)).toEqual([1])
  })

  it('キーワードが長すぎて収まらなければ、短くするよう伝える', () => {
    const { stub, client } = createClient(() => [])

    expect(() => fetchGanttIssues(client, {}, params({ keyword: 'あ'.repeat(1000) }))).toThrow(
      expect.objectContaining({ name: 'ApiFailure', status: 400 })
    )
    // 失敗すると分かっているので、Backlog へは投げない。
    expect(stub.requests).toHaveLength(0)
  })

  it('ページ数の上限を超えたら truncated を立てる', () => {
    const { client } = createClient((url) => {
      if (url.pathname.endsWith('/issues/count')) {
        return { count: 100_000 }
      }
      const offset = Number(url.searchParams.get('offset') ?? 0)
      return [makeRawIssue({ id: offset + 1, issueKey: `PJA-${offset + 1}` })]
    })

    expect(fetchGanttIssues(client, {}, params()).truncated).toBe(true)
  })
})
