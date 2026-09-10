/**
 * 課題取得のオーケストレーション。
 *
 * Backlog の課題検索 API は日付条件を AND でしか組み合わせられないため、
 * 「表示期間に重なる課題」を漏れなく集めるには複数のクエリを投げて
 * 結果をマージする必要がある。その組み立てをここに集約する。
 */

import { parseBacklogDate } from '../../shared/date'
import type { GanttIssue } from '../../shared/types'
import type { BacklogCountResponse, BacklogIssue } from './api-types'
import { BacklogApiError, mapWithConcurrency } from './client'
import type { BacklogClient, QueryParams } from './client'
import { issueUrl } from './space'

/** 課題検索 1 リクエストあたりの最大取得件数（Backlog API の上限）。 */
export const PAGE_SIZE = 100

/** 1 クエリあたりのページ数上限。超えた分は打ち切り、UI で明示する。 */
export const MAX_PAGES_PER_QUERY = 25

/** 課題取得の並列度。Search 区分のレート制限を使い切らないよう抑えている。 */
export const FETCH_CONCURRENCY = 5

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

function baseParams(params: FetchIssuesParams): QueryParams {
  return {
    'projectId[]': params.projectIds,
    'assigneeId[]': params.assigneeIds.length > 0 ? params.assigneeIds : undefined,
    'statusId[]': params.statusIds.length > 0 ? params.statusIds : undefined,
    keyword: params.keyword || undefined,
    sort: 'dueDate',
    order: 'asc'
  }
}

/** 1 つのクエリ条件について、件数取得 → ページ並列取得を行う。 */
async function fetchQuery(
  client: BacklogClient,
  params: QueryParams
): Promise<{ issues: BacklogIssue[]; truncated: boolean }> {
  const { count } = await client.get<BacklogCountResponse>('/issues/count', params)
  // count が数値でないと Math.ceil / Math.min が NaN になり、Array.from({length: NaN})
  // が空配列を返すため「0 件でした」と区別が付かないまま静かに握り潰されてしまう。
  // 想定外のレスポンスは失敗として扱い、利用者にも伝わるようにする。
  if (!Number.isFinite(count)) {
    throw new BacklogApiError(502, 'Backlog の課題件数レスポンスを解釈できませんでした')
  }
  if (count <= 0) {
    return { issues: [], truncated: false }
  }

  const neededPages = Math.ceil(count / PAGE_SIZE)
  const pages = Math.min(neededPages, MAX_PAGES_PER_QUERY)
  const offsets = Array.from({ length: pages }, (_, index) => index * PAGE_SIZE)

  const chunks = await mapWithConcurrency(offsets, FETCH_CONCURRENCY, (offset) =>
    client.get<BacklogIssue[]>('/issues', { ...params, count: PAGE_SIZE, offset })
  )

  return { issues: chunks.flat(), truncated: neededPages > pages }
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

/**
 * 表示期間に重なる課題（および任意で日付未設定の課題）をまとめて取得する。
 */
export async function fetchGanttIssues(
  client: BacklogClient,
  projectKeys: Record<number, string>,
  params: FetchIssuesParams
): Promise<FetchIssuesResult> {
  if (params.projectIds.length === 0) {
    return { issues: [], truncated: false }
  }

  const base = baseParams(params)
  const queries: { params: QueryParams; noDateOnly: boolean }[] = buildDateQueries(params.from, params.to).map(
    (dateQuery) => ({ params: { ...base, ...dateQuery }, noDateOnly: false })
  )

  if (params.includeNoDate) {
    // 日付が null の課題を絞り込む条件は API に存在しないため、
    // 日付条件なしで取得してから両方の日付が空のものだけを残す。
    queries.push({ params: { ...base }, noDateOnly: true })
  }

  const results = await mapWithConcurrency(queries, 2, async (query) => ({
    ...(await fetchQuery(client, query.params)),
    noDateOnly: query.noDateOnly
  }))

  const byId = new Map<number, GanttIssue>()
  let truncated = false
  for (const result of results) {
    if (result.truncated) {
      truncated = true
    }
    for (const raw of result.issues) {
      if (byId.has(raw.id)) {
        continue
      }
      // 日付条件なしのクエリは全課題を返してしまうため、日付未設定のものだけを採用する。
      // 正規化の前に捨てることで、大半を占める対象外の課題に対する
      // 日付パースとオブジェクト生成を丸ごと省ける。
      if (result.noDateOnly && (raw.startDate || raw.dueDate)) {
        continue
      }
      byId.set(raw.id, normalizeIssue(client.space, projectKeys, raw))
    }
  }

  return { issues: [...byId.values()], truncated }
}
