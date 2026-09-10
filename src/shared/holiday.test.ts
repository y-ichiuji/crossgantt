import { describe, expect, it } from 'vitest'

import { holidayName, holidaysBetween, holidaysOfYear, isHoliday } from './holiday'

/** 内閣府が公開している「国民の祝日」一覧と突き合わせた期待値。 */
const EXPECTED_2026: ReadonlyArray<[string, string]> = [
  ['2026-01-01', '元日'],
  ['2026-01-12', '成人の日'],
  ['2026-02-11', '建国記念の日'],
  ['2026-02-23', '天皇誕生日'],
  ['2026-03-20', '春分の日'],
  ['2026-04-29', '昭和の日'],
  ['2026-05-03', '憲法記念日'],
  ['2026-05-04', 'みどりの日'],
  ['2026-05-05', 'こどもの日'],
  ['2026-05-06', '振替休日'],
  ['2026-07-20', '海の日'],
  ['2026-08-11', '山の日'],
  ['2026-09-21', '敬老の日'],
  ['2026-09-22', '国民の休日'],
  ['2026-09-23', '秋分の日'],
  ['2026-10-12', 'スポーツの日'],
  ['2026-11-03', '文化の日'],
  ['2026-11-23', '勤労感謝の日']
]

describe('holidaysOfYear', () => {
  it('2026 年の祝日が内閣府の一覧と一致する', () => {
    const actual = [...holidaysOfYear(2026).entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))
    expect(actual).toEqual(EXPECTED_2026.map(([dateKey, name]) => [dateKey, name]))
  })

  it('2025 年の祝日が内閣府の一覧と一致する', () => {
    const actual = [...holidaysOfYear(2025).entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))
    expect(actual).toEqual([
      ['2025-01-01', '元日'],
      ['2025-01-13', '成人の日'],
      ['2025-02-11', '建国記念の日'],
      ['2025-02-23', '天皇誕生日'],
      ['2025-02-24', '振替休日'],
      ['2025-03-20', '春分の日'],
      ['2025-04-29', '昭和の日'],
      ['2025-05-03', '憲法記念日'],
      ['2025-05-04', 'みどりの日'],
      ['2025-05-05', 'こどもの日'],
      ['2025-05-06', '振替休日'],
      ['2025-07-21', '海の日'],
      ['2025-08-11', '山の日'],
      ['2025-09-15', '敬老の日'],
      ['2025-09-23', '秋分の日'],
      ['2025-10-13', 'スポーツの日'],
      ['2025-11-03', '文化の日'],
      ['2025-11-23', '勤労感謝の日'],
      ['2025-11-24', '振替休日']
    ])
  })

  it('2024 年の秋分の日は 9/22 になる', () => {
    expect(holidayName('2024-09-22')).toBe('秋分の日')
    expect(holidayName('2024-09-23')).toBe('振替休日')
  })

  it('日曜に当たった祝日の翌日が振替休日になる', () => {
    // 2026-05-03（憲法記念日）は日曜。5/4・5/5 も祝日なので 5/6 へずれる。
    expect(holidayName('2026-05-06')).toBe('振替休日')
  })

  it('祝日に挟まれた平日は国民の休日になる', () => {
    // 2026-09-21（敬老の日・月）と 09-23（秋分の日・水）に挟まれた火曜。
    expect(holidayName('2026-09-22')).toBe('国民の休日')
  })

  it('オリンピックで移動した 2021 年の祝日を再現する', () => {
    expect(holidayName('2021-07-22')).toBe('海の日')
    expect(holidayName('2021-07-23')).toBe('スポーツの日')
    expect(holidayName('2021-08-08')).toBe('山の日')
    expect(holidayName('2021-08-09')).toBe('振替休日')
    // 移動元の日付は祝日ではなくなる。
    expect(holidayName('2021-07-19')).toBeNull()
    expect(holidayName('2021-10-11')).toBeNull()
  })

  it('即位に伴う 2019 年の特例を再現する', () => {
    expect(holidayName('2019-04-30')).toBe('国民の休日')
    expect(holidayName('2019-05-01')).toBe('天皇の即位の日')
    expect(holidayName('2019-05-02')).toBe('国民の休日')
    expect(holidayName('2019-10-22')).toBe('即位礼正殿の儀の行われる日')
    // 2019 年に天皇誕生日は無い。
    expect(holidayName('2019-02-23')).toBeNull()
    expect(holidayName('2019-12-23')).toBeNull()
  })

  it('2018 年までの天皇誕生日は 12/23', () => {
    expect(holidayName('2018-12-23')).toBe('天皇誕生日')
    expect(holidayName('2018-12-24')).toBe('振替休日')
    expect(holidayName('2018-02-23')).toBeNull()
  })

  it('山の日は 2016 年から', () => {
    expect(holidayName('2016-08-11')).toBe('山の日')
    expect(holidayName('2015-08-11')).toBeNull()
  })

  it('近似式が成り立たない年は祝日なしとして扱う', () => {
    expect(holidaysOfYear(1988).size).toBe(0)
    expect(holidaysOfYear(2100).size).toBe(0)
    expect(isHoliday('2100-01-01')).toBe(false)
  })
})

describe('isHoliday', () => {
  it('祝日かどうかを判定する', () => {
    expect(isHoliday('2026-01-01')).toBe(true)
    expect(isHoliday('2026-01-02')).toBe(false)
  })
})

describe('holidaysBetween', () => {
  it('期間内の祝日を古い順に返す', () => {
    expect(holidaysBetween('2026-04-25', '2026-05-10')).toEqual([
      { dateKey: '2026-04-29', name: '昭和の日' },
      { dateKey: '2026-05-03', name: '憲法記念日' },
      { dateKey: '2026-05-04', name: 'みどりの日' },
      { dateKey: '2026-05-05', name: 'こどもの日' },
      { dateKey: '2026-05-06', name: '振替休日' }
    ])
  })

  it('年をまたいでも取れる', () => {
    expect(holidaysBetween('2025-12-30', '2026-01-02')).toEqual([{ dateKey: '2026-01-01', name: '元日' }])
  })

  it('祝日が無ければ空', () => {
    expect(holidaysBetween('2026-06-01', '2026-06-30')).toEqual([])
  })
})
