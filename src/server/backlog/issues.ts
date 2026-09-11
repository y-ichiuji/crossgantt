/**
 * 課題取得のオーケストレーション。
 *
 * Backlog の課題検索 API は日付条件を AND でしか組み合わせられないため、
 * 「表示期間に重なる課題」を漏れなく集めるには複数のクエリを投げて
 * 結果をマージする必要がある。その組み立てをここに集約する。
 */

import { parseBacklogDate } from '../../shared/date'
import { issueUrl } from '../../shared/space'
import type { GanttIssue } from '../../shared/types'
import { badRequest } from '../failure'
import { buildUrl } from '../fetcher'
import type { QueryParams } from '../fetcher'
import type { BacklogCountResponse, BacklogIssue } from './api-types'
import { BacklogApiError } from './client'
import type { BacklogClient, BacklogRequest } from './client'

/** 課題検索 1 リクエストあたりの最大取得件数（Backlog API の上限）。 */
export const PAGE_SIZE = 100

/** 1 クエリあたりのページ数上限。超えた分は打ち切り、UI で明示する。 */
export const MAX_PAGES_PER_QUERY = 25

/**
 * 1 本の URL に収める長さの上限。
 *
 * Apps Script の `UrlFetchApp` は 2KB を超える URL を受け付けない
 * （「上限を超えています: URLFetch URL の長さ」で失敗する）。
 * プロジェクト ID とステータス ID を並べるだけで簡単に届いてしまうため、
 * 収まる範囲でプロジェクトを分けて問い合わせる。
 */
export const MAX_URL_LENGTH = 2000

export type FetchIssuesParams = {
  projectIds: number[]
  assigneeIds: number[]
  statusIds: number[]
  /** yyyy-MM-dd */
  from: string
  /** yyyy-MM-dd */
  to: string
  keyword: string
  /** 日付が未設定の課題も取得するかどうか。 */
  includeNoDate: boolean
}

export type FetchIssuesResult = {
  issues: GanttIssue[]
  truncated: boolean
}

/** 1 種類の検索条件。 */
type IssueQuery = {
  params: QueryParams
  /** 日付条件なしのクエリ。日付が未設定の課題だけを採用する。 */
  noDateOnly: boolean
}

/** どのクエリの何ページ目かを覚えたページ取得要求。 */
type PagePlan = {
  requests: BacklogRequest[]
  /** `requests[i]` がどのクエリに属するか。 */
  owners: number[]
  truncated: boolean
}

/**
 * ステータスが「完了」を意味するかどうかの判定。
 *
 * Backlog API のステータスには完了フラグが無い。既定ステータスの
 * ID 1〜4 はスペース共通で 4 が「完了」であり、プロジェクト独自の
 * カスタムステータスには 5 以降が割り当てられる。ID だけに頼ると
 * 表記が異なる環境で誤判定しうるため、名称も併せて判定する。
 */
export function isClosedStatus(status: { id: number; name: string }): boolean {
  if (status.id === 4) {
    return true
  }
  const name = status.name.trim().toLowerCase()
  return name === '完了' || name === 'closed'
}

/** 表示期間に重なる課題を集めるための 3 種類のクエリ条件。 */
export function buildDateQueries(from: string, to: string): QueryParams[] {
  return [
    // 1. 開始日と期限日の両方を持つ課題のうち、表示期間と重なるもの。
    //    「startDate <= to かつ dueDate >= from」が区間の重なり条件そのものであり、
    //    表示期間をまたぐ長期課題もこれで拾える。
    { startDateUntil: to, dueDateSince: from },
    // 2. 期限日が表示期間内にある課題（開始日が未設定のものを拾う）。
    { dueDateSince: from, dueDateUntil: to },
    // 3. 開始日が表示期間内にある課題（期限日が未設定のものを拾う）。
    { startDateSince: from, startDateUntil: to }
  ]
}

/** プロジェクト以外の共通条件。プロジェクトは URL の長さに応じて分けるため含めない。 */
function baseParams(params: FetchIssuesParams, assigneeIds: number[], statusIds: number[]): QueryParams {
  return {
    'assigneeId[]': assigneeIds.length > 0 ? assigneeIds : undefined,
    'statusId[]': statusIds.length > 0 ? statusIds : undefined,
    keyword: params.keyword || undefined,
    sort: 'dueDate',
    order: 'asc'
  }
}

/**
 * 実際に投げる URL の長さ。
 *
 * ページ取得では `count` と `offset` が後から付くため、その分も見込む。
 */
