import { describe, expect, it, vi } from 'vitest'

import { fetchHolidays, resetHolidayMemo } from './holidays'

/** holidays-jp の応答を模したレスポンスを返す fetch。 */
function stubApi(body: unknown, status = 200) {
  return vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch
}

const API_2026 = {
  '2026-09-21': '敬老の日',
  '2026-09-22': '休日',
  '2026-09-23': '秋分の日'
}

describe('fetchHolidays', () => {
  it('holidays-jp の値をそのまま返す', async () => {
    const holidays = await fetchHolidays('2026-09-01', '2026-09-30', {
      fetchImpl: stubApi(API_2026),
      skipMemo: true
    })
    expect(holidays).toEqual([
      { dateKey: '2026-09-21', name: '敬老の日' },
      // API は振替休日と国民の休日をまとめて「休日」と書く。そのまま出す。
      { dateKey: '2026-09-22', name: '休日' },
      { dateKey: '2026-09-23', name: '秋分の日' }
    ])
  })

  it('表示期間の外は落とす', async () => {
    const holidays = await fetchHolidays('2026-09-22', '2026-09-22', {
      fetchImpl: stubApi(API_2026),
      skipMemo: true
    })
    expect(holidays.map((holiday) => holiday.dateKey)).toEqual(['2026-09-22'])
  })

  it('API が持っていない年は計算で補う', async () => {
    // API は 2026 年しか持っていないが、2030 年も表示したい。
    const holidays = await fetchHolidays('2030-01-01', '2030-01-31', {
      fetchImpl: stubApi(API_2026),
      skipMemo: true
    })
    expect(holidays).toEqual([
      { dateKey: '2030-01-01', name: '元日' },
      { dateKey: '2030-01-14', name: '成人の日' }
    ])
  })

  it('API が持っている年は計算結果で二重に足さない', async () => {
    // API 側に無い 2026-01-01 も、2026 年は API の担当なので足さない。
    const holidays = await fetchHolidays('2026-01-01', '2026-12-31', {
      fetchImpl: stubApi(API_2026),
      skipMemo: true
    })
    expect(holidays.map((holiday) => holiday.dateKey)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23'])
  })

  it('API と計算を混ぜても日付順になる', async () => {
    const holidays = await fetchHolidays('2026-09-01', '2027-01-31', {
      fetchImpl: stubApi(API_2026),
      skipMemo: true
    })
    const keys = holidays.map((holiday) => holiday.dateKey)
    expect(keys).toEqual([...keys].toSorted((a, b) => (a < b ? -1 : 1)))
    expect(keys).toContain('2026-09-21')
    expect(keys).toContain('2027-01-01')
  })

  it('API が落ちていたら計算結果に倒す', async () => {
    const holidays = await fetchHolidays('2026-09-01', '2026-09-30', {
      fetchImpl: stubApi({}, 503),
      skipMemo: true
    })
    expect(holidays).toEqual([
      { dateKey: '2026-09-21', name: '敬老の日' },
      { dateKey: '2026-09-22', name: '国民の休日' },
      { dateKey: '2026-09-23', name: '秋分の日' }
    ])
  })

  it('通信そのものが失敗しても計算結果に倒す', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const holidays = await fetchHolidays('2026-01-01', '2026-01-31', {
      fetchImpl: failing,
      skipMemo: true
    })
    expect(holidays.map((holiday) => holiday.dateKey)).toEqual(['2026-01-01', '2026-01-12'])
  })

  it('形の違う応答は無視して計算結果に倒す', async () => {
    const holidays = await fetchHolidays('2026-01-01', '2026-01-02', {
      fetchImpl: stubApi(['2026-01-01']),
      skipMemo: true
    })
    expect(holidays).toEqual([{ dateKey: '2026-01-01', name: '元日' }])
  })

  it('日付として読めない項目は捨てる', async () => {
    const holidays = await fetchHolidays('2026-09-21', '2026-09-21', {
      fetchImpl: stubApi({ 'not-a-date': 'なにか', '2026-09-21': '敬老の日' }),
      skipMemo: true
    })
    expect(holidays).toEqual([{ dateKey: '2026-09-21', name: '敬老の日' }])
  })

  it('アイソレート内では取得結果を使い回す', async () => {
    resetHolidayMemo()
    const fetchImpl = stubApi(API_2026)
    const now = Date.parse('2026-09-10T00:00:00Z')
    await fetchHolidays('2026-09-01', '2026-09-30', { fetchImpl, now })
    await fetchHolidays('2026-09-01', '2026-09-30', { fetchImpl, now })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    resetHolidayMemo()
  })

  it('一定時間が経てば取り直す', async () => {
    resetHolidayMemo()
    const fetchImpl = stubApi(API_2026)
    const now = Date.parse('2026-09-10T00:00:00Z')
    await fetchHolidays('2026-09-01', '2026-09-30', { fetchImpl, now })
    await fetchHolidays('2026-09-01', '2026-09-30', { fetchImpl, now: now + 25 * 60 * 60 * 1000 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    resetHolidayMemo()
  })
})
