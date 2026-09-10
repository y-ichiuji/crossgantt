/**
 * 表示条件（ViewFilter）と URL クエリパラメータの相互変換。
 *
 * 表示条件を URL に載せることで、チーム内でそのままリンク共有できるようにする。
 */

import { addDays, addMonths, diffDays, endOfMonth, isDateKey, startOfMonth, todayKey } from './date'
import type { GroupBy, ViewFilter, Zoom } from './types'

const GROUP_BY_VALUES: GroupBy[] = ['assignee', 'project', 'milestone']
const ZOOM_VALUES: Zoom[] = ['day', 'week', 'month']

/**
 * 表示期間の最大日数（両端を含む）。
 *
 * タイムラインは日ズームで 1 日につき目盛りとバンドの DOM を作るため、
 * 期間を無制限にすると `?from=1970-01-01&to=2999-12-31` のような共有 URL
 * 1 つでブラウザが数百万ノードを生成して固まる。サーバー側の課題取得
 * （最大 25 ページ × 4 クエリ）にとっても現実的な上限が要る。
 */
export const MAX_RANGE_DAYS = 366 * 5

/** 表示期間を「from <= to」かつ最大日数以内に収める。 */
export function clampRange(from: string, to: string): { from: string; to: string } {
  const ordered = to < from ? from : to
  if (diffDays(from, ordered) + 1 <= MAX_RANGE_DAYS) {
    return { from, to: ordered }
  }
  return { from, to: addDays(from, MAX_RANGE_DAYS - 1) }
}

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
    groupBy: 'project',
    zoom: 'day',
    includeClosed: false,
    includeNoDate: false
  }
}

/**
 * カンマ区切りの ID リストを解釈する。
 *
 * クライアント（URL クエリ）とサーバー（API クエリ）は同じ表現をやり取りするため、
 * 解釈の規則はここ 1 か所に置く。片側だけ変えると、共有された URL と
 * 実際に描画される内容が食い違う。
 */
export function parseIdList(value: string | null | undefined): number[] {
  if (!value) {
    return []
  }
  const ids = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  return [...new Set(ids)].toSorted((a, b) => a - b)
}

/** カンマ区切りの名前リストを解釈する。 */
export function parseNameList(value: string | null | undefined): string[] {
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

/** `1` / `true` を真として解釈する。未指定なら fallback。 */
export function parseBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) {
    return fallback
  }
  return value === '1' || value === 'true'
}

/** URL クエリパラメータから表示条件を復元する。不正な値は既定値にフォールバックする。 */
export function parseFilter(params: URLSearchParams, now: number = Date.now()): ViewFilter {
  const base = defaultFilter(now)
  // 期間の逆転と過大な期間はここで正す。以降の描画・取得処理は
  // 「有効な DateKey で from <= to、かつ上限日数以内」を前提にしてよい。
  const { from, to } = clampRange(parseDate(params.get('from'), base.from), parseDate(params.get('to'), base.to))
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
  // 表示期間は既定値と一致していても必ず書き出す。既定値は「今日」を基準に
  // 計算されるため、省略すると URL の意味が開いた日によって変わってしまい、
  // 共有した相手（や日をまたいだ自分のブックマーク）が別の期間を見ることになる。
  params.set('from', filter.from)
  params.set('to', filter.to)
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
