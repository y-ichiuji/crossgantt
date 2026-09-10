/**
 * 日本の「国民の祝日」。
 *
 * 内閣府が CSV を公開しているが、取り込むと外部データへの依存が増え、
 * 毎年の更新も必要になる。祝日法の規則は計算で表せるため、ここでは
 * 規則をそのまま実装している。ネットワークにも追加パッケージにも依存しない。
 *
 * 対応範囲は 1989 年（平成元年）〜 2099 年。春分・秋分の近似式が
 * 1980〜2099 年でしか成り立たないため、それ以降は求められない。
 * 範囲外の年は「祝日なし」として扱う。
 */

import { addDays, dayOfWeek } from './date'

/** 春分・秋分の近似式が使える年の範囲。 */
const MIN_YEAR = 1989
const MAX_YEAR = 2099

/** 日付が変わらない祝日。`since` / `until` は施行・廃止の年。 */
const FIXED: ReadonlyArray<{ month: number; day: number; name: string; since?: number; until?: number }> = [
  { month: 1, day: 1, name: '元日' },
  // ハッピーマンデー制度より前は 1 月 15 日だった。
  { month: 1, day: 15, name: '成人の日', until: 1999 },
  { month: 2, day: 11, name: '建国記念の日' },
  // 天皇誕生日は 2019 年に日付が変わっている（2019 年は祝日そのものが無い）。
  { month: 2, day: 23, name: '天皇誕生日', since: 2020 },
  { month: 4, day: 29, name: 'みどりの日', until: 2006 },
  { month: 4, day: 29, name: '昭和の日', since: 2007 },
  { month: 5, day: 3, name: '憲法記念日' },
  { month: 5, day: 4, name: 'みどりの日', since: 2007 },
  { month: 5, day: 5, name: 'こどもの日' },
  // 制定から 2002 年までは 7 月 20 日で固定だった。
  { month: 7, day: 20, name: '海の日', since: 1996, until: 2002 },
  { month: 8, day: 11, name: '山の日', since: 2016 },
  { month: 9, day: 15, name: '敬老の日', until: 2002 },
  { month: 10, day: 10, name: '体育の日', until: 1999 },
  { month: 11, day: 3, name: '文化の日' },
  { month: 11, day: 23, name: '勤労感謝の日' },
  { month: 12, day: 23, name: '天皇誕生日', until: 2018 }
]

/** 「第 n 月曜日」で決まる祝日（ハッピーマンデー）。 */
const HAPPY_MONDAY: ReadonlyArray<{ month: number; nth: number; name: string; since: number; until?: number }> = [
  { month: 1, nth: 2, name: '成人の日', since: 2000 },
  { month: 7, nth: 3, name: '海の日', since: 2003 },
  { month: 9, nth: 3, name: '敬老の日', since: 2003 },
  { month: 10, nth: 2, name: '体育の日', since: 2000, until: 2019 },
  { month: 10, nth: 2, name: 'スポーツの日', since: 2022 }
]

/**
 * 通常の規則から外れる年。
 *
 * 2019 年は即位に伴う特例、2020・2021 年は東京オリンピックに合わせた
 * 移動があり、いずれも規則からは導けない。
 */
type Override = { add?: ReadonlyArray<[number, number, string]>; remove?: ReadonlyArray<string> }

const OVERRIDES: Partial<Record<number, Override>> = {
  // 皇室行事に伴う一日限りの休日。
  1989: { add: [[2, 24, '大喪の礼']] },
  1990: { add: [[11, 12, '即位礼正殿の儀']] },
  1993: { add: [[6, 9, '結婚の儀']] },
  2019: {
    add: [
      [4, 30, '国民の休日'],
      [5, 1, '天皇の即位の日'],
      [5, 2, '国民の休日'],
      [10, 22, '即位礼正殿の儀の行われる日']
    ]
  },
  2020: {
    add: [
      [7, 23, '海の日'],
      [7, 24, 'スポーツの日'],
      [8, 10, '山の日']
    ],
    remove: ['海の日', 'スポーツの日', '山の日']
  },
  2021: {
    add: [
      [7, 22, '海の日'],
      [7, 23, 'スポーツの日'],
      [8, 8, '山の日']
    ],
    remove: ['海の日', 'スポーツの日', '山の日']
  }
}

function dateKeyOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** その月の第 n 月曜日の日にち。 */
function nthMonday(year: number, month: number, nth: number): number {
  const firstDay = dayOfWeek(dateKeyOf(year, month, 1))
  // 月曜は 1。1 日が月曜なら 1 日、そうでなければ次の月曜まで進める。
  const firstMonday = 1 + ((8 - firstDay) % 7)
  return firstMonday + (nth - 1) * 7
}

