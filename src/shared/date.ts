/**
 * 日付ユーティリティ。
 *
 * このアプリでは日付を常に `yyyy-MM-dd` 形式の文字列（以下 DateKey）で扱い、
 * 計算するときだけ UTC 深夜の epoch ミリ秒に変換する。ローカルタイムゾーンに
 * 依存する `Date` のコンストラクタやゲッターは使わない。
 */

/** 1 日のミリ秒数。 */
export const DAY_MS = 24 * 60 * 60 * 1000

/** Backlog が基準とするタイムゾーンのオフセット（JST = UTC+9）。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

/**
 * 取り扱う DateKey の下限と上限。
 *
 * 上限を 9999 年のままにすると、`endOfMonth('9999-12-31')` が内部で
 * `addMonths` を通して `10000-01-01` を作る。5 桁の年は拡張形式
 * （`+010000-01-01`）でないと `Date.parse` が解釈できず NaN になり、
 * `toDateKey` の `toISOString()` が RangeError を投げてしまう。
 * 業務上ありえない範囲は境界で弾き、内部の日付計算が必ず有効な値だけを
 * 受け取れるようにする。
 */
export const MIN_DATE_KEY = '1970-01-01'
export const MAX_DATE_KEY = '2999-12-31'

/** `yyyy-MM-dd` 形式で、かつ取り扱い範囲に収まっているかを判定する。 */
export function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) {
    return false
  }
  const time = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(time)) {
    return false
  }
  // 2026-02-31 のような存在しない日付を弾く。
  if (toDateKey(time) !== value) {
    return false
  }
  return value >= MIN_DATE_KEY && value <= MAX_DATE_KEY
}

/** epoch ミリ秒を UTC 基準で `yyyy-MM-dd` に変換する。 */
export function toDateKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

/** `yyyy-MM-dd` を UTC 深夜の epoch ミリ秒に変換する。 */
export function toTime(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`)
}

/**
 * Backlog API が返す日付文字列を DateKey に正規化する。
 *
 * Backlog は日付項目を JST 深夜に相当する UTC タイムスタンプ
 * （例: `2026-08-31T15:00:00Z` = 2026-09-01 JST）で返すことがある。
 * 一方で `2026-09-01T00:00:00Z` のように返る環境もあるため、
 * どちらであっても JST に直してから日付部分を取り出す。
 * この変換は後者のケースでも日付を変えないため安全である。
 */
export function parseBacklogDate(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const time = Date.parse(value)
  if (Number.isNaN(time)) {
    return null
  }
  return toDateKey(time + JST_OFFSET_MS)
}

/** DateKey に日数を加算する。 */
export function addDays(dateKey: string, days: number): string {
  return toDateKey(toTime(dateKey) + days * DAY_MS)
}

/** `to - from` の日数差を返す。同じ日なら 0。 */
export function diffDays(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS)
}

/** JST における今日の DateKey を返す。 */
export function todayKey(now: number = Date.now()): string {
  return toDateKey(now + JST_OFFSET_MS)
}

/**
 * JST における時刻を `HH:mm` で返す。
 *
 * 画面の日付はすべて JST で組み立てているため、時刻だけブラウザの
 * タイムゾーンで描くと、日本国外から見たときに「今日」の列と食い違う。
 */
export function formatTimeOfDay(time: number): string {
  const shifted = new Date(time + JST_OFFSET_MS)
  const hours = String(shifted.getUTCHours()).padStart(2, '0')
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** その月の 1 日の DateKey を返す。 */
export function startOfMonth(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`
}

/** その月の末日の DateKey を返す。 */
export function endOfMonth(dateKey: string): string {
  const first = startOfMonth(dateKey)
  return addDays(addMonths(first, 1), -1)
}

/** DateKey に月数を加算する。日は 1 日に丸める。 */
export function addMonths(dateKey: string, months: number): string {
  const year = Number(dateKey.slice(0, 4))
  const month = Number(dateKey.slice(5, 7))
  const total = year * 12 + (month - 1) + months
  const nextYear = Math.floor(total / 12)
  const nextMonth = total - nextYear * 12 + 1
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`
}

/** 0=日曜 〜 6=土曜。 */
export function dayOfWeek(dateKey: string): number {
  return new Date(toTime(dateKey)).getUTCDay()
}

/** 土日なら true。 */
export function isWeekend(dateKey: string): boolean {
  const day = dayOfWeek(dateKey)
  return day === 0 || day === 6
}

/** その週の月曜日の DateKey を返す。 */
export function startOfWeek(dateKey: string): string {
  const day = dayOfWeek(dateKey)
  // 日曜(0) は前週の月曜まで 6 日戻る。
  const back = day === 0 ? 6 : day - 1
  return addDays(dateKey, -back)
}

/** `M/d` 形式の短い表記。 */
export function formatShort(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`
}

/** `yyyy年M月` 形式の表記。 */
export function formatMonthLabel(dateKey: string): string {
  return `${dateKey.slice(0, 4)}年${Number(dateKey.slice(5, 7))}月`
}

/** 2 つの期間が重なっているかどうか。両端を含む。 */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toTime(aStart) <= toTime(bEnd) && toTime(aEnd) >= toTime(bStart)
}

/** 値を [min, max] に収める。 */
export function clampDate(dateKey: string, min: string, max: string): string {
  if (toTime(dateKey) < toTime(min)) {
    return min
  }
  if (toTime(dateKey) > toTime(max)) {
    return max
  }
  return dateKey
}
