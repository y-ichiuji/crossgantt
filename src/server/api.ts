/**
 * クライアントから呼ばれる API の本体。
 *
 * ブラウザから Backlog API を直接呼ばず、必ずここを経由させる。
 * 理由は次の 3 点。
 * 1. Backlog API はブラウザからのクロスオリジン呼び出しを想定していない
 * 2. ページングやクエリのマージをサーバー側で完結させ、往復回数を減らせる
 * 3. レート制限対策のキャッシュを一元管理できる
 *
 * Apps Script では `google.script.run` から呼ばれる。例外はクライアントへ
 * そのままの形で届かないため、必ず成否を包んだ `ApiEnvelope` を返す。
 */

import { diffDays, isDateKey } from '../shared/date'
import { MAX_RANGE_DAYS, parseBool, parseIdList, parseNameList } from '../shared/filter'
import type {
  ApiEnvelope,
  Holiday,
  IssuesResponse,
  MemberSummary,
  ProjectSummary,
  StatusGroup,
  Viewer
} from '../shared/types'
import { needsRefresh, OAuthError, refreshTokens } from './auth/oauth'
import type { OAuthConfig } from './auth/oauth'
import { clearSession, readSession, writeSession } from './auth/session'
import type { SessionRecord, UserStore } from './auth/session'
import type { BacklogStatus, BacklogUser } from './backlog/api-types'
import { BacklogApiError, BacklogClient, DEFAULT_BATCH_SIZE } from './backlog/client'
import { fetchGanttIssues } from './backlog/issues'
import {
  fetchProjectMembers,
  fetchProjects,
  fetchProjectStatuses,
  groupStatuses,
  mergeMembers,
  resolveStatusIds
} from './backlog/masters'
import type { JsonCache } from './cache'
import { ApiFailure, badRequest, unauthorized } from './failure'
import type { Fetcher, Sleeper } from './fetcher'
import { fetchHolidays } from './holidays'

/**
 * マスタ情報のキャッシュ秒数。
 *
 * プロジェクト・担当者・ステータスは頻繁には変わらない。選択するプロジェクト数に
 * 比例してリクエストが飛ぶため、長めに持ってレート制限への当たりを減らす。
 * 最新にしたいときは「再読込」がキャッシュを無視する。
 */
const MASTER_TTL = 30 * 60

/** 課題のキャッシュ秒数。絞り込みの試行で Search 区分を使い切らないよう持つ。 */
const ISSUES_TTL = 3 * 60

/**
 * アイコン画像のキャッシュ秒数。
 *
 * ユーザーのアイコンは頻繁には変わらないため、CacheService の上限
 * （6 時間）まで持つ。アイコンはレート制限の Icon 区分に属し、
 * 上限が低いためキャッシュが重要。
 */
const ICON_TTL = 6 * 60 * 60

/** 1 回の呼び出しで取りに行くアイコンの上限。 */
const MAX_ICONS_PER_CALL = 60

/**
 * API ハンドラが受け取るパラメータ。
 *
 * クエリ文字列と同じく、値は文字列だけで表す。ID の一覧やフラグの解釈を
 * `shared/filter.ts` と共有でき、クライアントが省略した項目は単に
 * 未設定として扱えるため。
 */
export type ApiParams = Record<string, string | undefined>

export type ApiContext = {
  now: () => number
  /** 利用者ごとの永続領域。セッションと nonce を置く。 */
  store: UserStore
  /** 利用者ごとの短時間キャッシュ。 */
  cache: JsonCache
  /** 利用者に依存しない短時間キャッシュ。 */
  sharedCache: JsonCache
  fetcher: Fetcher
  sleep: Sleeper
  oauth: OAuthConfig | null
  /** トークン更新のような、同時に走ると壊れる処理を直列化する。 */
  withLock: <T>(produce: () => T) => T
  log: (message: string, error?: unknown) => void
}

/** 認証済みの呼び出しで使う道具立て。 */
type Authed = {
  session: SessionRecord
  client: BacklogClient
  /** キャッシュを Backlog のスペース・アカウント単位で分けるためのキー。 */
  scope: string
}

/**
 * 期限が近いアクセストークンを更新する。
 *
 * Backlog はリフレッシュトークンをローテーションするため、同じトークンで
 * 並行して更新を試みると先着以外が必ず失敗する。画面表示では複数の API を
 * 同時に呼ぶので、更新はロックで直列化し、ロックを取ってから保存済みの
 * 内容を読み直す。
 */
