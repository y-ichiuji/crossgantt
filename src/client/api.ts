/**
 * Worker 上のプロキシ API を呼び出すクライアント。
 *
 * Backlog のスペースと API キーは毎回リクエストヘッダーで送る。
 * サーバー側には保存されない。
 */

import type {
  ApiErrorBody,
  IssuesResponse,
  MemberSummary,
  ProjectSummary,
  IssuesQuery,
  StatusGroup,
  Viewer
} from '../shared/types'

export type Connection = {
  space: string
  apiKey: string
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: string | undefined

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function authHeaders(connection: Connection): Record<string, string> {
  return {
    'X-Backlog-Space': connection.space,
    'X-Backlog-Api-Key': connection.apiKey
  }
}

async function request<T>(
  connection: Connection,
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {}
): Promise<T> {
  // HeadersInit は配列形式も取りうるため、オブジェクトのスプレッドで合成してはいけない。
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(authHeaders(connection))) {
    headers.set(key, value)
  }

  const response = await fetch(path, { ...init, headers })

  if (!response.ok) {
    let body: ApiErrorBody | null = null
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      body = null
    }
    throw new ApiError(response.status, body?.error ?? `リクエストに失敗しました (${response.status})`, body?.detail)
  }

  return (await response.json()) as T
}

/** 接続確認。API キーが有効なら接続ユーザー情報が返る。 */
export function connect(connection: Connection, signal?: AbortSignal): Promise<Viewer> {
  return request<Viewer>(connection, '/api/connect', { method: 'POST', signal })
}

export function getProjects(connection: Connection, refresh: boolean, signal?: AbortSignal): Promise<ProjectSummary[]> {
  const query = refresh ? '?refresh=1' : ''
  return request<ProjectSummary[]>(connection, `/api/projects${query}`, { signal })
}

export function getMembers(
  connection: Connection,
  projectIds: number[],
  refresh: boolean,
  signal?: AbortSignal
): Promise<MemberSummary[]> {
  const params = new URLSearchParams({ projectIds: projectIds.join(',') })
  if (refresh) {
    params.set('refresh', '1')
  }
  return request<MemberSummary[]>(connection, `/api/members?${params}`, { signal })
}

export function getStatuses(
  connection: Connection,
  projectIds: number[],
  refresh: boolean,
  signal?: AbortSignal
): Promise<StatusGroup[]> {
  const params = new URLSearchParams({ projectIds: projectIds.join(',') })
  if (refresh) {
    params.set('refresh', '1')
  }
  return request<StatusGroup[]>(connection, `/api/statuses?${params}`, { signal })
}

export function getIssues(
  connection: Connection,
  filter: IssuesQuery,
  refresh: boolean,
  signal?: AbortSignal
): Promise<IssuesResponse> {
  const params = new URLSearchParams({
    projectIds: filter.projectIds.join(','),
    from: filter.from,
    to: filter.to
  })
  if (filter.assigneeIds.length > 0) {
    params.set('assigneeIds', filter.assigneeIds.join(','))
  }
  if (filter.statusNames.length > 0) {
    params.set('statuses', filter.statusNames.join(','))
  }
  if (filter.keyword) {
    params.set('keyword', filter.keyword)
  }
  if (filter.includeClosed) {
    params.set('closed', '1')
  }
  if (filter.includeNoDate) {
    params.set('nodate', '1')
  }
  if (refresh) {
    params.set('refresh', '1')
  }
  return request<IssuesResponse>(connection, `/api/issues?${params}`, { signal })
}
