/**
 * 日本の祝日の取得。
 *
 * holidays-jp（<https://holidays-jp.github.io/>）の JSON を使う。Google カレンダーの
 * 祝日情報から自動生成されており、告示の変更に追従する。
 *
 * 取得できるのは去年・今年・来年の 3 年分。それより先の期間は祝日を塗らない。
 * 数年先まで見渡すような使い方はしない前提で、規則を自前で持たない判断にしている。
 *
 * 取得に失敗した場合は空を返す。祝日の背景が出ないことは画面を止めるほどの
 * 問題ではないため、画面全体のエラーにはしない。
 */

import type { Holiday } from '../shared/types'
import type { JsonCache } from './cache'
import type { Fetcher } from './fetcher'

const API_URL = 'https://holidays-jp.github.io/api/v1/date.json'

/**
 * キャッシュの保持秒数。
 *
 * 祝日は年に一度しか変わらないためもっと長く持ちたいが、CacheService の
 * 上限が 6 時間なのでそれに合わせる。
 */
const TTL_SECONDS = 6 * 60 * 60

/**
 * 同一実行内で使い回す一時キャッシュ。
 *
 * 1 回の実行で複数回引かれても、外部へ出るのは 1 度で済ませる。
 */
let memo: { fetchedAt: number; holidays: Record<string, string> } | null = null

export type HolidaySource = {
  fetcher: Fetcher
  /** 利用者に依存しない情報なので、スクリプト共通のキャッシュを渡す。 */
  cache: JsonCache
  now: number
  /** 呼び出しごとに状態を持ち越さないテスト用。 */
  skipMemo?: boolean
}

/** 応答が `{"2026-01-01": "元日"}` の形をしているかを確かめる。 */
function parseResponse(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const result: Record<string, string> = {}
  for (const [key, name] of Object.entries(value)) {
    // 想定外の項目が混ざっていても、日付として読めるものだけを採る。
    if (typeof name === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(key)) {
      result[key] = name
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

function fetchFromApi(fetcher: Fetcher): Record<string, string> | null {
  try {
    const [response] = fetcher([{ url: API_URL, headers: { Accept: 'application/json' } }])
    if (response.status < 200 || response.status >= 300) {
      return null
    }
    return parseResponse(JSON.parse(response.text()))
  } catch {
    // 外部サービスが落ちていても、この画面は祝日なしで成立する。
    return null
  }
}

/** holidays-jp から取得した祝日。取れなければ null。 */
function loadFromApi(source: HolidaySource): Record<string, string> | null {
  if (!source.skipMemo && memo && source.now - memo.fetchedAt < TTL_SECONDS * 1000) {
    return memo.holidays
  }

  const holidays = source.cache.withJson<Record<string, string> | null>('holidays', [API_URL], TTL_SECONDS, false, () =>
    fetchFromApi(source.fetcher)
  )
  if (holidays && !source.skipMemo) {
    memo = { fetchedAt: source.now, holidays }
  }
  return holidays
}

/**
 * 期間内の祝日を古い順に返す。
 *
 * holidays-jp が持っていない年（3 年より先など）は、その期間だけ何も返らない。
 */
export function fetchHolidays(from: string, to: string, source: HolidaySource): Holiday[] {
  const api = loadFromApi(source)
  if (!api) {
    return []
  }
  return Object.entries(api)
    .filter(([dateKey]) => dateKey >= from && dateKey <= to)
    .map(([dateKey, name]) => ({ dateKey, name }))
    .toSorted((a, b) => (a.dateKey < b.dateKey ? -1 : 1))
}

/** テスト用に実行内キャッシュを捨てる。 */
export function resetHolidayMemo(): void {
  memo = null
}