function renewAccessToken(ctx: ApiContext, session: SessionRecord): string {
  return ctx.withLock(() => {
    const now = ctx.now()
    const latest = readSession(ctx.store, now) ?? session
    if (!needsRefresh(latest.expiresAt, now)) {
      return latest.accessToken
    }
    if (!ctx.oauth) {
      throw new ApiFailure(500, 'OAuth の設定が未完了です')
    }
    try {
      const tokens = refreshTokens(latest.space, ctx.oauth, latest.refreshToken, now, ctx.fetcher)
      writeSession(
        ctx.store,
        {
          ...latest,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt
        },
        now
      )
      return tokens.accessToken
    } catch (error: unknown) {
      if (error instanceof OAuthError) {
        // リフレッシュトークンまで失効している。作り直すしかない。
        clearSession(ctx.store)
        throw unauthorized('認証の更新に失敗しました。ログインし直してください')
      }
      throw error
    }
  })
}

/** セッションを読み、Backlog クライアントを用意する。未ログインなら 401。 */
function authenticate(ctx: ApiContext): Authed {
  const session = readSession(ctx.store, ctx.now())
  if (!session) {
    throw unauthorized('ログインしていません')
  }

  const accessToken = needsRefresh(session.expiresAt, ctx.now()) ? renewAccessToken(ctx, session) : session.accessToken

  return {
    session,
    client: new BacklogClient({
      space: session.space,
      accessToken,
      fetcher: ctx.fetcher,
      sleep: ctx.sleep,
      now: ctx.now
    }),
    // アクセストークンは更新のたびに変わるため、キャッシュキーにはスペースとユーザー ID を使う。
    scope: ctx.cache.hashKey(session.space, String(session.userId))
  }
}

/** 参加中のプロジェクト一覧をキャッシュ経由で取得する。 */
function cachedProjects(ctx: ApiContext, authed: Authed, bypass: boolean): ProjectSummary[] {
  return ctx.cache.withJson('projects', [authed.scope], MASTER_TTL, bypass, () => fetchProjects(authed.client))
}

/**
 * プロジェクト単位でキャッシュしてマスタ情報を集める。
 *
 * 選択したプロジェクトの組を 1 つのキーにすると、選択を 1 つ変えるだけで
 * すべて取り直すことになる。プロジェクトごとに覚えておけば、増えたぶんだけを
 * 取りに行けば済む。プロジェクトを数十個選ぶ使い方では、この差が
 * そのままレート制限への当たりになる。
 *
 * @param fetchMissing キャッシュに無いプロジェクトだけを渡される。返り値は引数と同じ並び。
 */
function cachedPerProject<T>(
  ctx: ApiContext,
  namespace: string,
  scope: string,
  projectIds: number[],
  bypass: boolean,
  fetchMissing: (ids: number[]) => T[][]
): T[][] {
  const found = new Map<number, T[]>()
  const missing: number[] = []

  for (const projectId of projectIds) {
    const raw = bypass ? null : ctx.cache.readText(namespace, [scope, String(projectId)])
    if (raw === null) {
      missing.push(projectId)
      continue
    }
    try {
      found.set(projectId, JSON.parse(raw) as T[])
    } catch {
      missing.push(projectId)
    }
  }

  if (missing.length > 0) {
    for (const [index, list] of fetchMissing(missing).entries()) {
      const projectId = missing[index]
      found.set(projectId, list)
      ctx.cache.writeText(namespace, [scope, String(projectId)], JSON.stringify(list), MASTER_TTL)
    }
  }

  return projectIds.map((projectId) => found.get(projectId) ?? [])
}

/** ステータス一覧をキャッシュ経由で取得する。キーの定義を 1 か所に保つため関数にしている。 */
function cachedStatusGroups(ctx: ApiContext, authed: Authed, projectIds: number[], bypass: boolean): StatusGroup[] {
  const lists = cachedPerProject<BacklogStatus>(ctx, 'statuses', authed.scope, projectIds, bypass, (ids) =>
    fetchProjectStatuses(authed.client, ids)
  )
  return groupStatuses(lists.flat())
}

/**
 * 要求されたプロジェクト ID を、実際に参加しているものだけに絞る。
 *
 * ID は共有 URL 由来なので、他人のプロジェクト、別スペースの ID、
 * 退会済み・削除済みのプロジェクトが混ざりうる。そのまま Backlog へ投げると
 * プロジェクトごとの取得が 1 件の 404 で総崩れになり、参照できる
 * プロジェクトの結果まで失われる。
 */
