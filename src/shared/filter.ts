/**
 * 表示条件（ViewFilter）と URL クエリ文字列の相互変換。
 *
 * 表示条件を URL に載せることで、チーム内でそのままリンク共有できるようにする。
 *
 * このモジュールはクライアントとサーバーの両方のバンドルへ入るため、
 * `URLSearchParams` のような片側にしか無い API は使わず、クエリ文字列の
 * 組み立てと分解も `encodeURIComponent` だけで行う（`shared/oauth.ts` と同じ方針）。
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

/**
 * 壊れた百分率記法でも例外にしない `decodeURIComponent`。
 *
 * 共有 URL は人の手で編集されうるため、`%` 単独のような値が届く。
 * 例外を投げると表示条件の復元ごと失敗してしまう。
 */
function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 名前のリストを 1 つの値へ畳む。
 *
 * ID と違って名前は利用者が自由に付けられるため、区切り文字の `,` を
 * 含みうる。要素の中の `,` は `\,` に、`\` 自体は `\\` に置き換えて
 * 区切りと区別する。
 *
 * 百分率記法ではなく逆斜線を使うのは、この値が復号を 1 回だけ通る経路を
 * 渡るため。共有 URL は Apps Script が `doGet` で受け取る時点で 1 度復号され、
 * `toQueryString` が組み直して画面へ渡る。百分率記法で区切りを隠していると、
 * その最初の復号で要素の中の `,` と区切りの `,` が見分けられなくなる。
 * 逆斜線なら復号を通っても形が変わらない。
 */
export function encodeNameList(names: string[]): string {
  return names
    .map((name) =>
      name
        .split('\\')
        .join(String.raw`\\`)
        .split(',')
        .join(String.raw`\,`)
    )
    .join(',')
}

/**
 * `encodeNameList` が畳んだ値を名前のリストへ戻す。
 *
 * 受け取るのは百分率記法をすでに解いた値。クエリ文字列から読む場合は
 * `parseFilter` が、API のパラメータから読む場合はそのまま渡す。
 */
export function parseNameList(value: string | null | undefined): string[] {
  if (!value) {
    return []
  }
  const names: string[] = []
  let current = ''
  let escaped = false
  for (const character of value) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === ',') {
      names.push(current)
      current = ''
      continue
    }
    current += character
  }
  names.push(current)
  return [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))]
}

function parseDate(value: string | undefined, fallback: string): string {
  return value && isDateKey(value) ? value : fallback
}

function parseEnum<T extends string>(value: string | undefined, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/**
 * クエリ文字列をキーと値へ分解する。値は百分率記法のまま返す。
 *
 * 復号は項目ごとの解釈に任せる。同じキーが複数あれば最初の 1 つを採る。
 *
 * キーは共有 URL 由来、つまり誰でも書ける値なので、素のオブジェクトではなく
 * `Map` に入れる。オブジェクトだと `__proto__` や `constructor` といった
 * キーがプロトタイプ側へ届き、後から読む値が入れ替わりうる。
 */
function parseQuery(query: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const part of query.split('&')) {
    if (part === '') {
      continue
    }
    const separator = part.indexOf('=')
    const rawKey = separator === -1 ? part : part.slice(0, separator)
    const rawValue = separator === -1 ? '' : part.slice(separator + 1)
    const key = decodeComponent(rawKey)
    if (!values.has(key)) {
      // 以前は `URLSearchParams` が組み立てていたため、空白が `+` の
      // 保存済みクエリが残っている。`+` そのものは必ず `%2B` になるので、
      // ここで空白へ戻しても元の値を壊さない。
      values.set(key, rawValue.split('+').join(' '))
    }
  }
  return values
}

/** `1` / `true` を真として解釈する。未指定なら fallback。 */
export function parseBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) {
    return fallback
  }
  return value === '1' || value === 'true'
}

/** URL クエリ文字列から表示条件を復元する。不正な値は既定値にフォールバックする。 */
export function parseFilter(query: string, now: number = Date.now()): ViewFilter {
  const base = defaultFilter(now)
  const values = parseQuery(query)
  const decoded = (key: string): string | undefined => {
    const value = values.get(key)
    return value === undefined ? undefined : decodeComponent(value)
  }
  // 期間の逆転と過大な期間はここで正す。以降の描画・取得処理は
  // 「有効な DateKey で from <= to、かつ上限日数以内」を前提にしてよい。
  const { from, to } = clampRange(parseDate(decoded('from'), base.from), parseDate(decoded('to'), base.to))
  return {
    // `URLSearchParams` が書いた保存済みクエリでは `,` が `%2C` になっている。
    // 復号してから解釈すれば、新旧どちらの形でも読める。
    projectIds: parseIdList(decoded('projects')),
    assigneeIds: parseIdList(decoded('assignees')),
    statusNames: parseNameList(decoded('statuses')),
    from,
    to,
    keyword: decoded('keyword')?.trim() ?? '',
    groupBy: parseEnum(decoded('group'), GROUP_BY_VALUES, base.groupBy),
    zoom: parseEnum(decoded('zoom'), ZOOM_VALUES, base.zoom),
    includeClosed: parseBool(decoded('closed'), base.includeClosed),
    includeNoDate: parseBool(decoded('nodate'), base.includeNoDate)
  }
}

/** 表示条件を URL クエリ文字列へ書き出す。既定値と同じ項目は省略する。 */
export function filterToQuery(filter: ViewFilter, now: number = Date.now()): string {
  const base = defaultFilter(now)
  const parts: string[] = []
  const set = (key: string, value: string): void => {
    parts.push(`${key}=${encodeURIComponent(value)}`)
  }

  // ID の一覧は数字と `,` だけなので符号化しない。`%2C` に置き換えると
  // 同じ内容でも 3 倍の長さになり、URL の 2KB 制限や `state` の長さ上限へ
  // 早く届いてしまう。
  if (filter.projectIds.length > 0) {
    parts.push(`projects=${filter.projectIds.join(',')}`)
  }
  if (filter.assigneeIds.length > 0) {
    parts.push(`assignees=${filter.assigneeIds.join(',')}`)
  }
  if (filter.statusNames.length > 0) {
    set('statuses', encodeNameList(filter.statusNames))
  }
  // 表示期間は既定値と一致していても必ず書き出す。既定値は「今日」を基準に
  // 計算されるため、省略すると URL の意味が開いた日によって変わってしまい、
  // 共有した相手（や日をまたいだ自分のブックマーク）が別の期間を見ることになる。
  set('from', filter.from)
  set('to', filter.to)
  if (filter.keyword) {
    set('keyword', filter.keyword)
  }
  if (filter.groupBy !== base.groupBy) {
    set('group', filter.groupBy)
  }
  if (filter.zoom !== base.zoom) {
    set('zoom', filter.zoom)
  }
  if (filter.includeClosed !== base.includeClosed) {
    set('closed', filter.includeClosed ? '1' : '0')
  }
  if (filter.includeNoDate !== base.includeNoDate) {
    set('nodate', filter.includeNoDate ? '1' : '0')
  }
  return parts.join('&')
}
