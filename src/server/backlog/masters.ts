/**
 * プロジェクト・担当者・ステータスといったマスタ情報の取得。
 */

import type { MemberSummary, ProjectSummary, StatusGroup, Viewer } from '../../shared/types'
import type { BacklogProject, BacklogStatus, BacklogUser } from './api-types'
import { type BacklogClient, mapWithConcurrency } from './client'
import { isClosedStatus } from './issues'

/** マスタ取得の並列度。 */
const MASTER_CONCURRENCY = 5

/** API キーの検証も兼ねて、接続ユーザーの情報を取得する。 */
export async function fetchViewer(client: BacklogClient): Promise<Viewer> {
  const user = await client.get<BacklogUser>('/users/myself')
  return {
    id: user.id,
    userId: user.userId ?? null,
    name: user.name,
    space: client.space
  }
}

/** 参加中のプロジェクト一覧（アーカイブ済みは除外）。 */
export async function fetchProjects(client: BacklogClient): Promise<ProjectSummary[]> {
  const projects = await client.get<BacklogProject[]>('/projects', { archived: false })
  return projects
    .map((project) => ({ id: project.id, projectKey: project.projectKey, name: project.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
}

/**
 * 指定プロジェクト群の参加ユーザーを統合して返す。
 *
 * スペース全体のユーザー一覧ではなくプロジェクト単位にすることで、
 * 無関係なユーザーが担当者フィルタの候補に並ぶのを防ぐ。
 */
export async function fetchMembers(client: BacklogClient, projectIds: number[]): Promise<MemberSummary[]> {
  if (projectIds.length === 0) {
    return []
  }

  const lists = await mapWithConcurrency(projectIds, MASTER_CONCURRENCY, (projectId) =>
    client.get<BacklogUser[]>(`/projects/${projectId}/users`)
  )

  const byId = new Map<number, MemberSummary>()
  for (const user of lists.flat()) {
    if (!byId.has(user.id)) {
      byId.set(user.id, { id: user.id, name: user.name })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'))
}

/**
 * 指定プロジェクト群のステータスを名前で束ねて返す。
 *
 * Backlog はプロジェクトごとにカスタムステータスを追加できるため、
 * 同じ名前でもプロジェクトによって ID が異なる。UI では名前で選択させ、
 * API へ渡すときに対応する ID 群へ展開する。
 */
export async function fetchStatusGroups(client: BacklogClient, projectIds: number[]): Promise<StatusGroup[]> {
  if (projectIds.length === 0) {
    return []
  }

  const lists = await mapWithConcurrency(projectIds, MASTER_CONCURRENCY, (projectId) =>
    client.get<BacklogStatus[]>(`/projects/${projectId}/statuses`)
  )

  return groupStatuses(lists.flat())
}

/** ステータス配列を名前で束ねる。表示順は displayOrder の最小値に従う。 */
export function groupStatuses(statuses: BacklogStatus[]): StatusGroup[] {
  const byName = new Map<string, { group: StatusGroup; order: number }>()

  for (const status of statuses) {
    const entry = byName.get(status.name)
    if (entry) {
      if (!entry.group.ids.includes(status.id)) {
        entry.group.ids.push(status.id)
      }
      entry.order = Math.min(entry.order, status.displayOrder)
      continue
    }
    byName.set(status.name, {
      group: {
        name: status.name,
        color: status.color ?? null,
        ids: [status.id],
        isClosed: isClosedStatus(status)
      },
      order: status.displayOrder
    })
  }

  return [...byName.values()]
    .sort((a, b) => a.order - b.order || a.group.name.localeCompare(b.group.name, 'ja'))
    .map((entry) => {
      entry.group.ids.sort((a, b) => a - b)
      return entry.group
    })
}

/** ステータス名の選択を、Backlog へ渡す ID 群へ展開する。 */
export function resolveStatusIds(groups: StatusGroup[], selectedNames: string[], includeClosed: boolean): number[] {
  const target = selectedNames.length > 0 ? groups.filter((group) => selectedNames.includes(group.name)) : groups
  const filtered = includeClosed ? target : target.filter((group) => !group.isClosed)
  const ids = new Set<number>()
  for (const group of filtered) {
    for (const id of group.ids) {
      ids.add(id)
    }
  }
  return [...ids].sort((a, b) => a - b)
}
