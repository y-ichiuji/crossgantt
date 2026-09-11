/**
 * プロジェクト・担当者・ステータスといったマスタ情報の取得。
 */

import type { MemberSummary, ProjectSummary, StatusGroup, Viewer } from '../../shared/types'
import type { BacklogProject, BacklogStatus, BacklogUser } from './api-types'
import type { BacklogClient } from './client'
import { isClosedStatus } from './issues'

/** 日本語を含む名前の並びを揃える比較。 */
function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'ja')
}

/** API キーの検証も兼ねて、接続ユーザーの情報を取得する。 */
export function fetchViewer(client: BacklogClient): Viewer {
  const user = client.get<BacklogUser>('/users/myself')
  return {
    id: user.id,
    userId: user.userId ?? null,
    name: user.name,
    space: client.space
  }
}

/** 参加中のプロジェクト一覧（アーカイブ済みは除外）。 */
export function fetchProjects(client: BacklogClient): ProjectSummary[] {
  const projects = client.get<BacklogProject[]>('/projects', { archived: false })
  return projects
    .map((project) => ({ id: project.id, projectKey: project.projectKey, name: project.name }))
    .toSorted(compareByName)
}

/**
 * プロジェクトごとの参加ユーザー。
 *
 * スペース全体のユーザー一覧ではなくプロジェクト単位にすることで、
 * 無関係なユーザーが担当者フィルタの候補に並ぶのを防ぐ。
 * 返り値はプロジェクト ID の並びと対応する。呼び出し側でプロジェクト単位に
 * キャッシュできるよう、統合はしない。
 */
export function fetchProjectMembers(client: BacklogClient, projectIds: number[]): BacklogUser[][] {
  return client.getMany<BacklogUser[]>(projectIds.map((projectId) => ({ path: `/projects/${projectId}/users` })))
}

/** プロジェクトごとのユーザーを統合して担当者の選択肢にする。 */
export function mergeMembers(lists: BacklogUser[][]): MemberSummary[] {
  const byId = new Map<number, MemberSummary>()
  for (const user of lists.flat()) {
    if (!byId.has(user.id)) {
      byId.set(user.id, { id: user.id, name: user.name })
    }
  }
  return [...byId.values()].toSorted(compareByName)
}

/**
 * プロジェクトごとのステータス。
 *
 * 返り値はプロジェクト ID の並びと対応する。呼び出し側でプロジェクト単位に
 * キャッシュできるよう、統合はしない。
 */
export function fetchProjectStatuses(client: BacklogClient, projectIds: number[]): BacklogStatus[][] {
  return client.getMany<BacklogStatus[]>(projectIds.map((projectId) => ({ path: `/projects/${projectId}/statuses` })))
}

/**
 * ステータス配列を名前で束ねる。表示順は displayOrder の最小値に従う。
 *
 * Backlog はプロジェクトごとにカスタムステータスを追加できるため、
 * 同じ名前でもプロジェクトによって ID が異なる。UI では名前で選択させ、
 * API へ渡すときに対応する ID 群へ展開する。
 */
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
        color: status.color,
        ids: [status.id],
        isClosed: isClosedStatus(status)
      },
      order: status.displayOrder
    })
  }

  return [...byName.values()]
    .toSorted((a, b) => a.order - b.order || compareByName(a.group, b.group))
    .map((entry) => {
      entry.group.ids = entry.group.ids.toSorted((a, b) => a - b)
      return entry.group
    })
}

/**
 * ステータス名の選択を、Backlog へ渡す ID 群へ展開する。
 *
 * 「完了を含む」は明示的な選択が無いときの既定を決めるものであり、
 * ユーザーが名前でステータスを選んだ場合はその選択を優先する。
 * ここで選択を打ち消してしまうと、「完了」だけを選んだときに ID が空になり、
 * 呼び出し元が 0 件を返して「該当なし」と見分けが付かなくなる。
 */
export function resolveStatusIds(groups: StatusGroup[], selectedNames: string[], includeClosed: boolean): number[] {
  const explicit = selectedNames.length > 0
  const target = explicit ? groups.filter((group) => selectedNames.includes(group.name)) : groups
  const filtered = includeClosed || explicit ? target : target.filter((group) => !group.isClosed)
  const ids = new Set<number>()
  for (const group of filtered) {
    for (const id of group.ids) {
      ids.add(id)
    }
  }
  return [...ids].toSorted((a, b) => a - b)
}
