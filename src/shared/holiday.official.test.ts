/**
 * フォールバックの祝日計算を内閣府の公開データと突き合わせる。
 *
 * 実行時の祝日は holidays-jp から取る（`src/server/holidays.ts`）が、
 * あちらは去年・今年・来年の 3 年分しか持たないため、それより先は
 * `holiday.ts` の規則計算で補っている。その計算が正しいかどうかを、
 * 内閣府が公開している CSV と突き合わせて確かめる。
 *
 * 内閣府は CSV を出しているだけで REST API は提供していない。収録範囲も
 * 1955 年から翌年までなので、実行時のデータ源には使えない。
 *
 * ネットワークに出るため通常のテスト実行では飛ばす。
 * 実行するには `pnpm test:holidays`（内部で CHECK_HOLIDAYS=1 を渡している）。
 */

import { describe, expect, it } from 'vitest'

import { holidaysOfYear } from './holiday'

const CSV_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv'

/** 実装が対応している最も古い年。これより前は比較しない。 */
const SUPPORTED_SINCE = 1989

/**
 * 名称の書き方の違いを吸収する。
 *
 * 内閣府の CSV は振替休日と国民の休日をどちらも単に「休日」と書き、
 * 即位に伴う特例は「休日（祝日扱い）」としている。日付は一致していても
 * 文字列としては違うため、対応表で読み替える。日付の一致こそが目的なので、
 * ここを緩めても検査の意味は失われない。
 */
const NAME_ALIASES: Record<string, ReadonlyArray<string>> = {
  休日: ['振替休日', '国民の休日'],
  '休日（祝日扱い）': ['天皇の即位の日', '即位礼正殿の儀の行われる日'],
  '体育の日（スポーツの日）': ['体育の日']
}

function sameHoliday(officialName: string, computedName: string | undefined): boolean {
  if (computedName === undefined) {
    return false
  }
  if (officialName === computedName) {
    return true
  }
  return NAME_ALIASES[officialName]?.includes(computedName) ?? false
}

const enabled = process.env.CHECK_HOLIDAYS === '1'

/** 内閣府の CSV を取得して `yyyy-MM-dd` → 名称の Map にする。 */
async function fetchOfficial(): Promise<Map<string, string>> {
  const response = await fetch(CSV_URL)
  if (!response.ok) {
    throw new Error(`内閣府の CSV を取得できませんでした (${response.status})`)
  }
  // CSV は Shift_JIS で配信されている。
  const text = new TextDecoder('shift_jis').decode(await response.arrayBuffer())

  const holidays = new Map<string, string>()
  // 1 行目は見出し。
  for (const line of text.split(/\r?\n/u).slice(1)) {
    const [date, name] = line.split(',')
    if (!date || !name) {
      continue
    }
    const [year, month, day] = date.split('/').map(Number)
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    holidays.set(key, name.trim())
  }
  return holidays
}

describe.skipIf(!enabled)('内閣府の公開データとの突き合わせ', () => {
  it('1989 年以降の祝日が計算結果と一致する', { timeout: 30_000 }, async () => {
    const official = await fetchOfficial()
    expect(official.size).toBeGreaterThan(0)

    const years = [...new Set([...official.keys()].map((key) => Number(key.slice(0, 4))))]
      .filter((year) => year >= SUPPORTED_SINCE)
      .toSorted((a, b) => a - b)

    const differences: string[] = []
    for (const year of years) {
      const computed = holidaysOfYear(year)
      const expectedForYear = new Map([...official.entries()].filter(([key]) => key.startsWith(`${year}-`)))

      for (const [key, name] of expectedForYear) {
        if (!sameHoliday(name, computed.get(key))) {
          differences.push(`${key} 公式=${name} 実装=${computed.get(key) ?? 'なし'}`)
        }
      }
      for (const [key, name] of computed) {
        if (!expectedForYear.has(key)) {
          differences.push(`${key} 公式=なし 実装=${name}`)
        }
      }
    }

    expect(differences.toSorted((a, b) => a.localeCompare(b))).toEqual([])
  })
})
