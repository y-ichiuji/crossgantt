/**
 * Worker 上のプロキシ API を呼び出すクライアント。
 *
 * 認証は HttpOnly Cookie のセッションで行うため、
 * ブラウザ側でアクセストークンを保持することはない。
 */

import type {
  ApiErrorBody,
  IssuesQuery,
  IssuesResponse,
  MemberSummary,
  ProjectSummary,
  StatusGroup,
  Viewer
} from '../shared/types'

export class ApiError extends Error {
  readonly status: number
  readonly detail: string | undefined

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** 未ログイン、またはセッション切れ。 */
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin' })

  if (!response.ok) {
    let body: ApiErrorBody | null
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      body = null
    }
    throw new ApiError(response.status, body?.error ?? `リクエストに失敗しました (${response.status})`, body?.detail)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

/** 現在のセッション情報。未ログインなら ApiError(401) を投げる。 */
export async function getSession(signal?: AbortSignal): Promise<Viewer> {
  return request<Viewer>('/api/auth/session', { signal })
}

/** Backlog の認可画面へ遷移する。認可後は現在の URL に戻る。 */
export function startLogin(space: string): void {
  const params = new URLSearchParams({
    space,
    returnTo: `${window.location.pathname}${window.location.search}`
  })
  window.location.href = `/api/auth/login?${params.toString()}`
}

export async function logout(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' })
}

export async function getProjects(refresh: boolean, signal?: AbortSignal): Promise<ProjectSummary[]> {
  const query = refresh ? '?refresh=1' : ''
  return request<ProjectSummary[]>(`/api/projects${query}`, { signal })
}

export async function getMembers(
  projectIds: number[],
  refresh: boolean,
  signal?: AbortSignal
): Promise<MemberSummary[]> {
  const params = new URLSearchParams({ projectIds: projectIds.join(',') })
  if (refresh) {
    params.set('refresh', '1')
  }
  return request<MemberSummary[]>(`/api/members?${params.toString()}`, { signal })
}

export async function getStatuses(
  projectIds: number[],
  refresh: boolean,
  signal?: AbortSignal
): Promise<StatusGroup[]> {
  const params = new URLSearchParams({ projectIds: projectIds.join(',') })
  if (refresh) {
    params.set('refresh', '1')
  }
  return request<StatusGroup[]>(`/api/statuses?${params.toString()}`, { signal })
}

export async function getIssues(query: IssuesQuery, refresh: boolean, signal?: AbortSignal): Promise<IssuesResponse> {
  const params = new URLSearchParams({
    projectIds: query.projectIds.join(','),
    from: query.from,
    to: query.to
  })
  if (query.assigneeIds.length > 0) {
    params.set('assigneeIds', query.assigneeIds.join(','))
  }
  if (query.statusNames.length > 0) {
    params.set('statuses', query.statusNames.join(','))
  }
  if (query.keyword) {
    params.set('keyword', query.keyword)
  }
  if (query.includeClosed) {
    params.set('closed', '1')
  }
  if (query.includeNoDate) {
    params.set('nodate', '1')
  }
  if (refresh) {
    params.set('refresh', '1')
  }
  return request<IssuesResponse>(`/api/issues?${params.toString()}`, { signal })
}