function queryUrlLength(space: string, params: QueryParams): number {
  return buildUrl(`https://${space}/api/v2`, '/issues', { ...params, count: PAGE_SIZE, offset: 9999 }).length
}

/** このプロジェクトの組で URL が上限に収まるか。 */
function fitsUrl(space: string, base: QueryParams, dateQueries: QueryParams[], projectIds: number[]): boolean {
  return dateQueries.every(
    (dateQuery) => queryUrlLength(space, { ...base, 'projectId[]': projectIds, ...dateQuery }) <= MAX_URL_LENGTH
  )
}

/**
 * URL が上限に収まるよう、プロジェクト ID をいくつかの組に分ける。
 *
 * 分けた組ごとに同じ条件で問い合わせ、結果は課題 ID でマージする。
 */
function splitProjectIds(space: string, base: QueryParams, dateQueries: QueryParams[], projectIds: number[]) {
  const groups: number[][] = []
  let current: number[] = []

  for (const projectId of projectIds) {
    if (current.length > 0 && !fitsUrl(space, base, dateQueries, [...current, projectId])) {
      groups.push(current)
      current = [projectId]
      continue
    }
    current.push(projectId)
  }

  if (current.length > 0) {
    groups.push(current)
  }
  return groups
}

/**
 * 取得の計画。
 *
 * URL の上限に収めるため、条件の一部はサーバー側へ渡さず取得後に絞ることがある。
 */
type QueryPlan = {
  queries: IssueQuery[]
  /** 取得後に絞る担当者 ID。空なら Backlog 側で絞れている。 */
  localAssigneeIds: number[]
  /** 取得後に絞るステータス ID。空なら Backlog 側で絞れている。 */
  localStatusIds: number[]
}

/**
 * URL に収まらない条件を、サーバー側の絞り込みから外す。
 *
 * 課題の応答には担当者 ID とステータス ID が含まれるため、取得後に同じ条件で
 * 絞れば結果は変わらない。増えるのは取得量だけである。外す順は列挙が長い側から。
 * プロジェクトを 1 つに絞った状態を基準に判定する。
 */
function relaxFilters(
  space: string,
  params: FetchIssuesParams,
  dateQueries: QueryParams[]
): { assigneeIds: number[]; statusIds: number[]; local: Omit<QueryPlan, 'queries'> } {
  let assigneeIds = params.assigneeIds
  let statusIds = params.statusIds
  const local = { localAssigneeIds: [] as number[], localStatusIds: [] as number[] }
  const single = params.projectIds.slice(0, 1)

  while (!fitsUrl(space, baseParams(params, assigneeIds, statusIds), dateQueries, single)) {
    if (statusIds.length > 0 && statusIds.length >= assigneeIds.length) {
      local.localStatusIds = statusIds
      statusIds = []
      continue
    }
    if (assigneeIds.length > 0) {
      local.localAssigneeIds = assigneeIds
      assigneeIds = []
      continue
    }
    // 日付とキーワードだけになっても収まらない。キーワードが長すぎる場合。
    throw badRequest('絞り込み条件が長すぎて Backlog へ問い合わせられません', 'キーワードを短くしてください')
  }

  return { assigneeIds, statusIds, local }
}

/** 検索条件の一覧を組み立てる。 */
function planQueries(space: string, params: FetchIssuesParams): QueryPlan {
  const dateQueries = buildDateQueries(params.from, params.to)
  const { assigneeIds, statusIds, local } = relaxFilters(space, params, dateQueries)
  const base = baseParams(params, assigneeIds, statusIds)
  const queries: IssueQuery[] = []

  for (const projectIds of splitProjectIds(space, base, dateQueries, params.projectIds)) {
    const withProjects = { ...base, 'projectId[]': projectIds }
    for (const dateQuery of dateQueries) {
      queries.push({ params: { ...withProjects, ...dateQuery }, noDateOnly: false })
    }
    if (params.includeNoDate) {
      // 日付が null の課題を絞り込む条件は API に存在しないため、
      // 日付条件なしで取得してから両方の日付が空のものだけを残す。
      queries.push({ params: { ...withProjects }, noDateOnly: true })
    }
  }

  return { queries, ...local }
}