function accessibleProjects(ctx: ApiContext, authed: Authed, requested: number[], bypass: boolean): ProjectSummary[] {
  if (requested.length === 0) {
    return []
  }
  const requestedIds = new Set(requested)
  return cachedProjects(ctx, authed, bypass).filter((project) => requestedIds.has(project.id))
}

/** 表示期間の指定を検証する。 */
function requireRange(params: ApiParams): { from: string; to: string } {
  const from = params.from ?? ''
  const to = params.to ?? ''
  if (!isDateKey(from) || !isDateKey(to)) {
    throw badRequest('表示期間の指定が正しくありません')
  }
  if (from > to) {
    throw badRequest('表示期間の開始日が終了日より後になっています')
  }
  // 期間に上限が無いと、1 本の URL で数百万日分の描画とページングを要求できてしまう。
  if (diffDays(from, to) + 1 > MAX_RANGE_DAYS) {
    throw badRequest(`表示期間が長すぎます（最大 ${MAX_RANGE_DAYS} 日）`)
  }
  return { from, to }
}

/** 現在のセッション情報。未ログインなら 401。 */
function handleSession(ctx: ApiContext): Viewer {
  const session = readSession(ctx.store, ctx.now())
  if (!session) {
    throw unauthorized('ログインしていません')
  }
  return {
    id: session.userId,
    userId: null,
    name: session.userName,
    space: session.space
  }
}

/**
 * 表示期間内の日本の祝日。
 *
 * 利用者に依存しない情報なので、キャッシュもスペース単位では分けない。
 * ログインの有無にも依存しないため、セッションを要求しない。
 */
function handleHolidays(ctx: ApiContext, params: ApiParams): Holiday[] {
  const { from, to } = requireRange(params)
  return fetchHolidays(from, to, { fetcher: ctx.fetcher, cache: ctx.sharedCache, now: ctx.now() })
}

/** 指定プロジェクト群の担当者候補。 */
function handleMembers(ctx: ApiContext, params: ApiParams): MemberSummary[] {
  const authed = authenticate(ctx)
  const bypass = parseBool(params.refresh, false)
  const projects = accessibleProjects(ctx, authed, parseIdList(params.projectIds), bypass)
  const lists = cachedPerProject<BacklogUser>(
    ctx,
    'members',
    authed.scope,
    projects.map((project) => project.id),
    bypass,
    (ids) => fetchProjectMembers(authed.client, ids)
  )
  return mergeMembers(lists)
}

