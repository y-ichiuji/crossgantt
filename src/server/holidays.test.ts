import { afterEach, describe, expect, it } from 'vitest'

import { createNullJsonCache } from './cache'
import type { JsonCache } from './cache'
import { fetchHolidays, resetHolidayMemo } from './holidays'
import { createFetcherStub, createMemoryJsonCache, jsonResponse, textResponse } from './test-utils'

const API_2026 = {
  '2026-09-21': '敬老の日',
  '2026-09-22': '休日',
  '2026-09-23': '秋分の日'
}

const NOW = Date.parse('2026-09-10T00:00:00Z')

/** 応答を差し替えつつ、キャッシュも記憶も持ち越さない取得。 */
function fetchWith(body: unknown, from: string, to: string, status = 200) {
  const stub = createFetcherStub(() => jsonResponse(body, status))
  const holidays = fetchHolidays(from, to, {
    fetcher: stub.fetcher,
    cache: createNullJsonCache(),
    now: NOW,
    skipMemo: true
  })
  return { holidays, stub }
}

afterEach(() => {
  resetHolidayMemo()
})

describe('fetchHolidays', () => {
  it('holidays-jp の値をそのまま返す', () => {
    expect(fetchWith(API_2026, '2026-09-01', '2026-09-30').holidays).toEqual([
      { dateKey: '2026-09-21', name: '敬老の日' },
      // API は振替休日と国民の休日をまとめて「休日」と書く。そのまま出す。
      { dateKey: '2026-09-22', name: '休日' },
      { dateKey: '2026-09-23', name: '秋分の日' }
    ])
  })

  it('表示期間の外は落とす', () => {
    const { holidays } = fetchWith(API_2026, '2026-09-22', '2026-09-22')
    expect(holidays.map((holiday) => holiday.dateKey)).toEqual(['2026-09-22'])
  })

  it('日付順に並べて返す', () => {
    const { holidays } = fetchWith(
      { '2026-09-23': '秋分の日', '2026-01-01': '元日', '2026-09-21': '敬老の日' },
      '2026-01-01',
      '2026-12-31'
    )
    expect(holidays.map((holiday) => holiday.dateKey)).toEqual(['2026-01-01', '2026-09-21', '2026-09-23'])
  })

  it('API が持っていない年は空になる', () => {
    // holidays-jp は去年・今年・来年の 3 年分しか持たない。
    expect(fetchWith(API_2026, '2030-01-01', '2030-12-31').holidays).toEqual([])
  })

  it('API が落ちていたら空を返す', () => {
    expect(fetchWith({}, '2026-09-01', '2026-09-30', 503).holidays).toEqual([])
  })

  it('通信そのものが失敗しても空を返す', () => {
    const stub = createFetcherStub(() => {
      throw new Error('network down')
    })
    const holidays = fetchHolidays('2026-01-01', '2026-01-31', {
      fetcher: stub.fetcher,
      cache: createNullJsonCache(),
      now: NOW,
      skipMemo: true
    })
    expect(holidays).toEqual([])
  })

  it('JSON として読めない応答は無視して空を返す', () => {
    const stub = createFetcherStub(() => textResponse(200, 'not json'))
    const holidays = fetchHolidays('2026-01-01', '2026-01-31', {
      fetcher: stub.fetcher,
      cache: createNullJsonCache(),
      now: NOW,
      skipMemo: true
    })
    expect(holidays).toEqual([])
  })

  it('形の違う応答は無視して空を返す', () => {
    expect(fetchWith(['2026-01-01'], '2026-01-01', '2026-01-02').holidays).toEqual([])
  })

  it('日付として読めない項目は捨てる', () => {
    const { holidays } = fetchWith({ 'not-a-date': 'なにか', '2026-09-21': '敬老の日' }, '2026-09-01', '2026-09-30')
    expect(holidays).toEqual([{ dateKey: '2026-09-21', name: '敬老の日' }])
  })

  it('同一実行内では取得結果を使い回す', () => {
    const stub = createFetcherStub(() => jsonResponse(API_2026))
    const cache: JsonCache = createNullJsonCache()

    fetchHolidays('2026-09-01', '2026-09-30', { fetcher: stub.fetcher, cache, now: NOW })
    fetchHolidays('2026-09-01', '2026-09-30', { fetcher: stub.fetcher, cache, now: NOW })

    expect(stub.requests).toHaveLength(1)
  })

  it('一定時間が経てば取り直す', () => {
    const stub = createFetcherStub(() => jsonResponse(API_2026))
    const cache: JsonCache = createNullJsonCache()

    fetchHolidays('2026-09-01', '2026-09-30', { fetcher: stub.fetcher, cache, now: NOW })
    fetchHolidays('2026-09-01', '2026-09-30', {
      fetcher: stub.fetcher,
      cache,
      now: NOW + 7 * 60 * 60 * 1000
    })

    expect(stub.requests).toHaveLength(2)
  })

  it('キャッシュがあれば実行をまたいでも取り直さない', () => {
    const stub = createFetcherStub(() => jsonResponse(API_2026))
    const cache = createMemoryJsonCache(() => NOW)

    fetchHolidays('2026-09-01', '2026-09-30', { fetcher: stub.fetcher, cache, now: NOW, skipMemo: true })
    fetchHolidays('2026-09-01', '2026-09-30', { fetcher: stub.fetcher, cache, now: NOW, skipMemo: true })

    expect(stub.requests).toHaveLength(1)
  })

  it('取得に失敗した結果はキャッシュへ残さない', () => {
    const cache = createMemoryJsonCache(() => NOW)
    // 1 回目は holidays-jp が落ちている。
    const failing = createFetcherStub(() => textResponse(503, 'unavailable'))
    expect(
      fetchHolidays('2026-09-01', '2026-09-30', { fetcher: failing.fetcher, cache, now: NOW, skipMemo: true })
    ).toEqual([])

    // キャッシュは利用者をまたいで共有され、再読込でも無視できない。
    // 失敗を覚えてしまうと、復旧しても期限が切れるまで祝日が出なくなる。
    const recovered = createFetcherStub(() => jsonResponse(API_2026))
    expect(
      fetchHolidays('2026-09-01', '2026-09-30', { fetcher: recovered.fetcher, cache, now: NOW, skipMemo: true })
    ).toHaveLength(3)
    expect(recovered.requests).toHaveLength(1)
  })
})
