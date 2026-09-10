/**
 * Backlog API へのプロキシ。
 *
 * ブラウザから Backlog API を直接呼ばず、必ずこの Worker を経由させる。
 * 理由は次の 3 点。
 * 1. Backlog API はブラウザからのクロスオリジン呼び出しを想定していない
 * 2. ページングやクエリのマージをサーバー側で完結させ、往復回数を減らせる
 * 3. レート制限対策のキャッシュを一元管理できる
 */

import { Hono } from 'hono'
import { isDateKey } from '../shared/date'
import type { ApiErrorBody, IssuesResponse } from '../shared/types'
import { BacklogApiError, BacklogClient } from './backlog/client'
import { fetchGanttIssues } from './backlog/issues'
import { fetchMembers, fetchProjects, fetchStatusGroups, fetchViewer, resolveStatusIds } from './backlog/masters'
import { normalizeSpace } from './backlog/space'
import { hashKey, withJsonCache } from './cache'

export type ApiEnv = {
  Bindings: CloudflareBindings
  Variables: {
    client: BacklogClient
    apiKeyHash: string
  }
}

/** マスタ情報のキャッシュ秒数。頻繁には変わらないため長めに取る。 */
const MASTER_TTL = 300

/** 課題のキャッシュ秒数。連打による Search 区分の消費を抑える。 */
const ISSUES_TTL = 60

/** API キーとして受け付ける形式。空白や制御文字を含むものは弾く。 */
const API_KEY_PATTERN = /^[A-Za-z0-9_-]{8,256}$/

export const api = new Hono<ApiEnv>()

api.use('*', async (c, next) => {
  // 認証情報を含むレスポンスなので、経路上のどこにもキャッシュさせない。
  c.header('Cache-Control', 'no-store')

  const space = normalizeSpace(c.req.header('X-Backlog-Space'))
  if (!space) {
    return c.json<ApiErrorBody>(
      {
        error: 'Backlog のスペースドメインが正しくありません',
        detail: 'example.backlog.jp / example.backlog.com / example.backlogtool.com の形式で指定してください'
      },
      400
    )
  }

  const apiKey = c.req.header('X-Backlog-Api-Key')?.trim()
  if (!apiKey || !API_KEY_PATTERN.test(apiKey)) {
    return c.json<ApiErrorBody>({ error: 'API キーが指定されていないか、形式が正しくありません' }, 401)
  }

  c.set('client', new BacklogClient({ space, apiKey }))
  c.set('apiKeyHash', await hashKey(space, apiKey))
  await next()
})

api.onError((err, c) => {
  if (err instanceof BacklogApiError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502
    return c.json<ApiErrorBody>({ error: err.message, detail: err.detail }, status as 400)
  }
  console.error('unexpected api error', err)
  return c.json<ApiErrorBody>({ error: '予期しないエラーが発生しました' }, 500)
})

/** カンマ区切りの ID リストを解釈する。 */
function parseIds(value: string | undefined): number[] {
  if (!value) {
    return []
  }
  const ids = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  return [...new Set(ids)].sort((a, b) => a - b)
}

/** カンマ区切りの名前リストを解釈する。 */
function parseNames(value: string | undefined): string[] {
  if (!value) {
    return []
  }
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    )
  ]
}

function parseBool(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function shouldBypassCache(value: string | undefined): boolean {
  return parseBool(value)
}

/** API キーの検証を兼ねた接続確認。 */
api.post('/connect', async (c) => {
  const viewer = await fetchViewer(c.var.client)
  return c.json(viewer)
})

/** 参加中のプロジェクト一覧。 */
api.get('/projects', async (c) => {
  const bypass = shouldBypassCache(c.req.query('refresh'))
  const projects = await withJsonCache('projects', [c.var.apiKeyHash], MASTER_TTL, bypass, () =>
    fetchProjects(c.var.client)
  )
  return c.json(projects)
})

/** 指定プロジェクト群の担当者候補。 */
api.get('/members', async (c) => {
  const projectIds = parseIds(c.req.query('projectIds'))
  const bypass = shouldBypassCache(c.req.query('refresh'))
  const members = await withJsonCache('members', [c.var.apiKeyHash, projectIds.join(',')], MASTER_TTL, bypass, () =>
    fetchMembers(c.var.client, projectIds)
  )
  return c.json(members)
})

/** 指定プロジェクト群のステータス（名前で統合済み）。 */
api.get('/statuses', async (c) => {
  const projectIds = parseIds(c.req.query('projectIds'))
  const bypass = shouldBypassCache(c.req.query('refresh'))
  const statuses = await withJsonCache('statuses', [c.var.apiKeyHash, projectIds.join(',')], MASTER_TTL, bypass, () =>
    fetchStatusGroups(c.var.client, projectIds)
  )
  return c.json(statuses)
})

/** 課題の取得。ページングとクエリのマージはここで完結させる。 */
api.get('/issues', async (c) => {
  const projectIds = parseIds(c.req.query('projectIds'))
  const assigneeIds = parseIds(c.req.query('assigneeIds'))
  const statusNames = parseNames(c.req.query('statuses'))
  const keyword = c.req.query('keyword')?.trim() ?? ''
  const includeClosed = parseBool(c.req.query('closed'))
  const includeNoDate = parseBool(c.req.query('nodate'))
  const from = c.req.query('from') ?? ''
  const to = c.req.query('to') ?? ''
  const bypass = shouldBypassCache(c.req.query('refresh'))

  if (projectIds.length === 0) {
    return c.json<ApiErrorBody>({ error: 'プロジェクトを 1 つ以上選択してください' }, 400)
  }
  if (!isDateKey(from) || !isDateKey(to)) {
    return c.json<ApiErrorBody>({ error: '表示期間の指定が正しくありません' }, 400)
  }
  if (from > to) {
    return c.json<ApiErrorBody>({ error: '表示期間の開始日が終了日より後になっています' }, 400)
  }

  const cacheKeyParts = [
    c.var.apiKeyHash,
    projectIds.join(','),
    assigneeIds.join(','),
    statusNames.join(','),
    from,
    to,
    keyword,
    includeClosed ? '1' : '0',
    includeNoDate ? '1' : '0'
  ]

  const body = await withJsonCache<IssuesResponse>('issues', cacheKeyParts, ISSUES_TTL, bypass, async () => {
    const client = c.var.client

    // ステータス条件が不要な場合（完了も含めて全件対象）は、
    // ステータス一覧の取得そのものを省いてリクエスト数を減らす。
    let statusIds: number[] = []
    if (!includeClosed || statusNames.length > 0) {
      const groups = await withJsonCache('statuses', [c.var.apiKeyHash, projectIds.join(',')], MASTER_TTL, bypass, () =>
        fetchStatusGroups(client, projectIds)
      )
      statusIds = resolveStatusIds(groups, statusNames, includeClosed)
      if (statusIds.length === 0) {
        return { issues: [], truncated: false, requestCount: client.requestCount, fetchedAt: new Date().toISOString() }
      }
    }

    const result = await fetchGanttIssues(
      client,
      {},
      { projectIds, assigneeIds, statusIds, from, to, keyword, includeNoDate }
    )

    return {
      issues: result.issues,
      truncated: result.truncated,
      requestCount: client.requestCount,
      fetchedAt: new Date().toISOString()
    }
  })

  return c.json(body)
})

/** Backlog のレート制限残量。 */
api.get('/rate-limit', async (c) => {
  const result = await c.var.client.get<unknown>('/rateLimit')
  return c.json(result)
})
