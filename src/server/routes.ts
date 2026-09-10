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

import { diffDays, isDateKey } from '../shared/date'
import { MAX_RANGE_DAYS, parseBool, parseIdList, parseNameList } from '../shared/filter'
import type { ApiErrorBody, IssuesResponse, ProjectSummary, StatusGroup } from '../shared/types'
import { type AppBindings, resolveOAuthConfig } from './auth/config'
import { needsRefresh, OAuthError, refreshTokens } from './auth/oauth'
import { getSession, putSession, readCookie, SESSION_COOKIE } from './auth/session'
import { BacklogApiError, BacklogClient } from './backlog/client'
import { fetchGanttIssues } from './backlog/issues'
import { fetchMembers, fetchProjects, fetchStatusGroups, resolveStatusIds } from './backlog/masters'
import { hashKey, matchCachedResponse, putCachedResponse, withJsonCache } from './cache'

export type ApiEnv = {
  Bindings: AppBindings
  Variables: {
    client: BacklogClient
    /** キャッシュをユーザーごとに分けるためのキー。 */
    scopeHash: string
  }
}

/** マスタ情報のキャッシュ秒数。頻繁には変わらないため長めに取る。 */
const MASTER_TTL = 300

/** 課題のキャッシュ秒数。連打による Search 区分の消費を抑える。 */
const ISSUES_TTL = 60

export const api = new Hono<ApiEnv>()

api.use('*', async (c, next) => {
  // 認証情報を含むレスポンスなので、経路上のどこにもキャッシュさせない。
  c.header('Cache-Control', 'no-store')

  const sessionId = readCookie(c.req.header('Cookie'), SESSION_COOKIE)
  if (!sessionId) {
    return c.json<ApiErrorBody>({ error: 'ログインしていません' }, 401)
  }

  const session = await getSession(c.env.SESSIONS, sessionId)
  if (!session) {
    return c.json<ApiErrorBody>({ error: 'セッションの有効期限が切れています' }, 401)
  }

  let accessToken = session.accessToken
  const now = Date.now()

  // 期限が近いアクセストークンはここで更新しておく。
  // リクエストの途中で切れて 401 になるのを防ぐため、少し前倒しで更新する。
  if (needsRefresh(session.expiresAt, now)) {
    const config = resolveOAuthConfig(c.env, c.req.url)
    if (!config) {
      return c.json<ApiErrorBody>({ error: 'OAuth の設定が未完了です' }, 500)
    }
    try {
      const tokens = await refreshTokens(session.space, config, session.refreshToken, now)
      accessToken = tokens.accessToken
      await putSession(c.env.SESSIONS, sessionId, {
        ...session,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt
      })
    } catch (error: unknown) {
      if (error instanceof OAuthError) {
        // 画面表示では複数の API を同時に呼ぶため、同じリフレッシュトークンで
        // 並行して更新を試みることがある。Backlog はリフレッシュトークンを
        // ローテーションするので、先着以外はここで必ず失敗する。
        // 失敗を即ログアウト扱いにすると正常なセッションが切れてしまうため、
        // 他のリクエストが更新を終えていないか保存済みの内容を読み直す。
        const latest = await getSession(c.env.SESSIONS, sessionId)
        if (!latest || needsRefresh(latest.expiresAt, Date.now())) {
          return c.json<ApiErrorBody>({ error: '認証の更新に失敗しました。ログインし直してください' }, 401)
        }
        accessToken = latest.accessToken
      } else {
        throw error
      }
    }
  }

  c.set('client', new BacklogClient({ space: session.space, accessToken }))
  // アクセストークンは更新のたびに変わるため、キャッシュキーにはスペースとユーザー ID を使う。
  c.set('scopeHash', await hashKey(session.space, String(session.userId)))
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

/** 参加中のプロジェクト一覧をキャッシュ経由で取得する。 */
function cachedProjects(scopeHash: string, client: BacklogClient, bypass: boolean): Promise<ProjectSummary[]> {
  return withJsonCache('projects', [scopeHash], MASTER_TTL, bypass, () => fetchProjects(client))
}

/** ステータス一覧をキャッシュ経由で取得する。キーの定義を 1 か所に保つため関数にしている。 */
function cachedStatusGroups(
  scopeHash: string,
  client: BacklogClient,
  projectIds: number[],
  bypass: boolean
): Promise<StatusGroup[]> {
  return withJsonCache('statuses', [scopeHash, projectIds.join(',')], MASTER_TTL, bypass, () =>
    fetchStatusGroups(client, projectIds)
  )
}

/**
 * 要求されたプロジェクト ID を、実際に参加しているものだけに絞る。
 *
 * ID は URL 由来なので、共有リンクに含まれる他人のプロジェクト、別スペースの ID、
 * 退会済み・削除済みのプロジェクトが混ざりうる。そのまま Backlog へ投げると
 * プロジェクトごとの取得（`mapWithConcurrency` の `Promise.all`）が 1 件の 404 で
 * 総崩れになり、参照できるプロジェクトの結果まで失われる。
 * ここで絞ることで 1 リクエストあたりのサブリクエスト数も参加数以下に収まる。
 */
async function accessibleProjects(
  scopeHash: string,
  client: BacklogClient,
  requested: number[],
  bypass: boolean
): Promise<ProjectSummary[]> {
  if (requested.length === 0) {
    return []
  }
  const projects = await cachedProjects(scopeHash, client, bypass)
  const requestedIds = new Set(requested)
  return projects.filter((project) => requestedIds.has(project.id))
}

/** 参加中のプロジェクト一覧。 */
api.get('/projects', async (c) => {
  const bypass = parseBool(c.req.query('refresh'), false)
  return c.json(await cachedProjects(c.var.scopeHash, c.var.client, bypass))
})

/** 指定プロジェクト群の担当者候補。 */
api.get('/members', async (c) => {
  const bypass = parseBool(c.req.query('refresh'), false)
  const projects = await accessibleProjects(
    c.var.scopeHash,
    c.var.client,
    parseIdList(c.req.query('projectIds')),
    bypass
  )
  const projectIds = projects.map((project) => project.id)
  const members = await withJsonCache('members', [c.var.scopeHash, projectIds.join(',')], MASTER_TTL, bypass, () =>
    fetchMembers(c.var.client, projectIds)
  )
  return c.json(members)
})

/** 指定プロジェクト群のステータス（名前で統合済み）。 */
api.get('/statuses', async (c) => {
  const bypass = parseBool(c.req.query('refresh'), false)
  const projects = await accessibleProjects(
    c.var.scopeHash,
    c.var.client,
    parseIdList(c.req.query('projectIds')),
    bypass
  )
  const statuses = await cachedStatusGroups(
    c.var.scopeHash,
    c.var.client,
    projects.map((project) => project.id),
    bypass
  )
  return c.json(statuses)
})

/** 課題の取得。ページングとクエリのマージはここで完結させる。 */
api.get('/issues', async (c) => {
  const requestedProjectIds = parseIdList(c.req.query('projectIds'))
  const assigneeIds = parseIdList(c.req.query('assigneeIds'))
  const statusNames = parseNameList(c.req.query('statuses'))
  const keyword = c.req.query('keyword')?.trim() ?? ''
  const includeClosed = parseBool(c.req.query('closed'), false)
  const includeNoDate = parseBool(c.req.query('nodate'), false)
  const from = c.req.query('from') ?? ''
  const to = c.req.query('to') ?? ''
  const bypass = parseBool(c.req.query('refresh'), false)

  if (requestedProjectIds.length === 0) {
    return c.json<ApiErrorBody>({ error: 'プロジェクトを 1 つ以上選択してください' }, 400)
  }
  if (!isDateKey(from) || !isDateKey(to)) {
    return c.json<ApiErrorBody>({ error: '表示期間の指定が正しくありません' }, 400)
  }
  if (from > to) {
    return c.json<ApiErrorBody>({ error: '表示期間の開始日が終了日より後になっています' }, 400)
  }
  // 期間に上限が無いと、1 本の URL で数百万日分の描画とページングを要求できてしまう。
  if (diffDays(from, to) + 1 > MAX_RANGE_DAYS) {
    return c.json<ApiErrorBody>({ error: `表示期間が長すぎます（最大 ${MAX_RANGE_DAYS} 日）` }, 400)
  }

  const projects = await accessibleProjects(c.var.scopeHash, c.var.client, requestedProjectIds, bypass)
  if (projects.length === 0) {
    return c.json<ApiErrorBody>({ error: '選択されたプロジェクトを参照できません' }, 403)
  }
  const projectIds = projects.map((project) => project.id)

  const cacheKeyParts = [
    c.var.scopeHash,
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
      const groups = await cachedStatusGroups(c.var.scopeHash, client, projectIds, bypass)
      statusIds = resolveStatusIds(groups, statusNames, includeClosed)
      if (statusIds.length === 0) {
        return { issues: [], truncated: false, requestCount: client.requestCount, fetchedAt: new Date().toISOString() }
      }
    }

    // プロジェクトキーは取得済みの一覧から渡す。渡さないと課題キーの
    // 文字列加工に頼ることになり、キーの命名規則が変わると静かに壊れる。
    const projectKeys = Object.fromEntries(projects.map((project) => [project.id, project.projectKey]))
    const result = await fetchGanttIssues(client, projectKeys, {
      projectIds,
      assigneeIds,
      statusIds,
      from,
      to,
      keyword,
      includeNoDate
    })

    return {
      issues: result.issues,
      truncated: result.truncated,
      requestCount: client.requestCount,
      fetchedAt: new Date().toISOString()
    }
  })

  return c.json(body)
})

