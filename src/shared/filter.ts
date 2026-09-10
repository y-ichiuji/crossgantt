/**
 * 表示条件（ViewFilter）と URL クエリパラメータの相互変換。
 *
 * 表示条件を URL に載せることで、チーム内でそのままリンク共有できるようにする。
 */

import { addMonths, endOfMonth, isDateKey, startOfMonth, todayKey } from './date'
import type { GroupBy, IssuesQuery, ViewFilter, Zoom } from './types'

const GROUP_BY_VALUES: GroupBy[] = ['assignee', 'project', 'milestone']
const ZOOM_VALUES: Zoom[] = ['day', 'week', 'month']

/** 既定の表示期間は「今月 1 日 〜 3 か月後の末日」。初回の取得件数を抑える狙いがある。 */
export function defaultRange(now: number = Date.now()): { from: string; to: string } {
  const today = todayKey(now)
  return { from: startOfMonth(today), to: endOfMonth(addMonths(today, 3)) }
}

export function defaultFilter(now: number = Date.now()): ViewFilter {
  const { from, to } = defaultRange(now)
  return {
    projectIds: [],
    assigneeIds: [],
    statusNames: [],
    from,
    to,
    keyword: '',
    groupBy: 'assignee',
    zoom: 'week',
    includeClosed: false,
    includeNoDate: false
  }
}

function parseIdList(value: string | null): number[] {
  if (!value) {
    return []
  }
  const ids = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  return [...new Set(ids)].toSorted((a, b) => a - b)
}

function parseNameList(value: string | null): string[] {
  if (!value) {
    return []
  }
  const names = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return [...new Set(names)]
}

function parseDate(value: string | null, fallback: string): string {
  return value && isDateKey(value) ? value : fallback
}

function parseEnum<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function parseBool(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback
  }
  return value === '1' || value === 'true'
}

/** URL クエリパラメータから表示条件を復元する。不正な値は既定値にフォールバックする。 */
export function parseFilter(params: URLSearchParams, now: number = Date.now()): ViewFilter {
  const base = defaultFilter(now)
  const from = parseDate(params.get('from'), base.from)
  let to = parseDate(params.get('to'), base.to)
  // 期間が逆転している場合は開始日に合わせて破綻を防ぐ。
  if (to < from) {
    to = from
  }
  return {
    projectIds: parseIdList(params.get('projects')),
    assigneeIds: parseIdList(params.get('assignees')),
    statusNames: parseNameList(params.get('statuses')),
    from,
    to,
    keyword: params.get('keyword')?.trim() ?? '',
    groupBy: parseEnum(params.get('group'), GROUP_BY_VALUES, base.groupBy),
    zoom: parseEnum(params.get('zoom'), ZOOM_VALUES, base.zoom),
    includeClosed: parseBool(params.get('closed'), base.includeClosed),
    includeNoDate: parseBool(params.get('nodate'), base.includeNoDate)
  }
}

/** 表示条件を URL クエリパラメータへ書き出す。既定値と同じ項目は省略する。 */
export function filterToParams(filter: ViewFilter, now: number = Date.now()): URLSearchParams {
  const base = defaultFilter(now)
  const params = new URLSearchParams()
  if (filter.projectIds.length > 0) {
    params.set('projects', filter.projectIds.join(','))
  }
  if (filter.assigneeIds.length > 0) {
    params.set('assignees', filter.assigneeIds.join(','))
  }
  if (filter.statusNames.length > 0) {
    params.set('statuses', filter.statusNames.join(','))
  }
  if (filter.from !== base.from) {
    params.set('from', filter.from)
  }
  if (filter.to !== base.to) {
    params.set('to', filter.to)
  }
  if (filter.keyword) {
    params.set('keyword', filter.keyword)
  }
  if (filter.groupBy !== base.groupBy) {
    params.set('group', filter.groupBy)
  }
  if (filter.zoom !== base.zoom) {
    params.set('zoom', filter.zoom)
  }
  if (filter.includeClosed !== base.includeClosed) {
    params.set('closed', filter.includeClosed ? '1' : '0')
  }
  if (filter.includeNoDate !== base.includeNoDate) {
    params.set('nodate', filter.includeNoDate ? '1' : '0')
  }
  return params
}

/** サーバーへの再取得が必要かどうかを判定するためのキー。 */
export function fetchKey(filter: IssuesQuery): string {
  return JSON.stringify({
    projects: filter.projectIds,
    assignees: filter.assigneeIds,
    statuses: filter.statusNames,
    from: filter.from,
    to: filter.to,
    keyword: filter.keyword,
    closed: filter.includeClosed,
    nodate: filter.includeNoDate
  })
}
