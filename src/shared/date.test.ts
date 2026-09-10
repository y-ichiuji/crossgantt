import { describe, expect, it } from 'vitest'

import {
  addDays,
  addMonths,
  clampDate,
  diffDays,
  endOfMonth,
  formatMonthLabel,
  formatShort,
  isDateKey,
  isWeekend,
  MAX_DATE_KEY,
  MIN_DATE_KEY,
  overlaps,
  parseBacklogDate,
  startOfMonth,
  startOfWeek,
  todayKey
} from './date'

describe('isDateKey', () => {
  it('yyyy-MM-dd 形式を受け付ける', () => {
    expect(isDateKey('2026-09-10')).toBe(true)
    expect(isDateKey('2024-02-29')).toBe(true)
  })

  it('存在しない日付や別形式を拒否する', () => {
    expect(isDateKey('2026-02-31')).toBe(false)
    expect(isDateKey('2026-13-01')).toBe(false)
    expect(isDateKey('2026/09/10')).toBe(false)
    expect(isDateKey('20260910')).toBe(false)
    expect(isDateKey('')).toBe(false)
  })

  it('取り扱い範囲の外は拒否する', () => {
    expect(isDateKey(MIN_DATE_KEY)).toBe(true)
    expect(isDateKey(MAX_DATE_KEY)).toBe(true)
    expect(isDateKey('1969-12-31')).toBe(false)
    expect(isDateKey('3000-01-01')).toBe(false)
    // 9999 年を通すと endOfMonth が 10000-01-01 を作り、Date.parse が NaN を返して
    // toDateKey の toISOString が RangeError を投げる。境界で弾いておく。
    expect(isDateKey('9999-12-31')).toBe(false)
  })
})

describe('月末の計算', () => {
  it('取り扱い範囲の上限でも例外にならない', () => {
    expect(() => endOfMonth(MAX_DATE_KEY)).not.toThrow()
    expect(endOfMonth(MAX_DATE_KEY)).toBe('2999-12-31')
  })
})

describe('parseBacklogDate', () => {
  it('JST 深夜を表す UTC タイムスタンプを JST の日付に直す', () => {
    // 2026-08-31T15:00:00Z は JST の 2026-09-01 00:00
    expect(parseBacklogDate('2026-08-31T15:00:00Z')).toBe('2026-09-01')
  })

  it('UTC 深夜で返る場合も同じ日付になる', () => {
    expect(parseBacklogDate('2026-09-01T00:00:00Z')).toBe('2026-09-01')
  })

  it('日付のみの文字列も扱える', () => {
    expect(parseBacklogDate('2026-09-01')).toBe('2026-09-01')
  })

  it('null や不正値は null を返す', () => {
    expect(parseBacklogDate(null)).toBeNull()
    expect(parseBacklogDate(undefined)).toBeNull()
    expect(parseBacklogDate('')).toBeNull()
    expect(parseBacklogDate('not-a-date')).toBeNull()
  })
})

describe('日付演算', () => {
  it('addDays は月をまたいで計算できる', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
  })

  it('diffDays は日数差を返す', () => {
    expect(diffDays('2026-09-01', '2026-09-01')).toBe(0)
    expect(diffDays('2026-09-01', '2026-09-10')).toBe(9)
    expect(diffDays('2026-09-10', '2026-09-01')).toBe(-9)
  })

  it('addMonths は 1 日に丸めつつ年をまたぐ', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-01')
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-01')
  })

  it('startOfMonth と endOfMonth', () => {
    expect(startOfMonth('2026-09-10')).toBe('2026-09-01')
    expect(endOfMonth('2026-09-10')).toBe('2026-09-30')
    expect(endOfMonth('2024-02-05')).toBe('2024-02-29')
    expect(endOfMonth('2026-12-31')).toBe('2026-12-31')
  })

  it('startOfWeek は月曜日を返す', () => {
    // 2026-09-10 は木曜日
    expect(startOfWeek('2026-09-10')).toBe('2026-09-07')
    // 日曜日は前週の月曜へ
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07')
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07')
  })

  it('isWeekend は土日を判定する', () => {
    expect(isWeekend('2026-09-12')).toBe(true)
    expect(isWeekend('2026-09-13')).toBe(true)
    expect(isWeekend('2026-09-14')).toBe(false)
  })

  it('overlaps は両端を含む重なり判定', () => {
    expect(overlaps('2026-09-01', '2026-09-10', '2026-09-10', '2026-09-20')).toBe(true)
    expect(overlaps('2026-09-01', '2026-09-09', '2026-09-10', '2026-09-20')).toBe(false)
    expect(overlaps('2026-01-01', '2026-12-31', '2026-06-01', '2026-06-30')).toBe(true)
  })

  it('clampDate は範囲内に収める', () => {
    expect(clampDate('2026-08-01', '2026-09-01', '2026-09-30')).toBe('2026-09-01')
    expect(clampDate('2026-10-01', '2026-09-01', '2026-09-30')).toBe('2026-09-30')
    expect(clampDate('2026-09-15', '2026-09-01', '2026-09-30')).toBe('2026-09-15')
  })
})

describe('todayKey', () => {
  it('JST 基準で日付を返す', () => {
    // 2026-09-10T16:00:00Z は JST では 2026-09-11 01:00
    expect(todayKey(Date.parse('2026-09-10T16:00:00Z'))).toBe('2026-09-11')
    expect(todayKey(Date.parse('2026-09-10T14:00:00Z'))).toBe('2026-09-10')
  })
})

describe('表記', () => {
  it('formatShort と formatMonthLabel', () => {
    expect(formatShort('2026-09-01')).toBe('9/1')
    expect(formatShort('2026-12-25')).toBe('12/25')
    expect(formatMonthLabel('2026-09-01')).toBe('2026年9月')
  })
})
