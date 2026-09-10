import { describe, expect, it, vi } from 'vitest'

import type { BacklogIssue } from './api-types'
import { BacklogClient } from './client'
import { buildDateQueries, fetchGanttIssues, isClosedStatus, normalizeIssue } from './issues'

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

/** URL に応じた応答を返すモック fetch を作る。 */
function makeFetchMock(handler: (url: URL) => unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }) as unknown as typeof fetch
}

describe('fetchGanttIssues', () => {
  it('プロジェクト未選択なら Backlog を呼ばない', async () => {
    const fetchImpl = makeFetchMock(() => ({}))
    const client = new BacklogClient({ space: SPACE, apiKey: 'key', fetchImpl })
    const result = await fetchGanttIssues(
      client,
      {},
      {
        projectIds: [],
        assigneeIds: [],
        statusIds: [],
        from: '2026-09-01',
        to: '2026-09-30',
        keyword: '',
        includeNoDate: false
      }
    )
    expect(result).toEqual({ issues: [], truncated: false })
    expect(client.requestCount).toBe(0)
  })

  it('3 本のクエリ結果を課題 ID でマージする', async () => {
    const fetchImpl = makeFetchMock((url) => {
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
    const client = new BacklogClient({ space: SPACE, apiKey: 'key', fetchImpl })

    const result = await fetchGanttIssues(
      client,
      { 100: 'PJA' },
      {
        projectIds: [100],
        assigneeIds: [10],
        statusIds: [1, 2],
        from: '2026-09-01',
        to: '2026-09-30',
        keyword: '',
        includeNoDate: false
      }
    )

    expect(result.issues.map((issue) => issue.id).toSorted((a, b) => a - b)).toEqual([1, 2])
    expect(result.truncated).toBe(false)
    // 3 クエリ × (件数 1 回 + ページ 1 回)
    expect(client.requestCount).toBe(6)
  })

  it('件数が 0 のクエリではページ取得をしない', async () => {
    const fetchImpl = makeFetchMock((url) => (url.pathname.endsWith('/issues/count') ? { count: 0 } : []))
    const client = new BacklogClient({ space: SPACE, apiKey: 'key', fetchImpl })

    await fetchGanttIssues(
      client,
      {},
      {
        projectIds: [100],
        assigneeIds: [],
        statusIds: [],
        from: '2026-09-01',
        to: '2026-09-30',
        keyword: '',
        includeNoDate: false
      }
    )

    expect(client.requestCount).toBe(3)
  })

  it('日付未設定を含める場合は 4 本目のクエリを投げ、日付なしだけを採用する', async () => {
    const fetchImpl = makeFetchMock((url) => {
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
    const client = new BacklogClient({ space: SPACE, apiKey: 'key', fetchImpl })

    const result = await fetchGanttIssues(
      client,
      {},
      {
        projectIds: [100],
        assigneeIds: [],
        statusIds: [],
        from: '2026-09-01',
        to: '2026-09-30',
        keyword: '',
        includeNoDate: true
      }
    )

    const ids = result.issues.map((issue) => issue.id).toSorted((a, b) => a - b)
    expect(ids).toEqual([1, 99])
  })

  it('ページ数の上限を超えたら truncated を立てる', async () => {
    const fetchImpl = makeFetchMock((url) => {
      if (url.pathname.endsWith('/issues/count')) {
        return { count: 100_000 }
      }
      const offset = Number(url.searchParams.get('offset') ?? 0)
      return [makeRawIssue({ id: offset + 1, issueKey: `PJA-${offset + 1}` })]
    })
    const client = new BacklogClient({ space: SPACE, apiKey: 'key', fetchImpl })

    const result = await fetchGanttIssues(
      client,
      {},
      {
        projectIds: [100],
        assigneeIds: [],
        statusIds: [],
        from: '2026-09-01',
        to: '2026-09-30',
        keyword: '',
        includeNoDate: false
      }
    )

    expect(result.truncated).toBe(true)
  })
})