/**
 * 春分の日・秋分の日。
 *
 * 天文計算そのものではなく、1980〜2099 年で一致することが知られている
 * 近似式を使う。祝日として官報に載るのは前年の 2 月なので、
 * 遠い将来の年はいずれにせよ確定していない。
 */
function equinoxDay(year: number, base: number): number {
  const elapsed = year - 1980
  return Math.floor(base + 0.242194 * elapsed - Math.floor(elapsed / 4))
}

function applies(year: number, since: number | undefined, until: number | undefined): boolean {
  if (since !== undefined && year < since) {
    return false
  }
  return !(until !== undefined && year > until)
}

const cache = new Map<number, ReadonlyMap<string, string>>()

/** その年の祝日を DateKey → 名称の対応で返す。 */
export function holidaysOfYear(year: number): ReadonlyMap<string, string> {
  const cached = cache.get(year)
  if (cached) {
    return cached
  }
  const result = buildYear(year)
  cache.set(year, result)
  return result
}

/** 規則から決まる祝日（振替休日・国民の休日を除く）。 */
function statutoryHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>()
  const override = OVERRIDES[year]
  const removed = new Set(override?.remove ?? [])

  const put = (month: number, day: number, name: string) => {
    if (!removed.has(name)) {
      holidays.set(dateKeyOf(year, month, day), name)
    }
  }

  for (const rule of FIXED) {
    if (applies(year, rule.since, rule.until)) {
      put(rule.month, rule.day, rule.name)
    }
  }
  for (const rule of HAPPY_MONDAY) {
    if (applies(year, rule.since, rule.until)) {
      put(rule.month, nthMonday(year, rule.month, rule.nth), rule.name)
    }
  }
  put(3, equinoxDay(year, 20.8431), '春分の日')
  put(9, equinoxDay(year, 23.2488), '秋分の日')

  for (const [month, day, name] of override?.add ?? []) {
    holidays.set(dateKeyOf(year, month, day), name)
  }
  return holidays
}

/**
 * 振替休日を足す。
 *
 * 祝日が日曜に当たったら、その後の最初の「祝日でない日」を休みにする。
 * 連休の初日が日曜のときは、連休の翌日までずれる。
 */
function addSubstituteHolidays(holidays: Map<string, string>): void {
  for (const dateKey of [...holidays.keys()].toSorted()) {
    if (dayOfWeek(dateKey) !== 0) {
      continue
    }
    let candidate = addDays(dateKey, 1)
    while (holidays.has(candidate)) {
      candidate = addDays(candidate, 1)
    }
    holidays.set(candidate, '振替休日')
  }
}

/**
 * 国民の休日を足す。
 *
 * 前日と翌日がどちらも「国民の祝日」である平日が対象。振替休日は
 * 国民の祝日ではないため、判定には規則から決まる祝日だけを使う。
 */
function addBridgeHolidays(holidays: Map<string, string>, statutory: ReadonlySet<string>): void {
  for (const dateKey of [...statutory].toSorted()) {
    const next = addDays(dateKey, 1)
    if (holidays.has(next) || dayOfWeek(next) === 0) {
      continue
    }
    if (statutory.has(addDays(next, 1))) {
      holidays.set(next, '国民の休日')
    }
  }
}

function buildYear(year: number): ReadonlyMap<string, string> {
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return new Map()
  }
  const holidays = statutoryHolidays(year)
  const statutory = new Set(holidays.keys())
  addSubstituteHolidays(holidays)
  addBridgeHolidays(holidays, statutory)
  return holidays
}

/** 祝日ならその名称、そうでなければ null。 */
export function holidayName(dateKey: string): string | null {
  const year = Number(dateKey.slice(0, 4))
  return holidaysOfYear(year).get(dateKey) ?? null
}

/** 祝日かどうか。 */
export function isHoliday(dateKey: string): boolean {
  return holidayName(dateKey) !== null
}

/** 期間内の祝日を古い順に返す。 */
export function holidaysBetween(from: string, to: string): Array<{ dateKey: string; name: string }> {
  const result: Array<{ dateKey: string; name: string }> = []
  const fromYear = Number(from.slice(0, 4))
  const toYear = Number(to.slice(0, 4))
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const [dateKey, name] of [...holidaysOfYear(year).entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
      if (dateKey >= from && dateKey <= to) {
        result.push({ dateKey, name })
      }
    }
  }
  return result
}
