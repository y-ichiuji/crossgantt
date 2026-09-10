/**
 * Backlog API v2 のレスポンス型（本アプリで使用する項目のみ）。
 *
 * 実際のレスポンスにはこれ以外にも多数の項目が含まれるが、
 * 使わないものは意図的に定義していない。
 */

export type BacklogUser = {
  id: number
  userId: string | null
  name: string
  mailAddress?: string | null
}

export type BacklogProject = {
  id: number
  projectKey: string
  name: string
  archived: boolean
}

export type BacklogStatus = {
  id: number
  projectId: number
  name: string
  color: string
  displayOrder: number
}

export type BacklogVersion = {
  id: number
  projectId: number
  name: string
  startDate: string | null
  releaseDueDate: string | null
  archived: boolean
}

export type BacklogIssue = {
  id: number
  projectId: number
  issueKey: string
  summary: string
  status: BacklogStatus
  assignee: BacklogUser | null
  startDate: string | null
  dueDate: string | null
  estimatedHours: number | null
  actualHours: number | null
  parentIssueId: number | null
  milestone: BacklogVersion[] | null
}

export type BacklogRateLimitEntry = {
  limit: number
  remaining: number
  reset: number
}

export type BacklogCountResponse = {
  count: number
}