/** 件数の応答から、実際に投げるページ取得要求を組み立てる。 */
function planPages(queries: IssueQuery[], counts: BacklogCountResponse[]): PagePlan {
  const plan: PagePlan = { requests: [], owners: [], truncated: false }

  for (const [queryIndex, response] of counts.entries()) {
    const count = response.count
    // count が数値でないと Math.ceil / Math.min が NaN になり、ページ数が 0 と
    // 区別できないまま「0 件でした」として静かに握り潰されてしまう。
    // 想定外のレスポンスは失敗として扱い、利用者にも伝わるようにする。
    if (!Number.isFinite(count)) {
      throw new BacklogApiError(502, 'Backlog の課題件数レスポンスを解釈できませんでした')
    }
    if (count <= 0) {
      continue
    }

    const neededPages = Math.ceil(count / PAGE_SIZE)
    const pages = Math.min(neededPages, MAX_PAGES_PER_QUERY)
    if (neededPages > pages) {
      plan.truncated = true
    }
    for (let page = 0; page < pages; page += 1) {
      plan.requests.push({
        path: '/issues',
        params: { ...queries[queryIndex].params, count: PAGE_SIZE, offset: page * PAGE_SIZE }
      })
      plan.owners.push(queryIndex)
    }
  }

  return plan
}

/** Backlog の課題を描画用の形へ正規化する。 */
export function normalizeIssue(space: string, projectKeys: Record<number, string>, issue: BacklogIssue): GanttIssue {
  const projectKey = projectKeys[issue.projectId] ?? issue.issueKey.replace(/-\d+$/u, '')
  return {
    id: issue.id,
    issueKey: issue.issueKey,
    summary: issue.summary,
    url: issueUrl(space, issue.issueKey),
    projectId: issue.projectId,
    projectKey,
    assigneeId: issue.assignee?.id ?? null,
    assigneeName: issue.assignee?.name ?? null,
    statusId: issue.status.id,
    statusName: issue.status.name,
    statusColor: issue.status.color,
    isClosed: isClosedStatus(issue.status),
    startDate: parseBacklogDate(issue.startDate),
    dueDate: parseBacklogDate(issue.dueDate),
    estimatedHours: issue.estimatedHours ?? null,
    actualHours: issue.actualHours ?? null,
    parentIssueId: issue.parentIssueId ?? null,
    milestoneNames: (issue.milestone ?? []).map((version) => version.name)
  }
}

/** 取得後に絞る条件。URL に収まらず Backlog 側へ渡せなかったぶん。 */
type LocalFilters = {
  assignees: Set<number> | null
  statuses: Set<number> | null
}

/**
 * 取得した課題を採用するか。
 *
 * 正規化の前に判定することで、対象外の課題に対する日付パースと
 * オブジェクト生成を丸ごと省ける。
 */
function keepsIssue(raw: BacklogIssue, noDateOnly: boolean, local: LocalFilters): boolean {
  // 日付条件なしのクエリは全課題を返してしまうため、日付未設定のものだけを採用する。
  if (noDateOnly && (raw.startDate || raw.dueDate)) {
    return false
  }
  if (local.assignees && !local.assignees.has(raw.assignee?.id ?? -1)) {
    return false
  }
  if (local.statuses && !local.statuses.has(raw.status.id)) {
    return false
  }
  return true
}

/**
 * 表示期間に重なる課題（および任意で日付未設定の課題）をまとめて取得する。
 */
export function fetchGanttIssues(
  client: BacklogClient,
  projectKeys: Record<number, string>,
  params: FetchIssuesParams
): FetchIssuesResult {
  if (params.projectIds.length === 0) {
    return { issues: [], truncated: false }
  }

  const { queries, localAssigneeIds, localStatusIds } = planQueries(client.space, params)
  const counts = client.getMany<BacklogCountResponse>(
    queries.map((query) => ({ path: '/issues/count', params: query.params }))
  )
  const plan = planPages(queries, counts)
  const pages = client.getMany<BacklogIssue[]>(plan.requests)

  // URL に収まらず Backlog 側へ渡せなかった条件は、ここで同じ内容を適用する。
  const local: LocalFilters = {
    assignees: localAssigneeIds.length > 0 ? new Set(localAssigneeIds) : null,
    statuses: localStatusIds.length > 0 ? new Set(localStatusIds) : null
  }

  const byId = new Map<number, GanttIssue>()
  for (const [pageIndex, issues] of pages.entries()) {
    const { noDateOnly } = queries[plan.owners[pageIndex]]
    for (const raw of issues) {
      if (!byId.has(raw.id) && keepsIssue(raw, noDateOnly, local)) {
        byId.set(raw.id, normalizeIssue(client.space, projectKeys, raw))
      }
    }
  }

  return { issues: [...byId.values()], truncated: plan.truncated }
}