/** 課題取得の本体。ページングとクエリのマージはここで完結させる。 */
function handleIssues(ctx: ApiContext, params: ApiParams): IssuesResponse {
  const authed = authenticate(ctx)
  const requestedProjectIds = parseIdList(params.projectIds)
  if (requestedProjectIds.length === 0) {
    throw badRequest('プロジェクトを 1 つ以上選択してください')
  }
  const { from, to } = requireRange(params)

  const assigneeIds = parseIdList(params.assigneeIds)
  const statusNames = parseNameList(params.statuses)
  const keyword = params.keyword?.trim() ?? ''
  const includeClosed = parseBool(params.closed, false)
  const includeNoDate = parseBool(params.nodate, false)
  const bypass = parseBool(params.refresh, false)

  const projects = accessibleProjects(ctx, authed, requestedProjectIds, bypass)
  if (projects.length === 0) {
    throw new ApiFailure(403, '選択されたプロジェクトを参照できません')
  }
  const projectIds = projects.map((project) => project.id)

  const cacheKeyParts = [
    authed.scope,
    projectIds.join(','),
    assigneeIds.join(','),
    statusNames.join(','),
    from,
    to,
    keyword,
    includeClosed ? '1' : '0',
    includeNoDate ? '1' : '0'
  ]

  return ctx.cache.withJson<IssuesResponse>('issues', cacheKeyParts, ISSUES_TTL, bypass, () => {
    const client = authed.client

    // ステータス条件が不要な場合（完了も含めて全件対象）は、
    // ステータス一覧の取得そのものを省いてリクエスト数を減らす。
    let statusIds: number[] = []
    if (!includeClosed || statusNames.length > 0) {
      const groups = cachedStatusGroups(ctx, authed, projectIds, bypass)
      statusIds = resolveStatusIds(groups, statusNames, includeClosed)
      if (statusIds.length === 0) {
        return {
          issues: [],
          truncated: false,
          requestCount: client.requestCount,
          fetchedAt: new Date(ctx.now()).toISOString()
        }
      }
    }

    // プロジェクトキーは取得済みの一覧から渡す。渡さないと課題キーの
    // 文字列加工に頼ることになり、キーの命名規則が変わると静かに壊れる。
    const projectKeys = Object.fromEntries(projects.map((project) => [project.id, project.projectKey]))
    const result = fetchGanttIssues(client, projectKeys, {
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
      fetchedAt: new Date(ctx.now()).toISOString()
    }
  })
}

/**
 * 担当者のアイコンを Base64 の data URL として返す。
 *
 * Backlog のアイコン取得はアクセストークンを要するため `<img src>` から
 * 直接は叩けない。Apps Script の Web アプリには画像を返せる URL が無いので、
 * まとめて取得して data URL でクライアントへ渡す。
 *
 * 取得できなかったアイコンは単に欠けた状態で返す。頭文字だけの表示に
 * 落ちるだけで、画面としては成立する。
 */
function handleIcons(ctx: ApiContext, params: ApiParams): Record<string, string> {
  const authed = authenticate(ctx)
  const userIds = parseIdList(params.userIds).slice(0, MAX_ICONS_PER_CALL)

  const icons: Record<string, string> = {}
  const missing: number[] = []
  for (const userId of userIds) {
    const cached = ctx.cache.readText('icon', [authed.scope, String(userId)])
    if (cached === null) {
      missing.push(userId)
    } else {
      icons[userId] = cached
    }
  }

  for (let index = 0; index < missing.length; index += DEFAULT_BATCH_SIZE) {
    const batch = missing.slice(index, index + DEFAULT_BATCH_SIZE)
    try {
      const contents = authed.client.getBinaryMany(batch.map((userId) => ({ path: `/users/${userId}/icon` })))
      for (const [offset, content] of contents.entries()) {
        const userId = batch[offset]
        const dataUrl = `data:${content.contentType};base64,${content.base64}`
        ctx.cache.writeText('icon', [authed.scope, String(userId)], dataUrl, ICON_TTL)
        icons[userId] = dataUrl
      }
    } catch (error: unknown) {
      // 退会済みユーザーなどで 404 になる。まとめて投げている分だけ諦める。
      ctx.log('アイコンの取得に失敗しました', error)
    }
  }

  return icons
}

type ApiHandler = (ctx: ApiContext, params: ApiParams) => unknown

/** 名前ごとのハンドラ。 */
const HANDLERS = new Map<string, ApiHandler>([
  ['session', (ctx) => handleSession(ctx)],
  [
    'logout',
    (ctx) => {
      clearSession(ctx.store)
      return null
    }
  ],
  ['holidays', handleHolidays],
  ['projects', (ctx, params) => cachedProjects(ctx, authenticate(ctx), parseBool(params.refresh, false))],
  ['members', handleMembers],
  [
    'statuses',
    (ctx, params) => {
      const authed = authenticate(ctx)
      const bypass = parseBool(params.refresh, false)
      const projects = accessibleProjects(ctx, authed, parseIdList(params.projectIds), bypass)
      return cachedStatusGroups(
        ctx,
        authed,
        projects.map((project) => project.id),
        bypass
      )
    }
  ],
  ['issues', handleIssues],
  ['icons', handleIcons],
  ['rateLimit', (ctx) => authenticate(ctx).client.get<unknown>('/rateLimit')]
])

/** 失敗を利用者へ返す形へ畳む。 */
function toFailure(ctx: ApiContext, error: unknown): ApiEnvelope {
  if (error instanceof ApiFailure) {
    return { ok: false, status: error.status, error: error.message, detail: error.detail ?? null }
  }
  if (error instanceof BacklogApiError) {
    const status = error.status >= 400 && error.status < 600 ? error.status : 502
    return { ok: false, status, error: error.message, detail: error.detail ?? null }
  }
  if (error instanceof OAuthError) {
    return { ok: false, status: error.status, error: error.message, detail: null }
  }
  ctx.log('予期しない API エラー', error)
  return { ok: false, status: 500, error: '予期しないエラーが発生しました', detail: null }
}

/** クライアントからの 1 回の呼び出しを処理する。 */
export function handleApiCall(ctx: ApiContext, name: string, params: ApiParams): ApiEnvelope {
  const handler = HANDLERS.get(name)
  if (!handler) {
    return { ok: false, status: 404, error: '存在しない API です', detail: name }
  }
  try {
    return { ok: true, data: handler(ctx, params) }
  } catch (error: unknown) {
    return toFailure(ctx, error)
  }
}