/** アバター画像のキャッシュ秒数。ユーザーのアイコンは頻繁には変わらない。 */
const ICON_TTL = 3600

/**
 * 担当者のアイコン画像を中継する。
 *
 * Backlog のアイコン取得はアクセストークンを要するため、`<img src>` から
 * 直接は叩けない。ここで中継し、ブラウザと Worker の両方でキャッシュする。
 * アイコンはレート制限の Icon 区分に属し、上限が低いためキャッシュが重要。
 */
api.get('/users/:userId/icon', async (c) => {
  const userId = Number.parseInt(c.req.param('userId'), 10)
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return c.json<ApiErrorBody>({ error: 'ユーザー ID が正しくありません' }, 400)
  }

  const client = c.var.client
  const cacheKey = await hashKey('icon', c.var.scopeHash, String(userId))
  const cached = await matchCachedResponse(cacheKey)
  if (cached) {
    return cached
  }

  const upstream = await client.getBinary(`/users/${userId}/icon`)
  const body = await upstream.arrayBuffer()
  const response = new Response(body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/png',
      // セッションに紐づくため共有キャッシュには載せない。
      'Cache-Control': `private, max-age=${ICON_TTL}`
    }
  })
  await putCachedResponse(cacheKey, response.clone(), ICON_TTL)
  return response
})

/** Backlog のレート制限残量。 */
api.get('/rate-limit', async (c) => {
  const result = await c.var.client.get<unknown>('/rateLimit')
  return c.json(result)
})
