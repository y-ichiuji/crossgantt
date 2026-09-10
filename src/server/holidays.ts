/**
 * 日本の祝日の取得。
 *
 * 一次情報は holidays-jp（<https://holidays-jp.github.io/>）の JSON を使う。
 * Google カレンダーの祝日情報から自動生成されており、内閣府の告示に追従する。
 * ただし取得できるのは去年・今年・来年の 3 年分だけなので、それより先の
 * 期間は `shared/holiday.ts` の規則計算で補う。ガントチャートは先の予定を
 * 並べるものなので、来年までしか塗られないのでは足りない。
 *
 * 取得に失敗した場合も計算側へ倒す。祝日の背景が出ないことは
 * 画面全体を止めるほどの問題ではない。
 */

import { holidaysBetween } from '../shared/holiday'
import { hashKey, withJsonCache } from './cache'

const API_URL = 'https://holidays-jp.github.io/api/v1/date.json'

/** 祝日は年に一度しか変わらないため、長めに持つ。 */
const TTL_SECONDS = 24 * 60 * 60

/**
 * Worker のアイソレート内で使い回す一時キャッシュ。
 *
 * Cache API は workers.dev のサブドメインでは働かないため、それだけに
 * 頼ると毎リクエスト外部へ出てしまう。アイソレートが生きているあいだは
 * ここで受け止める。
 */
let memo: { fetchedAt: number; holidays: Record<string, string> } | null = null

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

async function fetchFromApi(fetchImpl: typeof fetch): Promise<Record<string, string> | null> {
  try {
    const response = await fetchImpl(API_URL, { headers: { Accept: 'application/json' } })
    if (!response.ok) {
      return null
    }
    return parseResponse(await response.json())
  } catch {
    // 外部サービスが落ちていても、この画面は計算側で成立する。
    return null
  }
}

export type HolidaySourceOptions = {
  fetchImpl?: typeof fetch
  now?: number
  /** 呼び出しごとに状態を持ち越さないテスト用。 */
  skipMemo?: boolean
}

/** holidays-jp から取得した祝日。取れなければ null。 */
async function loadFromApi(options: HolidaySourceOptions): Promise<Record<string, string> | null> {
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis)
  const now = options.now ?? Date.now()

  if (!options.skipMemo && memo && now - memo.fetchedAt < TTL_SECONDS * 1000) {
    return memo.holidays
  }

  const key = await hashKey('holidays', API_URL)
  const holidays = await withJsonCache<Record<string, string> | null>('holidays', [key], TTL_SECONDS, false, async () =>
    fetchFromApi(fetchImpl)
  )
  if (holidays && !options.skipMemo) {
    memo = { fetchedAt: now, holidays }
  }
  return holidays
}

/**
 * 期間内の祝日を古い順に返す。
 *
 * holidays-jp が持っている年はその値を、持っていない年は規則計算の値を使う。
 * 混在させるのは、3 年より先を空欄にするより一貫した表示になるため。
 */
export async function fetchHolidays(
  from: string,
  to: string,
  options: HolidaySourceOptions = {}
): Promise<Array<{ dateKey: string; name: string }>> {
  const api = await loadFromApi(options)
  if (!api) {
    return holidaysBetween(from, to)
  }

  // API が値を持っている年。1 日でも入っていればその年は API に任せる。
  const covered = new Set(Object.keys(api).map((dateKey) => dateKey.slice(0, 4)))

  const fromApi = Object.entries(api)
    .filter(([dateKey]) => dateKey >= from && dateKey <= to)
    .map(([dateKey, name]) => ({ dateKey, name }))

  const computed = holidaysBetween(from, to).filter(({ dateKey }) => !covered.has(dateKey.slice(0, 4)))

  return [...fromApi, ...computed].toSorted((a, b) => (a.dateKey < b.dateKey ? -1 : 1))
}

/** テスト用にアイソレート内キャッシュを捨てる。 */
export function resetHolidayMemo(): void {
  memo = null
}
